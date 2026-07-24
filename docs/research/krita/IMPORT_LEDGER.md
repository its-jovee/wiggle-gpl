# Krita Import Ledger

Record every direct Krita-derived import or close port here. Inspired-by UX
notes do not need a row unless implementation follows a specific source file or
algorithm closely.

| Date | Krita source | Commit | Source files | Local files | License | Import type | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-06 | https://invent.kde.org/graphics/krita.git | bd6b58cbb8216b02740dab3241c25ac1fec0673d | `third_party/krita` submodule | None | GPL-3.0-compatible | Source pin | GPL fork created from WiggleStudio; Krita added as a shallow source reference, no app code imported yet. |
| 2026-07-06 | https://invent.kde.org/graphics/krita.git | bd6b58cbb8216b02740dab3241c25ac1fec0673d | `third_party/krita/libs/ui/tool/kis_smoothing_options.*`, `third_party/krita/libs/ui/tool/kis_stabilized_events_sampler.*`, `third_party/krita/libs/ui/tool/KisStabilizerDelayedPaintHelper.*` | `src/core/strokeSmoothing.ts`, `src/main.ts`, `index.html`, `src/core/types.ts`, `src/core/projectValidation.ts` | GPL-2.0-or-later / GPL-3.0-compatible | TypeScript port / UX adaptation | Ported Krita smoothing concepts into Wiggle's vector input pipeline: off/weighted/stabilizer modes, delay leash, finish flush, and optional pressure smoothing. No Krita raster engine code imported. |
| 2026-07-24 | https://invent.kde.org/graphics/krita.git | bd6b58cbb8216b02740dab3241c25ac1fec0673d | `krita/data/bundles/Krita_4_Default_Resources.bundle` (`paintoppresets/*.kpp`), `plugins/paintops/{defaultpaintops,roundmarker,spray,hatching,gridbrush,hairy,tangentnormal}/` (inventory only) | `docs/research/krita/RASTER_BRUSH_MAPPING.md`, `src/brushes/kritaTips.ts`, `src/brushes/registry.ts` (`rasterOnly?`), `src/brushes/groups.ts` | GPL-2.0-or-later / LGPL-2.0-or-later (engine headers consulted) / GPL-3.0-compatible bundle | Research inventory + inspired helpers | Phase 1 raster-brush port: curated default-preset map and procedural tip/scatter helpers. Helpers are visually inspired, not a close port of KisBrush/dab/tile code. No brush family stamps added yet. |
