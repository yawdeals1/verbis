# AGENTS.md

Instructions for AI coding agents working in this repository. Companion to `CLAUDE.md` (equivalent guidance for Claude Code specifically) — the two should stay in sync. See `verbis-prd.md` for full product requirements and `PRODUCT_PLAN.md` for the finalized architecture, data model, and build phases.

## Project

Verbis — a personal read-aloud app for PDFs, Word docs, and scanned book pages, with TTS playback and synced word-level highlighting. Single user, no auth. Core loop: import → extract text → generate TTS audio + timing data → play back with synced highlighting → tap-to-jump → resume where you left off.

## Stack

- Frontend: React + Vite, installable PWA, served by nginx via Deploro VPS compute (`deploro.compose.yml`).
- Backend: Node/Express, self-hosted on Deploro VPS compute (needs a real Node runtime — `@google-cloud/vision`, `jsdom`, and local-disk storage don't run on Deploro's Cloudflare Worker path).
- Database: Deploro's per-project Studio REST API (`backend/src/db/studioClient.ts`), not a direct Postgres connection. Same database for local dev and production — both point at the same Deploro-hosted `verbis` project.
- Storage: Deploro project storage (R2) in production for originals + generated audio, over its HTTP storage API (`backend/src/storage/deploroStorage.ts`), selected by `DEPLORO_STORAGE_URL`. Falls through to an S3-compatible bucket when the `S3_*` vars are set, then to local disk under `backend/storage/`, so the app runs with no storage infra at all. Deploro reaches R2 through a Cloudflare Workers binding and issues no S3 keys for it — do not try to configure it as an `S3_ENDPOINT`.
- TTS: ElevenLabs (`with-timestamps` endpoint — character-level alignment).
- OCR: Google Cloud Vision (Document Text Detection).
- Summarization/Q&A (Phase 4): local Ollama model (default `gemma4`, configurable via `OLLAMA_MODEL`/`OLLAMA_BASE_URL`) — no API key, no per-token billing.

Do not substitute any of these providers or hosting targets without discussing it first — see `PRODUCT_PLAN.md` §2 for why each was chosen.

## Setup / Build / Test

1. One-time, via the Deploro CLI: `deploro use verbis`, `deploro db create`, `deploro migrate create init --up-file backend/src/db/schema.sql` + `deploro migrate apply init`, then `deploro token create verbis-backend --read --write --project verbis` for a `DEPLORO_API_TOKEN` (needs both scopes — write-only fails on every read call).
2. `cd backend && npm install`, copy `.env.example` to `.env` (or edit the existing `.env`) and fill in `ELEVENLABS_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `DEPLORO_API_URL` (`<deploro baseUrl>/api/projects/<id>/studio`), `DEPLORO_API_TOKEN`, and `DEPLORO_STORAGE_URL` (the same URL *without* `/studio` — storage routes are siblings of the Studio API, and writes need a project-admin token). Leave `DEPLORO_STORAGE_URL` and `S3_*` blank to use local disk storage instead.
3. Install [Ollama](https://ollama.com), run `ollama pull gemma4` (or a variant: `gemma4:e2b`/`e4b`/`26b`/`31b`), and start it with `ollama serve`. `OLLAMA_BASE_URL`/`OLLAMA_MODEL` in `.env` default to `http://localhost:11434`/`gemma4`.
4. `npm run dev` (backend/) — starts the API on `PORT` (default 3001). `npm run typecheck` / `npm run build` also available.
5. `cd frontend && npm install && npm run dev` — starts the Vite dev server (default 5173), reading `VITE_API_BASE_URL` from `frontend/.env`. `npx tsc -b` typechecks, `npm run build` produces the PWA build.

No automated test suite yet — verification today is `tsc`/`tsc -b` on both projects, a `vite build` to validate the PWA/workbox config, targeted `tsx` smoke scripts for pure logic (chunking, word-boundary derivation, sentence grouping), and a live smoke test of every `db/*.ts` function against the real Deploro `verbis` project (full CRUD + JSONB round-trip + upsert emulation, all confirmed working). Add real tests here as they're introduced, and keep this section current — an agent should be able to get a working dev environment running from this file alone, without guessing.

## Coding Standards

- No comments explaining *what* code does — clear naming should make that unnecessary. Comments only for non-obvious *why* (provider quirks, workarounds, subtle invariants).
- No speculative abstractions: don't build provider-swap interfaces, config layers, or feature flags for things not in the current build phase.
- No auth/multi-tenant scaffolding — single-user personal tool for v1 (see PRD non-goals).
- Secrets (ElevenLabs key, Google Cloud Vision credentials, DB/storage credentials) live server-side only, injected into the Deploro-hosted API. Never ship them to the PWA client or commit them to the repo.

## Architectural Rules (must-follow)

1. **Character-level timing → word boundaries derived, not assumed.** ElevenLabs returns per-character `char_start_times_ms`/`char_end_times_ms`. Split source text on whitespace, track character offsets, and map those offsets onto the returned timing to get word-level highlight boundaries.
2. **Chunk-scoped audio and timing.** Text is split into sentence/paragraph-sized chunks before TTS generation; each chunk has exactly one audio file and one timing blob, stored together. Seeking/tap-to-jump within a chunk uses that chunk's timing data; jumping to a different chunk means loading that chunk's audio first.
3. **First chunk fast, rest in background.** Target under 5-8 seconds from upload to audio start: generate/return chunk 1 first, generate subsequent chunks asynchronously while playback continues.
4. **Generate once, cache forever.** Never re-run TTS or OCR for content already processed — both are metered, billed APIs. Re-listening to a document must not re-trigger synthesis.
5. **Storage is key-based, not URL-based.** `documents.original_file_key` and `chunks.audio_key` reference objects in the storage backend (Deploro project storage, an S3-compatible bucket, or local disk — see `backend/src/storage/index.ts`); access is mediated through the API, not public URLs. The Deploro bucket is private on purpose and reads are proxied by our own routes: `originals/` holds user-uploaded PDFs, and Deploro's public-read switch is per-project rather than per-folder, so turning it on for audio streaming would expose those PDFs to anyone holding a UUID.
6. **No raw SQL — go through `db/studioClient.ts`.** The backend talks to Deploro's Studio REST API, not a direct Postgres connection. No server-side sort (sort client-side after fetching) and no native upsert (filter-lookup then update-or-insert — see `upsertVoice` in `db/voices.ts`). Response bodies are wrapped: `{ row: {...} }` for single-row endpoints, `{ rows: [...], total }` for lists — don't assume the bare object.

## Data Model

See `PRODUCT_PLAN.md` §4: `documents`, `chunks` (includes `timing_data` JSON), `voices`, `reading_sessions`. Update that doc alongside any schema change so it stays the source of truth.

## Build Phase Order

Work in phase order from `PRODUCT_PLAN.md` §5 — do not start Phase 2 (camera scan + OCR) or later work before Phase 1 (PDF/DOCX import, TTS + alignment, synced highlighting, playback controls, tap-to-jump, library + resume) is solid end to end. Synced highlighting is the feature the whole product depends on; validate it on the simplest input path before adding OCR variability on top.

## PR / Change Expectations

- Keep changes scoped to the active build phase; flag if a change appears to require pulling in later-phase scope.
- Any change touching the TTS or OCR integration should be validated against real documents/photos, not just synthetic test strings — timing drift and OCR misreads mostly show up on real-world input.
- Note any change to the data model or provider choice in `PRODUCT_PLAN.md` so it doesn't silently drift out of sync with the code.

## Known Open Risks

- OCR accuracy on real handheld book photos (varied lighting/angle/font) is unvalidated — test early in Phase 2 rather than trusting quoted provider accuracy.
- Chunking granularity (sentence vs. paragraph) is a cost/smoothness tradeoff, not yet settled by prototyping.
- ElevenLabs free tier (~10K characters/month) is small — usage tracking matters once past initial prototyping.
