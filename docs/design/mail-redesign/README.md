# Handoff: Mail page redesign (Command Center)

## Overview
A redesign of the Command Center Mail page focused on clickability. Two views in one prototype: the thread **list** (triage tabs, search, per-thread reclassify actions) and the **thread detail** (messages newest-first, attachments card, AI reply drafting). Every interactive element now has a visible affordance: borders, hover tints, link styling, chevrons, focus-able buttons.

## About the design files
The file in this bundle, `Mail Redesign.dc.html`, is a **design reference created in HTML**. It is a prototype showing intended look and behavior, not production code. Recreate it in the target codebase's environment (the product brief targets SvelteKit on Cloudflare) using its established patterns. The HTML file contains the full template markup (inline styles) and a logic class showing the intended state model; both are readable directly.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and hover states are final and follow the Command Center Design System tokens (included below). Recreate pixel-perfectly using the codebase's token variables.

## Design system
Uses the Command Center Design System. Fonts: DM Sans (UI), DM Mono (labels, numbers, timestamps, codes; 11px uppercase, .06em tracking). All colors below reference its tokens.

### Tokens used
- Navy primary: #102A4C (--navy), hover step #1C3A63 (--navy-700), #2E4E7E (--navy-500), tints #E8EDF4 (--navy-100), #F2F5F9 (--navy-50)
- Gold accent (status only): #C9A84C, #8A6D1E (--gold-600), #F6EED8 (--gold-100)
- Ink #1B2433, muted #5B6470, page bg #FDFCF8, cards #FFFFFF, callout cream #FAF6EC, hover tint #F5F4EE
- Borders: thin #E9E6DC, strong #D9D5C9
- Shadows: card = 0 1px 2px rgba(16,42,76,.04), 0 4px 12px rgba(16,42,76,.05)
- Radii: 8px inputs/buttons (--radius-sm), 12px (--radius-md), 16px large cards (--radius-lg), pill for chips
- Transitions: 120ms ease hover, 180ms base. Focus: 0 0 0 3px rgba(16,42,76,.14)
- Type sizes: 11px mono labels (--text-xs), 13px (--text-sm), 14px base, 15px (--text-md), 18px (--text-lg), 28px page title (--text-2xl)

### Category chip colors (mono 11px uppercase, pill, padding 3px 10px)
- URGENT: bg #F3E5C2 / fg #77590F
- IMPORTANT: bg #F6EED8 / fg #8A6D1E
- ROUTINE: bg #F2F5F9 / fg #2E4E7E
- NOISE: bg #F0EFEA / fg #5B6470
- ARCHIVED: bg #E8EDF4 / fg #102A4C

## Layout
- Persistent 224px navy sidebar (design-system Sidebar component), active item "Mail".
- Main content fills the remaining width, padding 32px 48px 64px, page scrolls vertically. No max-width cap (user requirement: fill the window).

## Screens

### 1. Mail list
- **Header row** (flex, space-between): H1 "Mail" (28px/700) + subline "775 threads from 865 messages. Read only. Archiving here does not touch Gmail." (13px muted). Right: **mailbox selector** styled as a button: white bg, 1px #D9D5C9 border, 8px radius, contains mono uppercase "MAILBOX" label, the email address, and a chevron-down icon. Hover: #F5F4EE.
- **Triage tabs**: segmented control. Container: white, 1px #E9E6DC border, 12px radius, 4px padding, card shadow, 4px gap. Tabs: Needs you 45, Urgent 3, Important 42, Routine 64, Noise 474, Everything 775. Each tab: padding 7px 14px, 8px radius, white-space nowrap, count in mono 11px. Active: navy bg, white text, count #9FB0C6. Inactive: transparent, ink text, hover #F2F5F9. Clicking filters the list by category.
- **Search row** (flex, 12px gap): Input (flex:1, min 280px, placeholder "Search subjects, senders and gists"), primary Search button, client Select (220px, options: Every client, Pearl Talent, Penbrothers, MacGray), and a ghost "Show archived (n)" button with archive icon (toggles archived rows, label flips to "Hide archived (n)").
- **Triage callout**: cream #FAF6EC, 1px border, 12px radius, 12px 16px padding: "192 threads have no triage yet. Run Summarise from Settings to sort them." + secondary sm button "Open settings".
- **Thread list card**: white, 1px border, 16px radius, card shadow, rows divided by 1px #E9E6DC.
  - Row clickable area (padding 14px 20px 4px, hover #F5F4EE, cursor pointer, opens thread): baseline flex with category chip, optional italic mono "edited", **title as link** (15px/600, color #1C3A63, underline appears on hover, flex:1), date mono 11px right, chevron-right icon.
  - Under title: sender line (13px muted), then gist (14px ink).
  - **Triage action row** (padding 10px 20px 14px): mono uppercase "NOT RIGHT?" label + pill buttons for the other three categories + Archive. Pills: white bg, 1px #D9D5C9 border, pill radius, padding 4px 12px, 13px/500 navy-700 text; hover bg #F2F5F9 + border #2E4E7E. Clicking reclassifies (updates chip) or archives (removes row); stopPropagation so the row does not open.
- Sort: newest first by date/time. Empty tab state: centered "No threads in this view. Pick another tab above."

### 2. Thread detail
- **Back**: ghost "← Back to mail" button (navy-700, hover #F2F5F9).
- **Header flex row** (space-between, wraps): left block (flex:1, min 420px) = title (28px/700), meta "3 messages · Aug 29, 8:15 PM to Aug 30, 12:13 AM", classification line (current chip + mono "CORRESPONDENCE" + "You set this. The model said urgent."), "CHANGE TO" + reclassify pill buttons (same pill style) + Archive, and the note "Archiving files it here. Your Gmail is untouched, because this app has no permission to change it."
- **Thread tools card** (right of header, 380px, white card, 16px radius, shadow):
  - Attachments header row (clickable, hover tint): paperclip icon, "3 attachments" as link text, total size mono ("312 KB"), rotating chevron. Expanded by default; toggles the file list.
  - File rows (1px top border each, hover tint): file icon, filename as link (13px/500 navy-700), size mono, 26px bordered download icon button. Sample files: Pearl Talent offer letter.pdf 214 KB, Onboarding checklist.pdf 96 KB, Renz Ama contact.vcf 2 KB. Footer row: ghost "Download all".
  - Bottom row: ghost buttons "Open in Gmail" (external-link icon) and "Copy summary" (copies summary text, label flips to "Copied" for 1.5s), right-aligned mono "2 people".
  - Threads without attachments show "No attachments" and no expander.
- **Two-column grid** below header: grid-template-columns minmax(420px,1fr) 380px, 24px gap, align-items start.
  - **Left: messages**, newest first, latest expanded by default. Each message = white card (16px radius, shadow). Header row (clickable, hover tint, toggles expand): 32px initials avatar (navy-100/navy for Paul, gold-100/gold-600 for others), name 14px/600, email mono 11px muted, spacer, timestamp mono, small reply icon-button (focuses the reply box, stopPropagation), rotating chevron (180deg when open). Collapsed: one-line ellipsized preview. Expanded: body paragraphs (14px, 1.6 line-height, pre-line), 64px left padding, 1px top border. The newest message also shows a "Show 7 images" pill + explanation "Not loaded yet. A remote image tells the sender you opened the mail, so they are held back until you ask."
  - Below messages: **Reply / Forward buttons** (Gmail pattern). Reply = navy primary with reply-arrow icon, focuses the reply guidance textarea. Forward = secondary bordered.
  - **Right rail**: Summary card (h2 "Summary", bold gist line, summary paragraph, mono footer "Written Aug 30, 5:00 AM by claude-sonnet-5.") then Reply card.
- **Reply card** (two drafting modes, user requirement):
  - Explanation: "This app cannot send email and never will. A reply leaves here by being copied out and sent by you. The draft reads the whole thread, anything known about the client, and how you write in your own sent messages."
  - Guidance textarea (min 72px, placeholder "Optional. Add a few words to steer the draft, or paste your full reply to rephrase.").
  - Buttons: primary "Draft automatically" (AI drafts from thread context) and secondary "Draft from my words" (AI expands/rephrases the user's text).
  - Draft output: cream callout with mono label ("DRAFT, WRITTEN FROM THE THREAD" or "DRAFT, BUILT ON YOUR WORDS"), the draft text, and "Copy it out and send from Gmail."

## Interactions and behavior summary
- Tabs filter; triage pills reclassify/archive with optimistic UI; archived rows hidden unless "Show archived".
- Row click opens thread; resets draft state and expands the newest message.
- Message header click toggles expand; reply icons and bottom Reply button focus the guidance textarea (focus brings it into view).
- Copy summary uses clipboard, shows "Copied" for 1.5s.
- Hovers: 120ms ease background tints only; no scale effects. Focus rings never suppressed.

## State model (from the prototype logic class)
- view: 'list' | 'thread'; tab; threadId
- cats: per-thread category overrides; archived: per-thread flag; showArchived
- expanded: per-message map (default newest open); guidance (reply steering text); draft + draftLabel; attOpen; copied

## Data notes
- The prototype ships 14 sample threads and full message bodies for the "Welcome to Pearl Talent!" thread. Real data comes from the Gmail read-only sync; tab counts (45/3/42/64/474/775) are real-count placeholders.
- App is read-only against Gmail: no send, no reply, no archive upstream. Copy in the UI states this repeatedly; keep it.

## Files
- `Mail Redesign.dc.html` — the full prototype: template markup (inline styles, exact values) + logic class (state and handlers). The design-system tokens/bundle it links live in the app's design system; use your codebase's equivalents.
