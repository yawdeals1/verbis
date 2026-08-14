# Product Plan: Verbis

*Execution-ready plan derived from `verbis-prd.md`, with infrastructure decisions finalized.*

## 1. Summary

Verbis is a personal read-aloud app: import a PDF, DOCX, or a photo of a physical book page, and have it read aloud in a natural voice with the current word highlighted in sync, so you can follow along or glance up and find your place instantly. Tapping any word jumps both the highlight and the audio to that point. Documents live in a personal library with reading position saved automatically.

Finalized stack: **React + Vite installable PWA on Netlify**, talking to a **Node/Express API self-hosted on Deploro**, backed by **self-hosted Postgres + S3-compatible storage on Deploro**, using **ElevenLabs** for TTS with character-level timing and **Google Cloud Vision** for OCR.

## 2. Finalized Architecture

| Area | Decision | Why |
|---|---|---|
| TTS | ElevenLabs, `/v1/text-to-speech/{voice_id}/with-timestamps` | Only realistic option here that returns character-level `char_start_times_ms`/`char_end_times_ms` alongside the audio in one call — no separate alignment step. Best-in-class voice quality. Free tier is small (~10K chars/month), so cost needs tracking once past prototyping. |
| OCR | Google Cloud Vision, Document Text Detection | Purpose-built for dense printed text on photographed pages; handles skew/lighting reasonably and preserves reading order, which matters more here than raw character accuracy. Cheap at personal-use volume. |
| Platform | Installable PWA (single React + Vite codebase) | One codebase covers desktop and mobile. Browser camera input (`<input type="file" accept="image/*" capture>`) covers the scan-a-book-page use case without a native app build/store overhead. "Add to Home Screen" gives an app-like feel for a personal tool. |
| Backend | Node/Express, self-hosted on Deploro | Avoids serverless execution-time limits — TTS generation, OCR calls, and chunk processing can run long, especially on first-chunk-through-full-document generation. Matches the pattern used by AmpedClock, Amped Cadence, and PX Dispatch. |
| Database | Postgres, self-hosted on Deploro | Consistent with existing self-hosted infra; full control over backups/migrations alongside other projects. |
| File/audio storage | S3-compatible storage on Deploro (e.g. Hetzner) | Same rationale as database — keeps original uploads and generated audio files under the same self-hosted footprint rather than introducing a managed dependency. |
| Frontend hosting | Netlify | Matches the PRD's stated default and the user's usual deployment pattern; doesn't conflict with a self-hosted backend since the PWA just calls the Deploro API over HTTPS. **Flagging this as an assumption** — confirm or override if you'd rather serve the frontend from Deploro too for a fully single-host setup. |

## 3. System Flow

```
[PWA — Netlify]
  ├─ Upload PDF/DOCX, or capture/upload a book-page photo
  ├─ Playback UI: <audio> element + text column + controls
  │
  ▼  HTTPS
[Express API — Deploro]
  ├─ Text extraction: pdf.js / mammoth.js (PDF/DOCX), or forwards photo to OCR
  ├─ OCR: Google Cloud Vision → structured text
  ├─ Chunking: split extracted text into sentence/paragraph-sized chunks
  ├─ TTS: ElevenLabs with-timestamps per chunk → audio (MP3) + char-level timing
  ├─ Persists: chunk text, audio file, timing JSON
  │
  ▼
[Postgres — Deploro]              [S3-compatible storage — Deploro]
  documents, chunks (metadata,      original uploads, generated
  timing_data JSON), voices,        audio files per chunk
  reading_sessions
  │
  ▼
[PWA — Netlify]
  ├─ Fetches audio + timing_data per chunk, caches them
  ├─ On <audio> `timeupdate`, matches playback time → timing_data →
  │   current char range → current word → updates highlight in the DOM
  └─ Tap-to-jump: tapped word → its char offset → nearest timestamp in
      timing_data → seek <audio>.currentTime → resume playback
```

Chunking is generation-time (first chunk generated immediately so playback starts fast; later chunks generated in the background) and also the natural seek/cache boundary — each chunk is one audio file + one timing blob.

## 4. Data Model

Implemented in `backend/src/db/schema.sql` (source of truth — keep this section in sync with it):

- **documents**: `id`, `title`, `source_type` (`pdf` | `docx` | `txt` | `epub` | `scan` | `url`), `original_file_key` (bucket key, not a generic URL), `voice_id` (FK → voices), `status` (`processing` | `ready` | `error`), `error_message`, `last_position` (JSON: `{chunkSequenceIndex, timeSeconds}`), `summary` (Phase 4, cached on first generation), `created_at`
- **chunks**: `id`, `document_id`, `sequence_index`, `text_content`, `status` (`pending` | `ready` | `error`, tracks per-chunk background generation), `audio_key` (bucket key), `timing_data` (JSON: `{words: [{word, charStart, charEnd, startMs, endMs}]}`), `duration_seconds`
- **voices**: `id`, `provider` (`elevenlabs`), `provider_voice_id`, `display_name`
- **reading_sessions**: defined in the schema for future history-beyond-last-position use; not yet written to by any route — `documents.last_position` covers resume for v1.

Object storage note: `putObject`/`getObjectBuffer` (`backend/src/storage/index.ts`) fall back to local disk under `backend/storage/` when `S3_*` env vars are unset, so the app runs before Deploro object storage is provisioned. Same idea for the database — `docker-compose.yml` at the repo root brings up a local Postgres for development ahead of the Deploro instance.

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

All of Phase 1–4 above is built (`backend/src/`, `frontend/src/`) except multi-device sync (see note above). What's still required before it runs against real infrastructure:

- Fill in `backend/.env` (copied from `.env.example`): `ELEVENLABS_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, and either `DATABASE_URL` pointed at a running Postgres or leave `S3_*` blank for local disk storage.
- Install [Ollama](https://ollama.com), run `ollama pull gemma4` (or a variant: `gemma4:e2b`/`e4b`/`26b`/`31b`), and `ollama serve` — `OLLAMA_BASE_URL`/`OLLAMA_MODEL` in `.env` default to `http://localhost:11434`/`gemma4`.
- Bring up Postgres — `docker compose up -d` at the repo root (local dev) or point `DATABASE_URL` at Deploro — then run `npm run migrate` in `backend/`.
- Everything was verified via `tsc --noEmit`/`tsc -b` on both projects, a clean `vite build` (PWA/workbox config), and isolated logic tests (chunking, ElevenLabs word-boundary derivation, sentence grouping) run without any live API keys or database. Routes that need Postgres, ElevenLabs, Cloud Vision, or Ollama have **not** been exercised end-to-end against real provider responses — do that once keys are filled in and Ollama is running.

## 6. Environment/Secrets Checklist

- [ ] ElevenLabs API key → `backend/.env` `ELEVENLABS_API_KEY`
- [ ] Google Cloud Vision service account credentials → `GOOGLE_APPLICATION_CREDENTIALS` (path to the JSON key)
- [ ] Ollama running locally with `gemma4` pulled → `OLLAMA_BASE_URL`/`OLLAMA_MODEL` (Phase 4 summarize/Q&A, no API key)
- [ ] Postgres reachable → `DATABASE_URL` (local: `docker compose up -d` + `npm run migrate`; production: Deploro connection string)
- [ ] S3-compatible bucket (optional until then) → `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`; leave blank to use local disk storage under `backend/storage/` in the meantime
- [ ] Netlify site created and linked for the frontend build
- [ ] Deploro Express API deployment target set up, with the above secrets injected server-side only (never shipped to the PWA client)

## 7. Open Flags

- **Frontend hosting on Netlify is an assumption**, not something explicitly re-confirmed in this round of questions — flag if you'd rather host it on Deploro too.
- **OCR accuracy on real book photos** is the single biggest technical unknown. Test Cloud Vision against a handful of real scanned pages (varied lighting, angle, font) early, before the Phase 2 pipeline is locked in.
- **Chunking strategy** (sentence-level vs. paragraph-level) affects both cost and highlight smoothness — worth a quick prototype of both before committing in Phase 1.
- **TTS cost at real usage volume**: ElevenLabs' free tier (~10K characters/month) is small. Model expected pages/month early so paid-tier budgeting isn't a mid-build surprise.
- **Scope creep**: the PRD explicitly calls out the temptation to add podcast generation, Q&A, or dictation early, since that's the direction Speechify itself sprawled in. Hold the Phase 1–3 line until the core reading experience feels solid.

## 8. Success Criteria (from the PRD, unchanged)

- Upload a real PDF or DOCX you actually need to read and listen through it start to finish without the highlighting drifting out of sync.
- Scan a physical book page and get usable audio from it, even if OCR isn't perfect on the first pass.
- You'd genuinely reach for this over Speechify itself for personal reading, even in a rough v1 state.
