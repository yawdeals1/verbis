# Product Requirements Document: Verbis

**A personal read-aloud app for PDFs, Word docs, and scanned books, with synced text highlighting**

| Field | Value |
|---|---|
| Author | Caleb Mensah |
| Status | Draft v1.2 |
| Date | August 13, 2026 |
| Name | Verbis |
| Domain | verbis.com (confirmed available, premium-priced) |

---

## 1. Problem Statement

Reading long PDFs, Word documents, and physical books takes sustained visual focus and time that could be spent multitasking (commuting, working out, doing chores) or is harder to sustain for long study/work sessions. Speechify solves this at scale for 60M+ users, but it is a subscription product with a broad feature surface (podcasts, dictation, meeting notes, voice cloning) that goes well beyond the core need: **import a document, listen to it, and follow along with synchronized highlighting.**

Verbis is a personal-use build that isolates that core loop, built and owned end to end, with room to extend later.

## 2. Goals

- Import a PDF or Word document and have it read aloud in a natural-sounding voice.
- Scan pages from a physical book (camera or photo upload) and have that content read aloud too.
- Highlight the current word or sentence in sync with the audio as it plays, matching what Speechify's "Text Highlighting" feature does.
- Control playback: play, pause, skip, adjust speed, change voice.
- Keep a personal library of imported documents with reading position saved, so returning to a document resumes where it left off.

### Non-Goals (explicitly out of scope for v1)

- AI voice cloning, dubbing, or celebrity voices.
- Podcast generation from documents.
- Voice typing / dictation.
- AI meeting notes or transcription.
- Multi-user accounts, teams, or billing (this is a personal tool first).
- A "voice AI assistant" that answers questions about the document (possible v2+ feature, not v1).

Keeping the non-goals explicit matters here. Speechify's actual product has sprawled into a full voice-AI suite; the value in building your own version is a tight, fast, single-purpose reader.

## 3. Target User

You, first. Secondary framing (if this ever gets shared or shown off): students and professionals who want to consume long documents hands-free while doing something else, without paying for features they won't use.

## 4. Core User Stories

1. As a user, I can upload a PDF or DOCX file and start listening within a few seconds.
2. As a user, I can point my phone camera (or upload a photo) at a physical book page and have that text extracted and read aloud.
3. As a user, while audio plays, I can see the current word or sentence highlighted in the document view, in sync with what I'm hearing.
4. As a user, I can pause and rewind playback at any time.
5. As a user, I can select any word in the transcript and have both the transcript highlight and the audio jump to that word, with playback resuming from there.
6. As a user, I can increase my reading speed during playback.
7. As a user, I can pick from a small set of natural-sounding voices.
8. As a user, I can close the app and come back later to the same document, resuming from where I left off.
9. As a user, I can see a library of everything I've previously imported.

## 5. Feature Requirements

Prioritized as P0 (MVP, must ship), P1 (fast follow), P2 (later).

### P0: MVP

| Feature | Detail |
|---|---|
| Document import | Upload PDF and DOCX. Extract clean text while preserving paragraph/page structure. |
| Physical book scan | Camera capture or photo upload, run through OCR, output structured text. |
| Text-to-speech playback | Convert extracted text to audio using a TTS API with word-level timing data. |
| Synced highlighting | Highlight the current word (or sentence, as a simpler fallback) as audio plays, using timing data from the TTS provider. |
| Playback controls | Play, pause, rewind, speed control (0.5x-3x and up). |
| Tap-to-jump | Selecting a word in the transcript jumps both the transcript highlight and the audio to that word, and playback resumes from that point. Requires resolving the tapped word back to its character offset, then to the corresponding timestamp in the chunk's alignment data, then seeking the `<audio>` element to that timestamp. |
| Basic voice selection | 3-5 voice options from the chosen TTS provider. |
| Personal library | List of imported documents, each with a thumbnail/title and last-read position. |
| Resume position | Reading position is saved automatically and restored on reopen. |

### P1: Fast follow

- EPUB and TXT import.
- Web page import via URL (paste a link, strip to readable text, similar to a reader-mode extraction).
- Offline listening (pre-generate and cache audio for a document).
- Adjustable highlight granularity (word vs. sentence vs. off).
- Dark mode / reading themes.

### P2: Later

- Summarization of the current document.
- Simple Q&A grounded in the document you're listening to.
- Multi-device sync (if you ever want this on more than one device/account).
- Additional/expanded language support.

## 6. The Hard Part: Synced Highlighting

This is the feature that makes or breaks the product, and it's worth specifying precisely because it determines your TTS provider choice.

To highlight text in sync with audio, you need **timing data that maps each word (or character range) in the source text to a timestamp in the generated audio.** Not every TTS API provides this by default. The realistic options, evaluated for this exact need:

| Provider | Timing data | Notes |
|---|---|---|
| ElevenLabs (chosen) | Character-level alignment via `/v1/text-to-speech/{voice_id}/with-timestamps` | Returns `char_start_times_ms` / `char_end_times_ms` for every character alongside the audio. A streaming variant exists too. Best-in-class voice naturalness; free tier is small (~10K characters/month), so budget for paid usage once you're past prototyping. |
| Amazon Polly | Speech Marks (word-level timestamps) | Purpose-built for this exact use case, mentioned here only as a fallback/comparison since ElevenLabs is the chosen provider. |
| Google Cloud TTS | Timepoints via SSML `<mark>` tags | More manual to set up (you insert marks yourself), fallback option. |
| Microsoft Azure TTS | Word boundary events via the SDK | Broadest language/voice coverage if that becomes relevant later. |

**Decision:** ElevenLabs. The `with-timestamps` endpoint gives character-level start/end times directly in the response, no separate alignment call needed for the standard flow. Map those character ranges back to word boundaries in your own text (split on whitespace, track character offsets) to drive the highlight state, since the API gives you characters, not pre-grouped words.

Implementation pattern regardless of provider:
1. Send document text to the TTS API in chunks (sentence or paragraph-sized, to keep requests manageable and allow seeking).
2. Receive audio (MP3/WAV) plus timing data for each chunk.
3. Store both, keyed to the chunk.
4. On playback, use the browser's `<audio>` element `timeupdate` event, matched against the stored timing data, to determine which word index is "current" and update the highlight in the DOM.

## 7. Document Import and OCR Pipeline

| Input type | Extraction approach |
|---|---|
| PDF | `pdf.js` (client-side) or a server-side equivalent to extract text while preserving reading order. Scanned/image-only PDFs fall through to the OCR path below. |
| DOCX | `mammoth.js` to convert DOCX to clean HTML/text, preserving paragraph structure. |
| Physical book scan | Camera photo or upload, run through an OCR engine. |

OCR engine options:

| Option | Notes |
|---|---|
| Google Cloud Vision, Document Text Detection mode (chosen) | Purpose-built for dense printed text on a photographed page. Handles skew and uneven lighting reasonably well and preserves reading order, which matters more here than raw character accuracy. Per-image pricing with a free monthly allotment, low cost at personal-use volume. |
| Tesseract.js | Free, runs client-side or server-side, zero API cost. Worth a quick prototype early since it costs nothing, but accuracy on real handheld camera photos (curved pages, glare, blur) tends to disappoint compared to Cloud Vision. Good for validating the pipeline shape, not what to ship with. |
| Vision LLM (Claude, GPT-4o, Gemini) as extraction engine | Reads messy photos well and reconstructs structure intelligently, but carries a real risk of paraphrasing or subtly rewording text rather than transcribing verbatim on harder scans. For a tool whose job is reading the actual book back to you, that's a meaningful failure mode. Worth keeping only as a fallback cleanup pass on low-confidence regions flagged by Cloud Vision, not as the primary extraction path. |
| AWS Textract | Comparable tier to Cloud Vision. No longer has a natural pull toward it now that TTS is on ElevenLabs rather than Polly, so no reason to prefer it over Cloud Vision. |

**Decision:** Google Cloud Vision, Document Text Detection. Test it early against a handful of real scanned book pages (varied lighting, angle, font) before locking in the OCR-to-reader pipeline, since this is the step most likely to need tuning.

## 8. Non-Functional Requirements

- **Latency:** Time from "upload document" to "audio starts playing" should be under 5-8 seconds for a typical document page. Achieve this by generating audio for the first chunk immediately and streaming/generating subsequent chunks in the background while playback continues.
- **Accuracy:** OCR and text extraction should preserve reading order and avoid mangling paragraph breaks, since broken text extraction breaks both the audio and the highlighting.
- **Cost control:** TTS and OCR are metered APIs. Cache generated audio per document so re-listening never re-triggers synthesis. Track your own usage against provider free tiers, especially while testing.
- **Privacy:** Documents you upload (and photos of book pages) may contain personal or sensitive content. Store them in your own database/storage rather than passing through third parties beyond the TTS/OCR providers themselves. No analytics or tracking needed for a personal tool.
- **Offline resilience (P1):** Once audio is generated for a document, it should be playable without a live connection to the TTS provider, since the audio file itself is already generated and cached.

## 9. Proposed Technical Architecture

Matched to your existing stack for speed of execution and to avoid introducing new infrastructure to maintain.

- **Frontend:** React + Vite. Single-page app with three main views: Library, Reader (the core playback + highlighting screen), and Import/Scan.
- **Backend:** Node.js/Express, handling document upload, calling the TTS/OCR provider APIs, and chunk/timing storage logic. Keeps API keys server-side rather than exposed in the client.
- **Database:** Postgres (Supabase, or self-hosted on your Deploro infrastructure, consistent with your other projects). Stores documents, chunks, timing data references, and reading position.
- **File/audio storage:** Supabase Storage (if using Supabase) or S3-compatible storage on Hetzner, for the original uploaded files and generated audio files.
- **Hosting:** Netlify for the frontend, matching your usual deployment pattern. Backend on your existing Deploro infrastructure if you want everything self-hosted, or as Netlify Functions if you want to keep it simpler for a personal tool.

This mirrors the stack you already use for AmpedClock, Amped Cadence, and PX Dispatch, so most of the plumbing (auth, storage, deployment) should be close to a copy-paste starting point rather than new territory.

## 10. Data Model (Outline)

- **documents**: id, title, source_type (pdf/docx/scan), original_file_url, created_at, last_position, status (processing/ready/error)
- **chunks**: id, document_id, sequence_index, text_content, audio_url, timing_data (JSON: word-to-timestamp map), duration_seconds
- **voices**: id, provider, provider_voice_id, display_name
- **reading_sessions** (optional, for resume tracking if you want history beyond "last position"): id, document_id, chunk_id, word_index, updated_at

## 11. UX Flow

1. **Library** (home screen): grid or list of imported documents, each showing title, a progress indicator, and last-read timestamp. A prominent "+" for new import.
2. **Import flow:** choose file upload (PDF/DOCX) or scan (camera/photo upload). Show a processing state while text extraction and first-chunk audio generation happen.
3. **Reader screen:** document text displayed in a clean, readable column. Current word/sentence highlighted as audio plays. Playback bar fixed at the bottom: play/pause, skip back/forward, speed control, voice selector, progress scrubber.
4. Tapping/clicking any word in the text jumps both the highlight and the audio to that word, and playback resumes from there. This is a core requirement, not a nice-to-have, since it's the main way a user corrects or navigates their position while reading.

## 12. Build Phases

**Phase 1: Core loop (MVP)**
PDF/DOCX import, text extraction, ElevenLabs TTS integration with character-level alignment, word highlighting, playback controls (play, pause, rewind, speed), tap-to-jump, library with resume position.

**Phase 2: Scan support**
Camera/photo capture, Google Cloud Vision OCR pipeline, integrate scanned text into the same reader flow as PDF/DOCX.

**Phase 3: Polish and offline**
EPUB/TXT support, offline audio caching, reading themes, tap-to-jump refinement.

**Phase 4: Optional expansion**
Summarization, lightweight document Q&A, multi-device sync, if the tool earns its keep and you want to grow it past personal use.

## 13. Risks and Open Questions

- **OCR accuracy on real book photos** is the biggest unknown. Test Cloud Vision against a few real scanned pages (varied lighting, angles, fonts) early, and decide whether a fallback cleanup pass is worth the added complexity.
- **Chunking strategy** affects both cost and highlighting smoothness. Sentence-level chunks make seeking/highlighting simpler; paragraph-level chunks reduce API call volume. Worth prototyping both.
- **TTS cost at real usage volume** should be modeled once you know roughly how many pages/month you expect to read. ElevenLabs' free tier is small (~10K characters/month), so this is worth checking early rather than discovering it mid-build.
- **Scope creep risk:** the temptation to add podcast generation, Q&A, or dictation early is real, given that's where Speechify itself has expanded. Recommend holding the line on the Phase 1-3 scope until the core reading experience feels solid.

## 14. Success Criteria for v1

- You can upload a real PDF or DOCX you actually need to read and listen through it start to finish without the highlighting drifting out of sync.
- You can scan a physical book page and get usable audio from it, even if OCR isn't perfect on the first pass.
- You'd genuinely reach for this over Speechify itself for personal reading, even in a rough v1 state.
