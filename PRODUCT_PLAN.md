# Product Plan: Verbis

*Execution-ready plan derived from `verbis-prd.md`, with infrastructure decisions finalized.*

## 1. Summary

Verbis is a personal read-aloud app: import a PDF, DOCX, or a photo of a physical book page, and have it read aloud in a natural voice with the current word highlighted in sync, so you can follow along or glance up and find your place instantly. Tapping any word jumps both the highlight and the audio to that point. Documents live in a personal library with reading position saved automatically.

Finalized stack: **React + Vite installable PWA and a Node/Express API, both self-hosted on Deploro VPS compute**, backed by **Deploro's Studio REST API for the database + Deploro project storage (R2) for files**, using **ElevenLabs** for TTS with character-level timing and **Google Cloud Vision** for OCR.

## 2. Finalized Architecture

| Area | Decision | Why |
|---|---|---|
| TTS | ElevenLabs, `/v1/text-to-speech/{voice_id}/with-timestamps` | Only realistic option here that returns character-level `char_start_times_ms`/`char_end_times_ms` alongside the audio in one call — no separate alignment step. Best-in-class voice quality. Free tier is small (~10K chars/month), so cost needs tracking once past prototyping. |
| OCR | Google Cloud Vision, Document Text Detection | Purpose-built for dense printed text on photographed pages; handles skew/lighting reasonably and preserves reading order, which matters more here than raw character accuracy. Cheap at personal-use volume. |
| Platform | Installable PWA (single React + Vite codebase) | One codebase covers desktop and mobile. Browser camera input (`<input type="file" accept="image/*" capture>`) covers the scan-a-book-page use case without a native app build/store overhead. "Add to Home Screen" gives an app-like feel for a personal tool. |
| Backend | Node/Express, self-hosted on Deploro | Avoids serverless execution-time limits — TTS generation, OCR calls, and chunk processing can run long, especially on first-chunk-through-full-document generation. Matches the pattern used by AmpedClock, Amped Cadence, and PX Dispatch. |
| Database | Deploro's per-project Studio REST API (`db/studioClient.ts`), not a direct Postgres connection | Originally direct `pg` to a self-hosted Postgres instance; switched because a direct connection only works from Deploro VPS compute, and the app also needs `@google-cloud/vision`/`jsdom`/local-disk storage which are VPS-only anyway — but the Studio API removes one more hard dependency and is Deploro's own managed path, so there's no reason to hold onto raw `pg` once VPS wasn't the thing forcing the choice. Verified against the real `verbis` project's database (see `PRODUCT_PLAN.md` implementation status below). |
| File/audio storage | Deploro project storage (R2) over its HTTP storage API (`storage/deploroStorage.ts`); S3-compatible and local-disk adapters remain as alternatives | Originally the S3 adapter against a self-hosted bucket, with local disk as the fallback actually in use. Moved to Deploro's own storage so files stop living on an unbacked Docker volume — Deploro's nightly backup covers Postgres only. It could not reuse the S3 adapter: Deploro reaches R2 through a Cloudflare Workers binding, exposes no S3-compatible endpoint, and issues no S3 access keys, so it needed a third adapter rather than a different `S3_ENDPOINT`. |
| Frontend hosting | Deploro VPS (nginx serving the static build), alongside the backend, both in `deploro.compose.yml` | Originally planned for Netlify; switched to keep the whole app on one platform/one `deploro vps deploy` once the backend was confirmed to need VPS compute anyway (OCR/web-import/storage are Node-native, not Workers-compatible). |

## 3. System Flow

```
[PWA — nginx, Deploro VPS]
  ├─ Upload PDF/DOCX, or capture/upload a book-page photo
  ├─ Playback UI: <audio> element + text column + controls
  │
  ▼  HTTPS
[Express API — Deploro VPS]
  ├─ Text extraction: pdf.js / mammoth.js (PDF/DOCX), or forwards photo to OCR
  ├─ OCR: Google Cloud Vision → structured text
  ├─ Chunking: split extracted text into sentence/paragraph-sized chunks
  ├─ TTS: ElevenLabs with-timestamps per chunk → audio (MP3) + char-level timing
  ├─ Persists: chunk text, audio file, timing JSON
  │
  ▼
[Deploro Studio REST API]         [Deploro project storage (R2)]
  documents, chunks (metadata,      original uploads, generated
  timing_data JSON), voices,        audio files per chunk
  reading_sessions
  │
  ▼
[PWA — nginx, Deploro VPS]
  ├─ Fetches audio + timing_data per chunk, caches them
  ├─ On <audio> `timeupdate`, matches playback time → timing_data →
  │   current char range → current word → updates highlight in the DOM
  └─ Tap-to-jump: tapped word → its char offset → nearest timestamp in
      timing_data → seek <audio>.currentTime → resume playback
```

Chunking is generation-time (first chunk generated immediately so playback starts fast; later chunks generated in the background) and also the natural seek/cache boundary — each chunk is one audio file + one timing blob.

## 4. Data Model

Implemented in `backend/src/db/schema.sql` (source of truth — keep this section in sync with it):

- **documents**: `id`, `title`, `source_type` (`pdf` | `docx` | `txt` | `epub` | `scan` | `url`), `original_file_key` (bucket key, not a generic URL), `voice_id` (FK → voices), `status` (`processing` | `ready` | `error`), `error_message`, `last_position` (JSON: `{chunkSequenceIndex, timeSeconds}`), `summary` (Phase 4, cached on first generation), `page_layout` (PDF-only JSON: `{pages: [{pageNumber, width, height}], words: [{charStart, charEnd, page, x, y, width, height}]}`, fractional bounding boxes per word for the Page view reader — `null` for non-PDF documents and PDFs imported before this existed), `created_at`
- **chunks**: `id`, `document_id`, `sequence_index`, `text_content`, `char_start` (this chunk's starting offset within the document's full extracted text — used with `documents.page_layout` to map a chunk's TTS word timing onto a position on the rendered PDF page), `status` (`pending` | `ready` | `error`, tracks per-chunk background generation), `audio_key` (bucket key), `timing_data` (JSON: `{words: [{word, charStart, charEnd, startMs, endMs}]}`), `duration_seconds`
- **voices**: `id`, `provider` (`elevenlabs`), `provider_voice_id`, `display_name`
- **reading_sessions**: defined in the schema for future history-beyond-last-position use; not yet written to by any route — `documents.last_position` covers resume for v1.

Object storage note: `putObject`/`getObjectBuffer` (`backend/src/storage/index.ts`) pick one of three backends in priority order — Deploro project storage when `DEPLORO_STORAGE_URL` is set (production), an S3-compatible bucket when the `S3_*` vars are set, then local disk under `backend/storage/` so the app runs with no storage infra at all. The bucket is private: reads are proxied back through `GET /documents/:id/original` and `.../chunks/:seq/audio` rather than served as public URLs, which keeps uploaded PDFs from being world-readable to anyone holding a UUID. Public read is per-project on Deploro, not per-folder, so it can't be enabled for audio alone. There's no separate local-dev database anymore — both local dev and the deployed app talk to the same Deploro-hosted Studio API for the `verbis` project (`backend/src/db/studioClient.ts`), authenticated with a project-scoped PAT (`DEPLORO_API_TOKEN`).

## 5. Build Phases

**Phase 1 — Core loop (MVP)**
PDF/DOCX import and text extraction, ElevenLabs TTS integration with character-level alignment, word highlighting, playback controls (play, pause, rewind, speed 0.5x–3x+), tap-to-jump, library with resume position. This is the phase that has to prove out synced highlighting end to end before anything else is worth building.

**Phase 2 — Scan support**
Camera/photo capture in the PWA, Google Cloud Vision OCR pipeline, feeding scanned text into the same reader flow as PDF/DOCX (same chunking, TTS, highlighting code path).

**Phase 3 — Polish and offline**
EPUB/TXT import, web page import via URL (Readability-based extraction), offline audio caching (service worker + cached audio/timing per document), dark/light/system reading theme, adjustable highlight granularity (word/sentence/off).

**Phase 4 — Optional expansion**
Summarization and lightweight document Q&A are implemented (local Ollama model — `gemma4` by default, no API key or per-token billing, request-triggered, summary cached on the document row). Multi-device sync is deliberately **not** implemented — it would require accounts/auth, which conflicts with the no-auth single-user architecture and is explicitly framed as optional in the PRD (§5, §29 non-goals).

### Implementation status

All of Phase 1–4 above is built (`backend/src/`, `frontend/src/`) except multi-device sync (see note above), **deployed, and live at `https://verbis.deploro.app`**.

- `backend/.env` is filled in with real values: `ELEVENLABS_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` (base64 service account key — set this rather than the file-path `GOOGLE_APPLICATION_CREDENTIALS` in any environment where `vps set-env` is the only way to inject secrets, since it can't upload files), `DEPLORO_API_URL`/`DEPLORO_API_TOKEN`, `OLLAMA_BASE_URL=https://ollama.com` with `OLLAMA_API_KEY` (the deployed backend can't reach a `localhost` Ollama instance, so production uses Ollama's direct cloud API instead of a local relay).
- Database-layer functions (`db/documents.ts`/`db/chunks.ts`/`db/voices.ts`, backed by `db/studioClient.ts`), ElevenLabs TTS + word-boundary derivation, Google Cloud Vision OCR, and Ollama summarize/Q&A were all verified end-to-end against real provider responses — not just type-checked. The full scan → OCR → chunk → TTS → store pipeline was exercised live against the deployed app with a real image and produced a real playable audio chunk with correct word-level timing.
- `tsc --noEmit`/`tsc -b` pass on both projects; a clean `vite build` validates the PWA/workbox config.
- Deploy topology: Deploro VPS compute, one project-wide public port (`frontend`, bound to `127.0.0.1:18080`, proxied by Deploro's own edge to `https://verbis.deploro.app`) — `backend` has no public port at all, reached only via nginx's internal `/api/*` proxy. See `deploro.compose.yml` for the full compose stack and why (VPS ports must bind to `127.0.0.1` on a distinct high port, never `0.0.0.0:80` — that's owned by Deploro's own shared edge nginx across every project on the box).

## 6. Environment/Secrets Checklist

- [x] ElevenLabs API key → `backend/.env` `ELEVENLABS_API_KEY`; also set on VPS via `deploro vps set-env`
- [x] Google Cloud Vision service account credentials → `GOOGLE_APPLICATION_CREDENTIALS_JSON` (base64), set both locally and via `deploro vps set-env`
- [x] Ollama → production uses the direct cloud API (`OLLAMA_BASE_URL=https://ollama.com` + `OLLAMA_API_KEY`), not a local relay, since the VPS can't reach `localhost` on the dev machine
- [x] Deploro `verbis` project database → `deploro db create` + `deploro migrate create/apply` against `backend/src/db/schema.sql`; app reaches it via `DEPLORO_API_URL`/`DEPLORO_API_TOKEN`, no direct Postgres connection
- [x] Deploro project storage → `DEPLORO_STORAGE_URL` (= `DEPLORO_API_URL` without the trailing `/studio`; the storage routes are siblings of the Studio API, not children of it). Needs a project-admin token — a member-scoped one reads fine and 403s every write. All 288 pre-existing files were migrated to R2 at their existing relative keys, so no key remapping was needed.
- [ ] S3-compatible bucket (optional, unused) → `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`
- [ ] The `verbis-storage` Docker volume still holds the 288 pre-migration files. Nothing writes to it any more; clearing it is a separate, later change, since it and R2 are currently the only two copies.
- [x] `deploro vps deploy` for both the backend and frontend (`deploro.compose.yml`), with the above secrets injected via `deploro vps set-env` — server-side only, never shipped to the PWA client. Live at `https://verbis.deploro.app`.

## 7. Open Flags

- **OCR accuracy on real book photos** is the single biggest technical unknown. Test Cloud Vision against a handful of real scanned pages (varied lighting, angle, font) early, before the Phase 2 pipeline is locked in.
- **Chunking strategy** (sentence-level vs. paragraph-level) affects both cost and highlight smoothness — worth a quick prototype of both before committing in Phase 1.
- **TTS cost at real usage volume**: ElevenLabs' free tier (~10K characters/month) is small. Model expected pages/month early so paid-tier budgeting isn't a mid-build surprise.
- **Scope creep**: the PRD explicitly calls out the temptation to add podcast generation, Q&A, or dictation early, since that's the direction Speechify itself sprawled in. Hold the Phase 1–3 line until the core reading experience feels solid.

## 8. Success Criteria (from the PRD, unchanged)

- Upload a real PDF or DOCX you actually need to read and listen through it start to finish without the highlighting drifting out of sync.
- Scan a physical book page and get usable audio from it, even if OCR isn't perfect on the first pass.
- You'd genuinely reach for this over Speechify itself for personal reading, even in a rough v1 state.
