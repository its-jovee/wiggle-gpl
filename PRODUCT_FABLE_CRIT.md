# PRODUCT_FABLE_CRIT — Product & Creative-Tool Design Critique

WiggleStudio has a *sharp* product thesis, and I want to lead with that because it's
the strongest thing here: **"keep the vector stroke structure that WigglyPaint throws
away, so you can re-wiggle, rescale to 9:16, swap palettes per frame, and export a
frame-accurate MP4."** That is a real, defensible insight (PRODUCT.md nails it), and the
determinism architecture actually delivers on it. The concern is not the core bet —
it's that the product has been *widening* faster than it's been *deepening*, and the
docs describing it have drifted from the code.

---

## 1. Scope has sprawled past the core promise — SEVERITY: HIGH (strategic)

Look at what shipped by "v8": 31 brushes, texture/scatter engines, layers with 11
blend modes + masks + clip-to-below + per-layer animation, sub-panels with 5 shapes
and tails, timelapse panels, frame groups with repeats, a 5-mode perspective ruler
*including fisheye curvilinear grids*, a full audio timeline with recording/fades/
mixdown, palettes from Lospec, a command palette, brush presets.

That is the feature surface of a mature 3-year product, built as one-feature-per-commit
sprints (the git log is literally "Polish X", "Add Y"). The risk is classic: **breadth
without a spine.** The stated user is "a solo content creator who makes short wiggly
multi-panel bits for TikTok." Ask of each feature: *does it serve that person's core
loop (blank → wiggly multi-panel → posted MP4)?*

- **Serves it directly:** brushes, per-panel palettes, timeline, onion skin, MP4 export, wiggle. This is the product.
- **Plausibly serves it:** layers, text, sub-panels, simple layer animation, audio.
- **Hard to justify for this user:** a **fisheye curvilinear perspective ruler**. This is a pro-illustration feature (Clip Studio territory) that a TikTok-wiggle creator will essentially never use, yet it's some of the most complex, least-tested code in the app (see CODE doc). It's a signal that feature selection is being driven by "what's interesting to build" over "what the user needs."

**Recommendation:** declare a v1.0 *core loop* and rank every feature as core / support /
speculative. Speculative features (fisheye perspective, 11 blend modes, timelapse
panels) should have to *earn* their maintenance cost with evidence a user wants them.
Right now the app can do a hundred things and it's not obvious it does the *five that
matter* better than anything else.

## 2. The docs have drifted from the product — SEVERITY: MEDIUM (but corrosive)

For a project whose onboarding *is* its docs (HANDOFF.md, AGENTS.md, ARCHITECTURE.md
are load-bearing for the multi-agent workflow), doc drift is real product debt:

- **ARCHITECTURE.md describes the v1 data model** (`Panel { strokes[] }` — strokes now
  live on Layers) and says "two built-ins ship" (there are six). It's three schema
  versions stale.
- **PRODUCT.md declares a hard non-goal — "NOT freeform-canvas … draws natively at 9:16
  by choice"** — but `canvasPresets.ts` now ships multiple aspect ratios. The product
  broke its own stated invariant without updating the story. Either the non-goal is
  dead (say so, and re-pitch) or the presets shouldn't exist. A creator reading "9:16
  by choice, that's the whole point" and then finding a square preset gets a muddier
  sense of what the tool *is*.
- **"v8" (schema) vs "0.1.0" (package.json) vs "31 brushes" everywhere** — three
  version/count truths. Pick one public version and keep counts in one place.

The thesis is strong *because* it's opinionated. Every drifted doc dilutes the opinion.

## 3. The differentiators are invisible — SEVERITY: MEDIUM

The features that would actually make someone *choose* this over drawing GIFs in
Procreate — **deterministic re-wiggle, per-panel palette swaps, timelapse reveal
panels, frame-accurate TikTok MP4** — have essentially no presence in the UI or
marketing surface (see UX doc §4). The product's best arguments are buried:

- A user never *sees* "your line is re-wiggling live and it'll export identically" —
  it just happens. That determinism is the crown jewel and it's completely silent.
- "Timelapse panel that progressively reveals your drawing" is a *fantastic* TikTok
  format (the reveal is native to the platform) and it's hidden behind an unlabeled
  panel type.

A product this feature-rich needs its differentiators surfaced as *first-class flows*,
not discovered by accident.

## 4. No path to the actual goal (posting) — SEVERITY: MEDIUM

Success criterion (PRODUCT.md): "blank canvas to a posted-ready 9:16 MP4 … without
touching another tool." The app stops at "MP4 in your downloads folder named
`wiggle.mp4`." That's *close* but the last mile is where creators live:

- No project-named export, no "export presets" (TikTok vs Reels vs Shorts have
  different ideal lengths/loops), no loop-friendly export (seamless loop is the single
  most-wanted property for short-form and the render loop already supports looping —
  expose "export as seamless loop").
- No thumbnail/first-frame chooser, no quick preview-in-place of the final MP4.
- The audio-tail choice dialog shows real product thinking; extend that instinct to the
  whole export-to-post handoff.

## 5. Local-first is right, but the persistence story has sharp edges — SEVERITY: LOW-MEDIUM

The local-first, no-accounts stance is correct for the user and the privacy posture is
a genuine selling point. But:

- Recovery snapshots live in localStorage silently (see SECURITY doc §5) — a user who
  never saves believes nothing is stored; conversely, large projects silently fail to
  snapshot when they blow the quota. The mental model "I haven't saved so nothing
  exists" is quietly false in one direction and quietly broken in the other.
- The Recent Files menu doesn't actually reopen files (UX doc §3) — the *one* feature
  that would make local-first feel like a real app (pick up where you left off) is a
  no-op. File System Access handle persistence (IndexedDB) is the missing piece and it
  directly serves the core loop.

## 6. Where's the wiggle *personality*? — SEVERITY: LOW (but it's the soul)

The entire pitch is the "playful, jiggly, hand-drawn WigglyPaint aesthetic." The
*engine* honors it (deterministic per-tick jitter, Decker brush lineage). But the
**app chrome is a polished, sober, pro dark-mode tool** — tasteful, but it doesn't
*feel* wiggly. WigglyPaint's charm was partly that the whole thing felt like a toy.
There's an opportunity to let the product's personality match its output: wiggly UI
accents, a playful empty state, the wordmark itself jiggling. Not a priority over the
functional gaps — but the current UI could belong to any drawing app; nothing about it
says "this one makes things *wiggle*." For a product whose entire differentiation is a
*feeling*, that's a missed brand beat.

## 7. Testing/quality as a product risk — SEVERITY: MEDIUM

The one test that guards the crown-jewel promise — **"export the same project twice and
get identical bytes"** — has been the #1 roadmap item since v8 and still doesn't exist
(HANDOFF.md). Determinism is the product. If a brush or cache change silently breaks
reproducibility, nothing catches it, and the feature that justifies the whole
vector-first architecture regresses invisibly. This is a *product* risk wearing an
engineering costume: ship the determinism regression test before adding feature #32.

---

## Summary judgment

The bet is right and the engine honors it. The danger is a product that keeps adding
rooms to a house whose foundation feature (deterministic, re-wiggleable, post-ready
export) isn't yet *surfaced, tested, or finished to the last mile*. The highest-value
product move is not another tool — it's to (a) re-anchor the docs and scope on the core
loop, (b) make the differentiators visible, and (c) finish the blank→posted path
(named/loop export, real recent-files, the determinism guarantee made real). Depth on
the five things that matter will beat breadth every time for this user.
