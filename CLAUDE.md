# CLAUDE.md

Guidance for Claude Code when working in this repository. See `verbis-prd.md` for full product requirements and `PRODUCT_PLAN.md` for the finalized architecture and build phases — read both before making structural changes.

## What Verbis Is

A personal read-aloud app: import a PDF/DOCX or a photo of a book page, get it read aloud with the current word highlighted in sync, and tap any word to jump playback there. Single user, no auth, no multi-tenant concerns. Optimize for a tight, fast, single-purpose reader — resist adding features from the PRD's explicit non-goals list (voice cloning, podcast generation, dictation, meeting notes, multi-user accounts) unless the user asks.

## Stack

- **Frontend**: React + Vite, built as an installable PWA. Served by nginx, deployed via Deploro VPS compute (`deploro.compose.yml`).
- **Backend**: Node/Express, self-hosted on Deploro VPS compute (needed for `@google-cloud/vision`, `jsdom`, and local-disk storage, none of which run on Deploro's Cloudflare Worker path).
- **Database**: Deploro's per-project Studio REST API (`backend/src/db/studioClient.ts`), not a direct Postgres connection — same for local dev and production, both point at the same Deploro-hosted `verbis` project via `DEPLORO_API_URL`/`DEPLORO_API_TOKEN`.
- **File/audio storage**: Deploro project storage (R2) via its HTTP storage API, selected by `DEPLORO_STORAGE_URL` (`backend/src/storage/deploroStorage.ts`). Falls through to an S3-compatible bucket when the `S3_*` vars are set, then to local disk (`backend/storage/`) when neither is (`backend/src/storage/index.ts`).
- **TTS**: ElevenLabs, `/v1/text-to-speech/{voice_id}/with-timestamps`.
- **OCR**: Google Cloud Vision, Document Text Detection mode.
- **Summarization/Q&A (Phase 4)**: local Ollama model (default `gemma4`, configurable via `OLLAMA_MODEL`) — no API key, no per-token billing.

No other providers should be introduced for these roles without discussing it first — each was chosen deliberately (see `PRODUCT_PLAN.md` §2) and swapping one has knock-on effects (e.g. only ElevenLabs' `with-timestamps` endpoint gives the character-level alignment the highlighting feature depends on).

## Architectural Rules

- **Secrets never reach the client.** ElevenLabs and Google Cloud Vision calls happen server-side only, from the Express API. The PWA never holds these API keys.
- **Timing data is character-level, not word-level.** ElevenLabs returns `char_start_times_ms`/`char_end_times_ms` per character. Word boundaries must be derived by splitting the source text on whitespace and tracking character offsets — don't assume the provider gives you pre-grouped words.
- **Chunking is the seek/cache boundary.** Text is split into sentence- or paragraph-sized chunks before TTS generation. Each chunk gets one audio file + one timing blob, stored together and keyed to the chunk row. Tap-to-jump resolves a tapped word → character offset → chunk's timing data → timestamp → `<audio>.currentTime` seek. Don't build seeking logic that spans chunk boundaries implicitly; jumping across chunks means loading the target chunk's audio first.
- **Generate the first chunk before the rest.** Playback should start within 5-8 seconds of upload. Generate chunk 1 synchronously (or near it), then generate remaining chunks in the background while playback continues.
- **Cache aggressively.** Once a chunk's audio is generated, never regenerate it. Both TTS and OCR are metered APIs — re-synthesis on re-listen is a cost bug, not just a performance one.
- **Storage keys, not bare URLs.** `documents.original_file_key` and `chunks.audio_key` are storage keys (S3-compatible bucket, or local disk in dev), not public URLs — the API mediates access via `GET /documents/:id/chunks/:seq/audio`.
- **No raw SQL — go through `db/studioClient.ts`.** The backend talks to Deploro's Studio REST API, not a direct Postgres connection. It has no server-side sort (sort client-side after fetching) and no native upsert (look up by filter, then update-or-insert — see `upsertVoice` in `db/voices.ts` for the pattern). Response bodies are wrapped: `{ row: {...} }` for single-row endpoints, `{ rows: [...], total }` for lists.

## Data Model

See `PRODUCT_PLAN.md` §4 for the full `documents` / `chunks` / `voices` / `reading_sessions` schema. Keep schema changes reflected in that doc.

## Build Phases

Follow the phase order in `PRODUCT_PLAN.md` §5 — don't jump ahead to Phase 2 (scan/OCR) or Phase 4 (summarization/Q&A/sync) work before Phase 1 (core PDF/DOCX loop with synced highlighting) is solid. The highlighting sync is the feature that makes or breaks the product; get it right on the simplest input path (PDF/DOCX) before adding OCR noise on top.

**Status**: Phases 1–4 are implemented (multi-device sync excluded by design — see `PRODUCT_PLAN.md` §5). The database layer is verified end-to-end against the real Deploro `verbis` project. ElevenLabs/Google Cloud Vision/Ollama routes still need real keys in `backend/.env` before they're exercised for real.

## Known Open Risks

- OCR accuracy on real handheld book photos is unvalidated — test against real varied-lighting/angle photos early in Phase 2, don't assume Cloud Vision's quoted accuracy holds.
- Chunking granularity (sentence vs. paragraph) trades off API call volume against highlight/seek smoothness — worth prototyping both before locking in.
- ElevenLabs free tier is ~10K characters/month — track usage once past prototyping, this will be exceeded fast.

## Conventions

- No comments explaining *what* code does — name things clearly instead. Comments only for non-obvious *why* (e.g. a provider quirk, a workaround).
- No auth/multi-user scaffolding — this is explicitly a single-user personal tool for v1.
- Don't add abstractions (config layers, provider-swap interfaces, feature flags) for providers/features not yet in scope — build for the current phase, not hypothetical future providers.
