# Krita Research and Import Strategy

This directory tracks how Wiggle GPL uses Krita. The goal is to make the GPL
experiment fast without losing provenance.

## Source

Use KDE's canonical Krita repository:

https://invent.kde.org/graphics/krita.git

The GitHub repository at `kde/krita` is a mirror. Prefer the KDE source when
pinning commits, creating submodules, or recording provenance.

## Allowed in this GPL fork

- Direct code imports from GPLv3-compatible Krita files.
- Close TypeScript ports of Krita algorithms or interaction architecture.
- UI structure and workflow patterns inspired by Krita.
- Local modifications that keep source provenance and GPLv3 distribution terms.

## Not allowed

- Copying GPL-derived code back into the separate MIT WiggleStudio project.
- Upstreaming AI-assisted changes to Krita while Krita's AI-development
  moratorium remains active.
- Importing large Krita subsystems without first writing a focused plan that
  explains product impact, touched modules, and migration risks.

## First target areas

1. Canvas navigation: zoom, pan, cursor state, and viewport ergonomics.
2. Freehand drawing feel: smoothing, stabilization, preview, and pointer input.
3. Brush option architecture: separate serializable data, dependency/model
   logic, and controls.
4. Layers and timeline UX: rename/reorder/visibility/lock affordances and
   animation workflow polish.
5. Shortcut model: predictable tool switching and command handling.

## Import process

1. Pin a Krita source commit before copying or porting code.
2. Read the source file headers and SPDX/license tags.
3. Add an `IMPORT_LEDGER.md` row before or in the same commit as the import.
4. Keep copied code isolated in a small module before wiring it into app state.
5. Run `npx tsc --noEmit`, `npm run build`, and `npm test`.
6. Commit with a message naming the imported or ported area.
