# Product

## Register

product

## Users

Caleb, the sole user. Personal read-aloud tool, not a shared or multi-tenant product. Primary context is at a desk (working/studying sessions, bright screen, sustained reading), with secondary use on the go. The job: import a PDF/DOCX/scanned book page, listen to it read aloud, follow the current word highlighted in sync, and tap any word to jump playback there.

## Product Purpose

Verbis isolates the one feature that matters from Speechify's sprawling suite: import a document, listen, follow along with synced highlighting. It exists because Speechify bundles that core loop with a broad feature surface (podcasts, dictation, meeting notes, voice cloning) the user doesn't want. Success is a tight, fast, single-purpose reader the user reaches for over Speechify itself, even in a rough state.

## Brand Personality

Literary and warm, not tool-cold. Should feel like a well-made e-reader, not a dashboard: paper-like calm, generous reading typography, a sense of care in how text sits on the page. Personality in three words: **calm, literary, unhurried.** The chrome (playback bar, controls, library grid) should recede; the document text is the hero.

## Anti-references

- Speechify's own UI: cluttered feature surface, everything competing for attention, no restraint.
- Generic SaaS dashboard patterns: hero-metric tiles, identical card grids, side-stripe accent borders, gradient text, glassmorphism-as-decoration.
- Cold, clinical "tool" aesthetics (Linear/Raycast-style terminal precision) — too sterile for a reading app whose whole point is unhurried, literary reading.

## Design Principles

1. **Text is the hero, chrome recedes.** Reading surface (document text, highlighting) gets the visual weight; playback bar, nav, and settings stay quiet and secondary.
2. **Calm over clever.** No unnecessary motion, no competing accents. One clear affordance per screen at a time.
3. **Highlighting is the one place color earns its keep.** The synced-highlight accent is the product's signature interaction — everywhere else, restraint.
4. **Desk-first, not phone-first chrome.** Primary use is a bright screen at a desk during focused sessions; light should be a first-class default, not an afterthought, while dark stays fully supported for evening use.
5. **Single-user simplicity.** No multi-tenant scaffolding, no feature bloat from the non-goals list (voice cloning, podcasts, dictation, meeting notes) — resist SaaS-style feature surfacing creeping into the UI.

## Accessibility & Inclusion

No stated special accommodation needs beyond standard care. WCAG AA contrast minimum, since sustained reading is the core use case and eye strain matters more here than in a typical app. Respect `prefers-reduced-motion`. Tap targets sized for both mouse and touch (book-scan/import flow is used from a phone camera).
