# CLAUDE.md

Guidance for Claude Code when working in this repository. See `verbis-prd.md` for full product requirements and `PRODUCT_PLAN.md` for the finalized architecture and build phases — read both before making structural changes.

## What Verbis Is

A personal read-aloud app: import a PDF/DOCX or a photo of a book page, get it read aloud with the current word highlighted in sync, and tap any word to jump playback there. Invite-only, three roles (`admin`/`contributor`/`member`), each user's library private by default with explicit per-document sharing by username — see "Auth & Access Model" below. Optimize for a tight, fast, single-purpose reader — resist adding features from the PRD's explicit non-goals list (voice cloning, podcast generation, dictation, meeting notes) unless the user asks.

## Stack

- **Frontend**: React + Vite, built as an installable PWA. Served by nginx, deployed via Deploro VPS compute (`deploro.compose.yml`).
- **Backend**: Node/Express, self-hosted on Deploro VPS compute (needed for `@google-cloud/vision`, `jsdom`, and local-disk storage, none of which run on Deploro's Cloudflare Worker path).
- **Database**: Deploro's per-project Studio REST API (`backend/src/db/studioClient.ts`), not a direct Postgres connection — same for local dev and production, both point at the same Deploro-hosted `verbis` project via `DEPLORO_API_URL`/`DEPLORO_API_TOKEN`.
- **File/audio storage**: Deploro project storage (R2) via its HTTP storage API, selected by `DEPLORO_STORAGE_URL` (`backend/src/storage/deploroStorage.ts`). Falls through to an S3-compatible bucket when the `S3_*` vars are set, then to local disk (`backend/storage/`) when neither is (`backend/src/storage/index.ts`).
- **TTS**: Speechify (`POST /v1/audio/speech`, default) or ElevenLabs (`/v1/text-to-speech/{voice_id}/with-timestamps`), selected by `TTS_PROVIDER`. Both return the same character-anchored word timings, so previously generated audio stays valid across a switch.
- **OCR**: Google Cloud Vision, Document Text Detection mode.
- **Summarization/Q&A (Phase 4)**: local Ollama model (default `gemma4`, configurable via `OLLAMA_MODEL`) — no API key, no per-token billing.
- **Auth**: Deploro Auth-as-a-Service (`email_password` provider on the `verbis` project), proxied server-to-server — see below.

No other providers should be introduced for these roles without discussing it first — each was chosen deliberately (see `PRODUCT_PLAN.md` §2) and swapping one has knock-on effects (e.g. both TTS backends must keep returning character-anchored word timing, since the highlighting feature depends on it).

## Auth & Access Model

Verbis uses Deploro Auth-as-a-Service for identity, but Deploro has no closed-signup toggle — invite-only is enforced entirely by Verbis's own `users` table (`backend/src/db/users.ts`), not by Deploro. A stranger can still complete a raw signup directly against the Deploro worker; without a matching row in `users` every Verbis route 403s them anyway (`middleware/auth.ts`'s `requireAuth`). Only the admin-invite endpoint (`POST /admin/invite`, admin-only) ever inserts into `users`.

The Deploro session cookie (`gallium_project_session_<slug>`) is scoped to the Deploro worker's own domain, not Verbis's — so sessions are backend-mediated, not browser-direct: `POST /auth/login` calls Deploro server-to-server and re-issues its own `verbis_session` cookie on Verbis's domain; every protected route validates that cookie by calling Deploro's `GET /auth/:slug/session` server-to-server (`lib/deploroAuth.ts`). Never call the Deploro worker's `/auth/:slug/*` endpoints directly from the frontend — always go through Verbis's own `/auth/*` routes.

An invited user has an app-level `users` row (`username`, `email`, `role`) before they have any real Deploro credential. `deploro_user_id` stays null (`pending` in the admin UI) until they finish setup and log in for the first time.

**The invite notification and the real password credential are two fully separate Deploro identities/actions — don't merge them.** `POST /admin/invite` (and `POST /admin/users/:id/resend-invite`) call `deploroAuth.addEndUser` (admin-add, `POST /api/projects/:id/auth/users`), which creates a *passwordless* `email` (OTP) identity purely to trigger Deploro's "Confirm your account" email as the notification. The invitee then goes to `/welcome` (Deploro's Auth Site URL, `deploro auth site-url`, points there) and chooses their real password themselves, which `POST /auth/accept-invite` sends via `deploroAuth.signup` — a completely separate `email_password` identity/credential.

Both of those confirmation emails redirect to the *same* Site URL — Deploro's confirm-link redirect is only ever `/welcome?verified=1`, with no way to tell which of the two just happened. Left alone, clicking the *second* email (confirming the real password just chosen) would land back on the same "choose a password" form instead of sign-in, which is wrong and confusing. `Welcome.tsx` disambiguates with a `localStorage` flag (`verbis_awaiting_confirm`) set right before `/auth/accept-invite` triggers that second email and cleared the moment a `?verified=1` return trip finds it set, at which point it redirects to `/login?confirmed=1` instead of re-showing the form. This is a same-device heuristic, not a real solution — fine for a small invite-only app, but don't assume it if the auth flow grows more legs.

This split exists because of a real incident, not a style preference: an earlier version had the invite email itself come from `signup` with a random throwaway password, meaning clicking "Confirm your account" *finalized that password permanently* (re-signup on an already-confirmed identity is a silent no-op — it does not update the password) — and `requestPasswordReset` doesn't work (verified live, repeatedly, across every account state: unconfirmed, freshly confirmed, confirmed-with-a-real-login-on-record, with the `email` OTP provider both on and off — Deploro simply never delivers that email for this project despite always returning `{"ok":true}`). One invited user got permanently locked out this way with no recovery path before this was caught. `addEndUser`'s OTP identity can't cause this — clicking its confirmation link never touches a password at all. **Don't reintroduce a throwaway-password `signup` call anywhere in the invite path.**

`sendInviteEmail` (`routes/admin.ts`) deletes-then-recreates the Deploro end user on every call rather than just calling `addEndUser` once, because admin-add 409s if one already exists for that email — which is the normal case for every resend, not an error — and it's safe to delete: this identity never holds a real credential, and `sendInviteEmail` is only ever invoked for a user who hasn't finished setup yet (`deploroUserId` still null).

Three roles: `admin` (full access + can invite), `contributor` (can upload their own documents), `member` (read-only — can only consume documents shared with them). Every document/folder has exactly one `owner_id`; there is no shared "everyone's library." `document_shares` grants one other user read-only access to one document (+ its audio) by username — sharing is owner-only, and shared access never includes delete/folder-assignment/further-sharing regardless of the recipient's own role.

## Architectural Rules

- **Secrets never reach the client.** Speechify, ElevenLabs, and Google Cloud Vision calls happen server-side only, from the Express API. The PWA never holds these API keys.
- **Timing data is character-level, not word-level.** ElevenLabs returns `char_start_times_ms`/`char_end_times_ms` per character; Speechify returns nested speech marks with `start`/`end` character offsets and `start_time`/`end_time`. Word boundaries must be derived by splitting the source text on whitespace and tracking character offsets — don't assume either provider gives you pre-grouped words.
- **Chunking is the seek/cache boundary.** Text is split into sentence- or paragraph-sized chunks before TTS generation. Each chunk gets one audio file + one timing blob, stored together and keyed to the chunk row. Tap-to-jump resolves a tapped word → character offset → chunk's timing data → timestamp → `<audio>.currentTime` seek. Don't build seeking logic that spans chunk boundaries implicitly; jumping across chunks means loading the target chunk's audio first.
- **Generate the first chunk before the rest.** Playback should start within 5-8 seconds of upload. Generate chunk 1 synchronously (or near it), then generate remaining chunks in the background while playback continues.
- **Cache aggressively.** Once a chunk's audio is generated, never regenerate it. Both TTS and OCR are metered APIs — re-synthesis on re-listen is a cost bug, not just a performance one.
- **Storage keys, not bare URLs.** `documents.original_file_key` and `chunks.audio_key` are storage keys (S3-compatible bucket, or local disk in dev), not public URLs — the API mediates access via `GET /documents/:id/chunks/:seq/audio`.
- **No raw SQL — go through `db/studioClient.ts`.** The backend talks to Deploro's Studio REST API, not a direct Postgres connection. It has no server-side sort (sort client-side after fetching) and no native upsert (look up by filter, then update-or-insert — see `upsertVoice` in `db/voices.ts` for the pattern). Response bodies are wrapped: `{ row: {...} }` for single-row endpoints, `{ rows: [...], total }` for lists.

## Data Model

See `PRODUCT_PLAN.md` §4 for the full `users` / `documents` / `chunks` / `voices` / `reading_sessions` / `document_shares` schema. Keep schema changes reflected in that doc.

## Build Phases

Follow the phase order in `PRODUCT_PLAN.md` §5 — don't jump ahead to Phase 2 (scan/OCR) or Phase 4 (summarization/Q&A/sync) work before Phase 1 (core PDF/DOCX loop with synced highlighting) is solid. The highlighting sync is the feature that makes or breaks the product; get it right on the simplest input path (PDF/DOCX) before adding OCR noise on top.

**Status**: Phases 1–4 are implemented (multi-device sync excluded by design — see `PRODUCT_PLAN.md` §5). The database layer is verified end-to-end against the real Deploro `verbis` project. Speechify/ElevenLabs/Google Cloud Vision/Ollama routes still need real keys in `backend/.env` before they're exercised for real.

## Known Open Risks

- OCR accuracy on real handheld book photos is unvalidated — test against real varied-lighting/angle photos early in Phase 2, don't assume Cloud Vision's quoted accuracy holds.
- Chunking granularity (sentence vs. paragraph) trades off API call volume against highlight/seek smoothness — worth prototyping both before locking in.
- ElevenLabs free tier is ~10K characters/month — track usage once past prototyping, this will be exceeded fast. Speechify is metered per character too; same tracking applies if it becomes the primary backend long-term.

## Conventions

- No comments explaining *what* code does — name things clearly instead. Comments only for non-obvious *why* (e.g. a provider quirk, a workaround).
- This is a small invite-only group, not a public multi-tenant product — don't add scaffolding (self-service signup UI, org/team hierarchies, public directories) beyond the three-role model above unless asked.
- Don't add abstractions (config layers, provider-swap interfaces, feature flags) for providers/features not yet in scope — build for the current phase, not hypothetical future providers.
