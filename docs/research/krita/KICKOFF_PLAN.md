# Krita Integration Kickoff Plan

## Goal

Create a GPLv3 Wiggle fork that can reuse Krita code and architecture where it
makes the drawing product substantially better, while preserving a clear split
from the MIT WiggleStudio repository.

## Phase 1: Source Pinning

- Krita is pinned as a shallow submodule under `third_party/krita` from
  `https://invent.kde.org/graphics/krita.git`.
- The exact commit is recorded in `IMPORT_LEDGER.md`.
- Keep the source reference separate from Wiggle application code.

## Phase 2: Drawing Experience

- Study Krita's freehand tool, canvas cursor states, zoom/pan behavior, and
  stroke preview.
- Implement Wiggle-compatible smoothing/stabilization without storing jittered
  or post-processed points unless the raw-point model is explicitly changed.
- Test drawing, undo/redo, export, and determinism.

## Phase 3: Brush Settings Architecture

- Split brush settings into serializable data, effective model logic, and UI
  controls.
- Use Krita's brush option design as the reference pattern, translated into
  vanilla TypeScript.
- Avoid pulling a framework into the current app unless a separate design
  approves it.

## Phase 4: Layer and Timeline UX

- Port Krita-inspired affordances for layer visibility, locking, naming,
  ordering, and contextual actions.
- Keep animation timing and export behavior explicit and testable.

## Phase 5: Larger Fork Decision

If Krita-derived raster/tile infrastructure looks dramatically better than the
current vector-first core, write a separate architecture proposal before
changing the data model, render pipeline, or export contract.
