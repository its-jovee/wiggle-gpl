# Layer Tools And Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add active-layer movement, layer copy/paste, layer clipping, and per-layer animation with easing and animation copy/paste.

**Architecture:** Extend the `Layer` data model with optional compositing and animation fields, then keep all preview/export behavior flowing through `renderPanel()`. UI changes stay in the existing vanilla DOM builders in `src/main.ts`, with small icon helpers for compact controls.

**Tech Stack:** TypeScript, Vite, Canvas 2D, vanilla DOM, Lucide icons.

---

### Task 1: Model And Animation Helpers

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/anim.ts`

- [ ] Add `LayerAnimation` types, bump `Project.version` to 4, and migrate v3 projects.
- [ ] Add pure layer animation evaluation helpers with `linear`, `easeIn`, `easeOut`, `easeInOut`, `none`, `repeat`, and `pingpong` behavior.
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit with `Implement layer animation model`.

### Task 2: Render Compositing And Clipping

**Files:**
- Modify: `src/core/render.ts`

- [ ] Refactor per-layer drawing so a layer is rendered raw, transformed, optionally masked, and then composited.
- [ ] Resolve clip bases as the nearest lower visible non-clipped layer in the same container.
- [ ] Compose clipped layer transforms on top of the base transform.
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit with `Implement layer animation rendering`.

### Task 3: Move Tool And Clipboards

**Files:**
- Modify: `src/main.ts`

- [ ] Add a move-layer tool that mutates active-layer stroke, fill, and text coordinates while dragging.
- [ ] Add in-memory layer and animation clipboards.
- [ ] Add copy/paste layer and copy/paste animation operations.
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit with `Add layer move and clipboard actions`.

### Task 4: Icon UI, Inspector, And Track Rows

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.ts`
- Modify: `index.html`

- [ ] Add Lucide as the icon source.
- [ ] Add icon buttons to the tool bar and layer rows.
- [ ] Add active-layer animation controls to the inspector.
- [ ] Add layer animation rows to the expanded timeline.
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit with `Add layer animation controls`.

### Task 5: Final Verification

**Files:**
- No code changes expected.

- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npx vite build`.
- [ ] Inspect `git status --short`.
- [ ] Commit any final doc or polish changes if needed.
