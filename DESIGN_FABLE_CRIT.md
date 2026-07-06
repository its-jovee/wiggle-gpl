# DESIGN_FABLE_CRIT — Animation / Creative-Tool Design Critique

This is the "game design" lens the request asked for, adapted to what WiggleStudio
actually is: not a game, but a **creative tool with a craft loop**. The relevant
design questions are the same ones you'd ask of a game — *is the core loop tight, does
mastery have depth, is feedback legible, does the tool reward the behavior it wants?*

---

## 1. The core creative loop is sound but has friction at the seams — ASSESSMENT

The loop is: **pick brush/color → draw a panel → advance/duplicate panel → tweak
timing → play → export.** The good news is this loop *exists* and closes (you can go
blank → MP4). The friction is at every hand-off:

- **Brush → color → draw** is smooth (sidebar is right there in Draw mode).
- **Draw → next panel** requires leaving the canvas for the timeline strip; there's no
  "duplicate this panel and advance" on a keystroke, which is the single most repeated
  action in frame-by-frame animation. Traditional animation tools bind this to one key
  for a reason — the loop should let you stay in flow, drawing frame after frame.
- **Onion skinning** (the feature that makes frame-by-frame *possible*) is a toggle in
  the Edit-mode timeline area, not a persistent, always-available drawing aid with a
  hotkey. In a real animation session onion skin is on ~100% of the time; it should be
  a first-class, always-reachable state, not a mode you dig for.

**Design principle at stake:** the tool should make its *intended dominant behavior*
(draw a frame, advance, draw the next) the path of least resistance. Right now the
dominant behavior costs the most clicks.

## 2. Two animation systems that don't share a mental model — SEVERITY: MEDIUM

There are (at least) three distinct "make it move" mechanisms and they don't cohere
into one teachable model:

1. **Wiggle** — automatic per-tick jitter on every stroke (the house style).
2. **Enter/exit anims** (`pop/fade/jump/squeeze`) on panels, sub-panels, text.
3. **Layer animation** — an A→B keyframe transform with easing and loop modes.

A user has to learn three different UIs, three different time bases (wiggle ticks vs
panel duration vs `durationTicks` vs `startTick`), and three different places to find
them. For the target user (not a pro animator), this is a lot of conceptual surface for
"my thing should move." The design opportunity is to **unify around one motion model**
— e.g. everything is keyframes on a shared tick timeline — or to *ruthlessly hide* the
advanced ones until asked. Right now they sit at equal prominence, which flattens the
learning curve into a wall.

## 3. Timing/exposure is exposed two incompatible ways — SEVERITY: MEDIUM

Panel timing is set both as `durationMs` (a number field on the cell) and as
**exposure ticks** (`setPanelExposure`, "Panel Duration ±1 Frame" commands). These are
two units for one concept (how long a drawing holds), and animators think in **frames
held** ("on twos", "on ones"), not milliseconds. Leading with `durationMs` is speaking
the wrong language to the craft. Pick frames-as-primary (the exposure model), show ms
as derived, and the timeline will suddenly speak animator.

## 4. Feedback legibility during the craft — SEVERITY: MEDIUM

Good animation tools make *timing* visible. Here:

- The playhead and frame counter exist (good), but there's no **timing ruler** showing
  how long each panel holds relative to others — the filmstrip cells are uniform width
  regardless of duration, so a 2s panel and a 200ms panel look identical. The user
  can't *see* rhythm, which is the essence of animation timing.
- **Wiggle is only visible in motion.** When paused/editing you see one tick's jitter;
  you can't preview "how alive is this line" without playing. A little always-running
  wiggle preview on the active stroke (or a wiggle-amplitude visualizer) would let the
  user *feel* the parameter they're setting.
- Layer-animation motion path (`drawKeyframeOverlay`) is actually a lovely touch — A/B
  handles, dashed path, eased speed dots. This is the *right* idea; it should be the
  model for how *all* the motion systems are visualized (see #2).

## 5. Depth of mastery: brushes are wide but shallow in guidance — SEVERITY: LOW-MEDIUM

31 brushes + spacing/flow/pressure settings + presets is deep raw material. But there's
no *sense of progression or curation*: they're a flat list in a picker (grouped, at
least). A craft tool benefits from a "starter set" vs "advanced" framing, or
recommended brush+palette pairings, so a new user isn't paralyzed and an advanced user
discovers combinations. Presets help, but they're user-created from empty — ship a few
*designed* presets that show off the range (a "sketchy", a "bold marker", a "watercolor
wash") as both utility and tutorial-by-example.

## 6. The "reward loop" — does finishing feel good? — SEVERITY: LOW

Games nail the moment of payoff. Here the payoff is *seeing your wiggly thing play and
exporting it*. That moment is undersold:
- Hitting play is functional but not celebratory; export ends with a status-line
  "MP4 done" and a file in Downloads. The single most satisfying moment in the whole
  loop (your creation is now a real video) gets a text fade.
- No in-app final-preview of the exported result, no "share/reveal" flourish. For a
  tool whose users are *makers seeking the dopamine of a finished post*, the finish
  line deserves more than a toast. This is cheap to improve and high emotional ROI.

## 7. Constraint as identity — a design strength to protect — POSITIVE

The 9:16-native, deterministic, vector-first constraints are *design virtues* — they
make the tool opinionated and give it a soul (see PRODUCT doc). The recent multi-aspect
canvas presets quietly erode the "9:16 by choice" identity. From a design standpoint,
**constraints are what make a creative tool feel like *a* tool rather than *a* pile of
options.** I'd think hard before trading the sharp 9:16 identity for generic
flexibility — the target user isn't asking for landscape; they're asking to make the
9:16 thing *faster and more fun*.

---

## Net design read

The craft loop is real and the underlying motion tech is genuinely good. The design
gaps are about **flow and legibility**, not capability: make the dominant action
(draw→advance) frictionless, unify or hide the three motion systems, speak in frames
not milliseconds, make timing and wiggle *visible* while editing, and give the finish
line the payoff it earns. None of these are new features — they're sharpening the loop
the app already has.
