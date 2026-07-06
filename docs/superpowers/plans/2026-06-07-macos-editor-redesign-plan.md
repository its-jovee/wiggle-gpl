# macOS Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Electron/Vite editor into a macOS-inspired, contextual Draw/Sequence/Export workspace while preserving current drawing, audio, and export behavior.

**Architecture:** Keep the vanilla TypeScript renderer and existing engine modules. Add app-mode state in `src/main.ts`, reuse existing timeline/audio/export functions, and restyle `index.html` with a tokenized desktop shell. Dock the audio sequence editor by default and keep floating behavior as a detachable option.

**Tech Stack:** Electron, Vite, TypeScript, DOM APIs, Canvas 2D, existing ffmpeg/audio bridge.

---

### Task 1: Workspace Shell And Tokens

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`

- [x] Add design tokens and macOS-inspired shell CSS.
- [x] Add mode selector controls for Draw, Sequence, Export.
- [x] Add command palette markup and export workspace containers.
- [x] Add `workspaceMode` state and mode switching helpers.

### Task 2: Contextual Surfaces

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`

- [x] Hide irrelevant sidebars by mode.
- [x] Keep Draw focused on tools, layers, inspector, and compact panels.
- [x] Make Sequence use a docked timeline by default.
- [x] Make Export show export summary and actions without drawing controls.

### Task 3: Dockable Sequence Timeline

**Files:**
- Modify: `src/main.ts`
- Modify: `index.html`

- [x] Replace the default Audio Desk behavior with a docked Sequence timeline.
- [x] Preserve current record-while-playing behavior.
- [x] Preserve import, add track, split, drag, trim, volume, fades, mute, and track rename.
- [x] Add Detach Timeline and Dock Timeline controls.

### Task 4: Command Palette

**Files:**
- Modify: `src/main.ts`
- Modify: `index.html`

- [x] Add command registry for existing actions.
- [x] Add keyboard shortcut handling for the command palette.
- [x] Disable context-sensitive commands when unavailable.

### Task 5: Verification

**Files:**
- Existing app files only.

- [x] Run `npx tsc --noEmit`.
- [x] Run `npx vite build`.
- [x] Run existing focused tests if available.
- [x] Run browser/Electron visual verification as far as available.
- [ ] Run Impeccable if a local command becomes available.
