# Design

Visual system for Verbis, generated from the implemented frontend (`frontend/src/index.css`). Register: product (see `PRODUCT.md`). Color strategy: Restrained — tinted neutrals throughout, with the warm accent reserved for the reading highlight, primary actions, and state indicators.

## Theme

Light-first (desk/bright-screen is the primary use context per PRODUCT.md), with a fully-supported dark theme for evening reading. Toggled via a header button cycling system → light → dark → system, persisted to `localStorage` (`verbis:theme`) and applied via `data-theme` on `<html>`, overriding `prefers-color-scheme` in both directions.

## Color (OKLCH)

All neutrals carry a faint warm tint (hue 75) rather than true gray/black/white, to read as paper rather than a dashboard.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `oklch(98.2% 0.006 75)` | `oklch(19% 0.012 75)` | Page background |
| `--bg-raised` | `oklch(99.4% 0.004 75)` | `oklch(23% 0.013 75)` | Cards, playback bar, header |
| `--surface` | `oklch(95.3% 0.008 75)` | `oklch(24.5% 0.013 75)` | Panels, code, badges, segmented-control track |
| `--border` / `--border-strong` | `oklch(89%/80% ... 75)` | `oklch(32%/41% ... 75)` | Hairlines / emphasized hairlines |
| `--text` / `--text-muted` / `--text-h` | body / secondary / heading ink | same hue, lighter in dark | Type hierarchy |
| `--accent` / `--accent-strong` | `oklch(58%/50% 0.15/0.16 45)` | `oklch(74%/80% 0.13 55)` | Reading highlight, primary buttons, progress, active states — the one place color is bold |
| `--danger`, `--warning`, `--success` | semantic reds/ambers/greens at matching lightness/chroma | | Error states, processing badges, ready badges |

Each has a paired `-bg` (10–16% alpha wash) and `-border` variant for badges/panels instead of solid fills.

## Typography

- **`--font-serif`**: `Literata` (Google Fonts, loaded in `index.html`), falling back to Georgia/Iowan Old Style. Used for all headings (`h1`–`h3`) and the document reading surface (`.chunk-text`) — Literata is Google's typeface purpose-built for on-screen long-form book reading, a direct match for what Verbis does.
- **`--font-sans`**: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui`). Used for all UI chrome — nav, buttons, labels, forms, meta text — per product-register convention (no display fonts in interactive labels).
- Base size 16px/1.55. Reading column (`.reader`, `.chunk-text`) capped at `--content-width: 42rem` (~65–70ch).

## Layout

- `--shell-width: 76rem` bounds the app shell (header + main); no fixed boxed border-inline (the old Vite-starter look).
- Reader column narrower (`--content-width`) than Library/Import, since prose line length matters there specifically.
- Spacing/radius scale: `--radius-sm/md/lg/pill` (7/12/18/999px), used consistently across buttons, inputs, cards, badges.

## Motion

`--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`, durations 140ms (`--dur-fast`, hover/press feedback) and 220ms (`--dur`, reveals, progress fill, chunk opacity). Only `opacity`, `background-color`, `border-color`, `box-shadow`, `transform` are animated — never layout properties. Respects `prefers-reduced-motion`.

## Components

- **Buttons**: `.btn` base + `.btn-primary` (filled accent), `.btn-secondary` (outlined), `.btn-ghost` (text-only, hover fill), `.btn-danger-ghost`, `.btn-icon` (circular icon button). Consistent across every screen.
- **Segmented control** (`.segmented`): pill-shaped tab group, reused for Import's mode picker and Reader's Page/Text toggle.
- **Badges** (`.badge` + `-ready`/`-processing`/`-error`): status indicators in the Library grid, replacing colored borders/status text.
- **Icons**: hand-rolled inline SVGs in `frontend/src/components/icons.tsx` (stroke-based, 1.8px stroke, `currentColor`) — no icon library dependency. Used for playback transport, theme toggle, delete, upload/camera/link, chevron, sparkle.
- **Dropzone** (`.dropzone`): styled wrapper around a native `<input type="file">` (opacity-0, positioned over the visible zone) — keeps native file-picker behavior/accessibility, just restyled.
- **Reading surface**: active chunk at full opacity, other chunks dimmed to 0.5 (a soft "spotlight" on the currently-playing section) instead of the previous side-border treatment (a banned pattern). Word/sentence highlight uses `--accent-bg` + bold weight.
- **Playback bar**: floating rounded panel (`.playback-bar`, sticky/fixed to viewport bottom), circular filled play/pause button as the visual anchor, icon buttons for transport, native `<input type="range">` with `accent-color`.

## Anti-patterns removed

- Fixed 1126px boxed shell with visible left/right border-inline (leftover Vite starter chrome).
- Purple (`#aa3bff`) SaaS-accent — replaced with a warm terracotta/amber that matches the literary brief.
- Side-stripe `border-left` on the active reading block (shared-design-law ban) — replaced with the opacity spotlight above.
- Emoji glyphs (⏮ ⏪ ▶ ⏩ ⏭) as playback icons — replaced with consistent inline SVGs.
- Raw unstyled `role="tablist"` buttons and native `<input type="file">` for Import — replaced with the segmented control and dropzone.
- Always-visible red-text delete link on every Library card — now an icon button revealed on hover/focus.
