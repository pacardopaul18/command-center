# Command Center Design System

A design system for a private operations command center: a calm, focused web app one person uses to run a small consulting firm. A personal cockpit that catches everything that would otherwise slip. Built for the web (target stack: SvelteKit on Cloudflare); everything here uses standard web patterns, no exotic components.

**Sources:** brand and product brief pasted in chat (no Figma, no codebase, no font binaries, no logo provided). Palette, type, navigation, and screen inventory come verbatim from that brief.

**No logo exists.** The brand mark is the app name set in DM Sans bold. Do not invent a mark.

## Content fundamentals
- Tone: plain, calm, professional. Short declarative sentences. No hype, no exclamation points.
- **No em dashes anywhere.** Use commas or periods.
- No emoji.
- Second person is avoided; UI copy is label-like ("Overdue", "Due today", "What will slip"). Empty states speak plainly and tell the user what to do first: "No action items yet. Add one with quick add, or press N."
- Sentence case for everything, including buttons and headings ("Create action item", not "Create Action Item").
- Numbers, dates, timestamps, IDs, and codes are set in DM Mono ("INV-2041", "Aug 29", "3.5 h").
- Status vocabulary is fixed: on track, at risk, blocked, done, overdue, waiting, open.

## Visual foundations
- **Color:** navy #102A4C is the primary (sidebar, primary buttons, headings when emphasized). Gold #C9A84C is the only accent and carries meaning: at risk, overdue, aging alerts. Green #2E7D5B means positive, on track, done. Everything else stays quiet ink on cream and white. One accent carries status, never a rainbow. Page background is warm off-white (--surface-page), cards are white, callouts are cream #FAF6EC.
- **Type:** DM Sans for everything; DM Mono for small labels, numbers, timestamps, codes. Mono labels are 11px uppercase with .06em tracking. Base UI size 14px, body line-height 1.5.
- **Spacing:** 4px base scale (4/8/12/16/24/32/48/64). Generous whitespace; density comes from tables, not from cramming.
- **Corners:** 12px default (--radius-md), 16px for large cards and modals, 8px for inputs and small controls, pill for chips.
- **Borders and shadows:** thin 1px dividers (#E9E6DC). Cards have a 1px border plus a soft, low shadow (--shadow-card). No heavy elevation; --shadow-pop is reserved for popovers and dialogs.
- **Backgrounds:** flat color only. No gradients, no textures, no imagery, no illustrations.
- **Animation:** minimal. 120 to 180ms ease transitions on hover and focus only. No bounces, no entrance animations.
- **Hover:** rows and list items tint to --surface-hover; buttons darken one step (navy to navy-700 is inverted: hover uses --navy-700 lighter tone on dark, darker on light). Press: no scale effects, just the darker color.
- **Focus:** 3px soft navy ring (--focus-ring). Keyboard-first app; focus states are never suppressed.
- **Tables:** clean, thin horizontal dividers only, no vertical rules, no zebra by default (--surface-row-alt available). Mono for numeric columns, right-aligned.
- **Status chips:** small pill, tinted background plus dark foreground of the same hue, 11px mono uppercase. Gold family for at risk and overdue, green family for on track and done, navy and gray for the rest.
- **Layout:** persistent 224px navy sidebar on the left, content max-width 1200px, desktop first.

## Iconography
No icon set was provided. The system uses **Lucide** from CDN (thin 1.5px stroke, matches the calm aesthetic): `<script src="https://unpkg.com/lucide@latest"></script>` then `lucide.createIcons()`, or inline the SVGs. Icons are 16 to 18px, stroke currentColor, used sparingly: sidebar nav, quick add, table row actions. No emoji, no unicode glyph icons, no filled icon styles. This is a substitution; swap in a brand set if one arrives.

## Fonts
No font binaries were provided. `tokens/fonts.css` loads DM Sans and DM Mono from Google Fonts. If you have licensed font files, drop them in `assets/fonts/` and replace that file with @font-face rules.

## Index
- `styles.css` — global entry; imports everything in `tokens/`.
- `tokens/` — colors, typography, spacing, effects, fonts, base element styles.
- `guidelines/` — foundation specimen cards (Design System tab).
- `components/actions/` — Button, IconButton.
- `components/forms/` — Input, Select, FormField.
- `components/data/` — StatusChip, Card, DataTable.
- `components/shell/` — Sidebar, RelatedPanel.
- `ui_kits/command-center/` — full screens: Today, Action Items, Projects (list and detail), Invoicing, Login.
- `SKILL.md` — agent skill entry point.

## Intentional additions
None. The component inventory is exactly the brief's list: buttons, status chips, cards, tables, form fields, sidebar shell, related-record panel.
