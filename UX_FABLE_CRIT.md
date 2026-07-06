# UX_FABLE_CRIT — UI, User Flows & Information Design Critique

The interface is genuinely nice-looking: a real design-token system, a warm dark
theme, careful motion timing, a Draw/Edit mode split, a command palette, onion
skinning, recovery prompts. This is not a prototype's UI. The critique is about the
gap between "looks finished" and "feels finished under a real workflow" — and about a
feature count that has outrun its own discoverability.

---

## 1. Tool sprawl vs. discoverability — SEVERITY: HIGH

There are **eight** canvas tools (brush, bucket, text, sub-panel, select, marquee,
move-layer, scale, perspective) plus **31 brushes** plus per-brush settings plus
presets. But:

- **There are almost no single-key tool shortcuts.** I found Space (pan), ⌘Z/⌘S/⌘O/⌘K,
  ⌘±/0 (zoom), Del/Esc/Enter (selection). There is **no `B` for brush, `E` for eraser,
  `G` for fill, `V` for select, `M` for marquee, `T` for text** — the muscle memory
  every drawing app trains. A power user's hand never leaves the mouse to click the
  toolbar. This is the #1 friction for the stated user ("solo animator who makes
  multi-panel sequences" = someone doing this *a lot*).
- The command palette (⌘K) is the escape hatch, but it's a *typing* interface for what
  should be *reflex* actions. It lists "Marquee: Rectangle" etc. but not the everyday
  tool switches with keys.
- **No eyedropper / color-pick shortcut.** For a color-native tool whose whole pitch is
  per-panel palettes, being unable to Alt-click to sample an existing color is a
  glaring omission. (The data's all there; it's a missing interaction.)

## 2. The Draw/Edit mode split hides things without explaining why — SEVERITY: MEDIUM

`body.mode-edit .left-sidebar > :not(.mode-rail) { display: none }` (index.html:296) —
switching to Edit mode **hard-hides** the entire brush/palette/tool sidebar and swaps
in a 72px icon rail. That's a strong modal cut. For a new user who clicked "Edit"
expecting to *edit their drawing*, the drawing tools vanishing is disorienting — "Edit"
here means "timeline/sequence/audio editing," a different mental model than "edit the
art." The labels fight the user's intuition. Consider renaming to something like
**Draw / Sequence** (or Canvas / Timeline) so the mode names describe what they reveal.

## 3. Recent Files menu is a lie — SEVERITY: MEDIUM

Every entry under "Recent" calls `openProject()` (main.ts:7112) — the generic open
picker — not the specific file. So clicking "my-comic.wiggle.json" in Recents pops the
OS file browser instead of opening that file. This is worse than having no recents
list: it looks like a feature and betrays the click. Either implement it (File System
Access API can persist handles in IndexedDB for real re-open) or remove the section.

## 4. Empty states & onboarding are thin for the feature depth — SEVERITY: MEDIUM

- One canvas hint ("draw here"), dismissed forever via localStorage, and a one-time ⌘K
  status nudge. That's the entire onboarding for an app with sub-panels, timelapse
  panels, frame groups, perspective rulers, blend modes, masks, and layer animation.
- The most *differentiated* features (timelapse panels, frame groups, the fisheye
  perspective ruler) have **zero in-product explanation**. A user will never discover
  that a "timelapse panel" reveals a source panel's strokes progressively unless they
  read the source. These are the features that would sell the app — they're invisible.
- No empty-state guidance in the timeline ("add a second panel to build a sequence"),
  the layers panel, or the audio track.

## 5. Native `prompt()`/`confirm()` breaks the polish — SEVERITY: MEDIUM

Brush-preset save/rename/delete use `window.prompt`/`window.confirm` (main.ts:242, 273,
284). Next to the beautifully built custom modals (preset picker, export overlay, about
dialog, command palette), these jarring OS dialogs read as unfinished — and in Electron
they look especially foreign. Route them through the existing modal system.

## 6. Feedback lives in a single ephemeral status line — SEVERITY: MEDIUM

Almost every result — "Pasted 3 items", "auto-saved", "merged layer down", "Export
cancelled", errors — funnels through `setStatus()` (a 3.5s-fade text line) or a toast.
Problems:
- Success and *failure* use the same channel and styling (`showError` also just calls
  the toast). A failed MP4 export and "preset renamed" look nearly identical.
- 3.5s is short for anything the user needs to act on; recovery/critical messages
  compete with routine chatter in the same slot (the recovery prompt actually
  `replaceChildren`s the status host — so an autosave message and a "recover unsaved
  work?" prompt fight over one element).
- No history/log — if a user misses the fade, the information is gone.

## 7. Accessibility gaps — SEVERITY: MEDIUM

Good foundations exist (`:focus-visible` styling, `role="tablist"`, `aria-modal`,
`aria-live` toast region, `aria-label` on icon buttons). But:

- **Space is globally hijacked for pan** whenever focus isn't in a text input
  (main.ts:7268, `e.preventDefault()`), which **breaks Space-to-activate on every
  focused button** — a fundamental keyboard-a11y expectation. A user tabbing to a
  toolbar button and pressing Space pans the canvas instead of clicking.
- The entire canvas interaction is pointer-only. Nothing is keyboard-operable on the
  drawing surface (expected for freehand, but *selecting/nudging/deleting* objects
  could be).
- Color is the primary carrier of state (active tool = accent border, dirty = accent
  dot, sequence track types = distinct hues) with no secondary indicator — hard for
  low-vision / colorblind users. The dirty dot in particular is *only* color +
  visibility.
- Range sliders (onion opacity, brush spacing/flow) have visual value labels but no
  `aria-valuetext`.
- No reduced-motion handling: the UI leans on transitions everywhere; nothing checks
  `prefers-reduced-motion`.

## 8. Information architecture of the right sidebar (Inspector) — SEVERITY: LOW-MEDIUM

The inspector is fully rebuilt (`buildInspector` → `innerHTML=""`) and its contents are
context-dependent (layer vs text vs sub-panel vs panel-anim vs perspective). Because
it's imperatively reassembled on every selection change:
- Open/closed `<details>` state, scroll position, and focus are lost or need manual
  restoration on each rebuild — the user's carefully-expanded "Layer Animation" section
  collapses when they click a stroke.
- There's no persistent structure the user can rely on — the same physical space shows
  radically different controls depending on selection, with no header/breadcrumb inside
  the panel saying *what* is selected. (There's a top breadcrumb for panel/sub-panel
  nesting, but not for "you're editing Text vs Layer 2 vs the sub-panel border.")

## 9. Undo/redo depth and scope surprises — SEVERITY: LOW-MEDIUM

- Undo depth is 50 (history.ts:11) with no indication when you hit the floor beyond a
  "Nothing to undo" flash — a user mid-session can silently lose the ability to walk
  back a long drawing session.
- Undo is **global to the project**, so undoing after switching panels can change a
  *different* panel than the one you're looking at, then the view jumps
  (`activePanelIndex = Math.min(...)`, main.ts:7324). Panel-scoped or at least
  "undo focuses the affected panel" would be less startling.
- Slider drags (brush spacing, opacity): unclear whether each intermediate value pushes
  history. If it does, one drag can bury 50 real edits. (Worth verifying; either way,
  coalesce drags into one history entry.)

## 10. Export flow — SEVERITY: LOW

- Solid: progress overlay, cancel, audio-tail choice, WebM-vs-MP4 framing ("Quick" vs
  "Final"). Good product instinct.
- The whole UI **freezes during MP4 export** (main thread PNG-encodes every frame;
  see PERFORMANCE doc §9). Cancel only registers between frames. For a 15–30s clip the
  app is unresponsive for a while with only the progress bar moving — users will think
  it hung. At minimum, keep the cancel button responsive and show an ETA/frame count
  (the reporter already has `f+1/totalFrames` — surface it prominently).
- Output filenames are hardcoded `wiggle.webm` / `wiggle.mp4` (main.ts:6613, 6621) —
  every export overwrites the last in the downloads folder and none carries the project
  name. Derive from `persistenceState.currentFileName`.

## 11. Smaller UX notes

- **No zoom-to-cursor on scroll-wheel** mention in the loop, and pan requires holding
  Space or middle-mouse — trackpad users (the Mac target!) expect pinch-zoom and
  two-finger pan. Worth confirming those gestures work.
- The `dur` input on panel cells is a raw number field; there's no unit affordance
  (ms? frames?) and duration-vs-exposure-ticks are two systems the UI exposes in
  different places (`setPanelDurationMs` vs `setPanelExposure`) that a user has to
  reconcile.
- Marquee/scale/perspective handle **hit radii don't match their drawn radii** (26px
  drawn vs 30/40px hit, per CODE doc §4) — the target feels "off" because the click
  zone silently differs from the dot.
- First-run: the app opens on a single blank 1080×1920 panel with no sample content or
  template. For a creative tool, a "start from a template / here's a 3-panel example"
  path dramatically lowers the blank-canvas barrier.
- The `?perf` and `?project=` URL params are dev-only affordances with no guard — fine,
  but worth a note that they exist in shipped builds.
