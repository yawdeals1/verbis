# AGENTS.md

Instructions for AI coding agents working in this repository. Companion to `CLAUDE.md` (equivalent guidance for Claude Code specifically) — the two should stay in sync. See `verbis-prd.md` for full product requirements and `PRODUCT_PLAN.md` for the finalized architecture, data model, and build phases.

## Project

Verbis — a personal read-aloud app for PDFs, Word docs, and scanned book pages, with TTS playback and synced word-level highlighting. Single user, no auth. Core loop: import → extract text → generate TTS audio + timing data → play back with synced highlighting → tap-to-jump → resume where you left off.

## Stack

- Frontend: React + Vite, installable PWA, deployed to Netlify.
- Backend: Node/Express, self-hosted on Deploro.
- Database: Postgres, self-hosted on Deploro.
- Storage: S3-compatible storage on Deploro (originals + generated audio).
- TTS: ElevenLabs (`with-timestamps` endpoint — character-level alignment).
- OCR: Google Cloud Vision (Document Text Detection).

Do not substitute any of these providers or hosting targets without discussing it first — see `PRODUCT_PLAN.md` §2 for why each was chosen.

## Setup / Build / Test

Repo currently contains only planning docs (`verbis-prd.md`, `PRODUCT_PLAN.md`, this file, `CLAUDE.md`) — no code yet. As Phase 1 code lands, this section should be filled in with the real commands, e.g.:

- Frontend: `npm install` / `npm run dev` / `npm run build` from the frontend package.
- Backend: `npm install` / `npm run dev` / `npm test` from the backend package.
- Keep this section current — an agent should be able to get a working dev environment running from this file alone, without guessing.

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
5. **Storage is key-based, not URL-based.** `documents.original_file_key` and `chunks.audio_key` reference objects in the self-hosted S3-compatible bucket; access is mediated through the API, not public URLs.

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
