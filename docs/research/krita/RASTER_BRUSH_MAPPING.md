# Krita → Wiggle Raster Brush Mapping

Pinned source: `https://invent.kde.org/graphics/krita.git` @
`bd6b58cbb8216b02740dab3241c25ac1fec0673d` (see `IMPORT_LEDGER.md`).

Scope: compatible **default** presets and paintops from that pin — not community
brushes, not arbitrary user `.kpp` files. Wiggle ports are registry stamps with
baked behavior. Exact pixel compatibility is **not** required; recognizability is.

Primary preset corpus: `krita/data/bundles/Krita_4_Default_Resources.bundle`
(`paintoppresets/*.kpp`). Engine defaults:
`plugins/paintops/defaultpresets/*.kpp`.

Status legend:

| Status | Meaning |
| --- | --- |
| **supported** | Planned / shipped as a Wiggle registry stamp approximation |
| **approximated** | Related feel, material fidelity gaps documented |
| **skipped** | Explicitly out of scope (engine or stateful ops) |

---

## Paintop engines (scope gate)

| Engine (`paintopid`) | Krita source | Status | Notes |
| --- | --- | --- | --- |
| `paintbrush` (Pixel Brush) | `plugins/paintops/defaultpaintops/brush/` | supported | Everyday dabs: hard/soft tips, texture masks, pressure size/flow |
| `roundmarker` (Quick Brush) | `plugins/paintops/roundmarker/` | supported | Fast opaque round dabs; Krita `b)_Basic-1` uses this |
| `spraybrush` | `plugins/paintops/spray/` | supported | Bounded deterministic particles |
| `hatchingbrush` | `plugins/paintops/hatching/` | approximated | Per-dab hatch stamps only — no whole-stroke geometry engine |
| `gridbrush` | `plugins/paintops/gridbrush/` | approximated | Per-dab grid cell stamps |
| `hairybrush` (Bristle) | `plugins/paintops/hairy/` | approximated | Deterministic per-dab bristles; no ink depletion / mouse-pressure physics |
| `tangentnormal` | `plugins/paintops/tangentnormal/` | approximated | Direction-encoded RGB normals; no tilt sensor channel mix |
| `colorsmudge` | `plugins/paintops/colorsmudge/` | skipped | Color Smudge — stateful smear |
| `duplicate` / Clone | `plugins/paintops/defaultpaintops/duplicate/` | skipped | Clone |
| `deformbrush` | `plugins/paintops/deform/` | skipped | Deform |
| `filter` | `plugins/paintops/filterop/` | skipped | Filter |
| `particlebrush` | `plugins/paintops/particle/` | skipped | Particle |
| `mypaintbrush` | `plugins/paintops/mypaint/` | skipped | MyPaint |
| `curvebrush` | `plugins/paintops/curvebrush/` | skipped | Curve |
| `sketchbrush` | `plugins/paintops/sketch/` | skipped | Sketch |
| `experimentbrush` / Dyna-like | `plugins/paintops/experiment/` | skipped | Experiment / Dyna-class |
| `smudge` (legacy) | defaultpaintops | skipped | Stateful smudge |

---

## Curated preset → Wiggle key map

Keys use the `krita.*` namespace. All Krita-derived entries are `rasterOnly: true`
and appear only while a raster layer is active.

### Pixel / Quick / everyday (`paintbrush`, `roundmarker`)

| Krita preset / engine | Source path | Wiggle key | Status | Fidelity notes |
| --- | --- | --- | --- | --- |
| Quick / `roundmarker` (`b)_Basic-1`) | `…/roundmarker/`, bundle `b)_Basic-1.kpp` | `krita.quick` | supported | Opaque round; no auto-spacing coeff curve |
| Pixel hard (`b)_Basic-5_Size_default`) | bundle + `defaultpaintops/brush/` | `krita.pixelHard` | supported | Hard disc; AA differs from KisBrush |
| Pixel soft / airbrush-ish (`b)_Airbrush_Soft`) | bundle | `krita.pixelSoft` | supported | Soft falloff tip; not airbrush rate engine |
| Pixel art (`u)_Pixel_Art`) | bundle | `krita.pixelArt` | supported | Aliased square; no dither companion |
| Ink precision (`d)_Ink-1_Precision`) | bundle | `krita.inkPrecision` | approximated | Thin opaque nib; tip bitmaps not shipped |
| Ink fineliner (`d)_Ink-2_Fineliner`) | bundle | `krita.inkFineliner` | approximated | Constant thin line |
| G-pen (`d)_Ink-3_Gpen`) | bundle | `krita.inkGpen` | approximated | Pressure width via existing context |
| Marker chisel (`e)_Marker_Chisel_Smooth`) | bundle | `krita.markerChisel` | approximated | Fixed-angle rectangle; no tilt |
| Marker dry (`e)_Marker_Dry`) | bundle | `krita.markerDry` | approximated | Chisel + light grain skip |
| Pencil hard (`c)_Pencil-1_Hard`) | bundle | `krita.pencilHard` | approximated | Soft grain disc; no GIH tip |
| Pencil soft (`c)_Pencil-4_Soft`) | bundle | `krita.pencilSoft` | approximated | Higher flow variance |
| Textured paint (`g)_Dry_Brushing`) | bundle | `krita.paintTextured` | approximated | Procedural weave mask, not `random_particles.png` |
| Eraser circle (`a)_Eraser_Circle`) | bundle | `krita.eraserHard` | supported | `erase: true` hard disc |
| Eraser soft (`a)_Eraser_Soft`) | bundle | `krita.eraserSoft` | supported | Soft alpha punch |
| Basic flow/opacity variants (`b)_Basic-2`…`6`) | bundle | — | skipped | Redundant size/flow variants; use brush settings |
| Pencil large/tilt/shade (`c)_Pencil-3/5/6`) | bundle | — | skipped | Tilt / oversized tip assets |
| Sumi / rough ink extras | bundle | — | skipped | Overlap with existing Wiggle ink/Sumi |

### Chalk / dry media

| Krita preset | Source | Wiggle key | Status | Fidelity notes |
| --- | --- | --- | --- | --- |
| `h)_Chalk_Soft` | bundle (`scribbles.png` tip in Krita) | `krita.chalkSoft` | approximated | Generated chalk grain tip |
| `h)_Chalk_Grainy` | bundle | `krita.chalkGrainy` | approximated | Coarser thresholded grain |
| `h)_Chalk_Details` | bundle | `krita.chalkDetail` | approximated | Smaller spacing / tip |
| Charcoal pencil family (`h)_Charcoal_*`) | bundle | `krita.charcoalStick` | approximated | One stick preset; not full pencil set |
| Dry bristles eroded / creases | bundle | — | skipped | Needs rich bitmap tips / smudge |

### Spray

| Krita preset / engine | Source | Wiggle key | Status | Fidelity notes |
| --- | --- | --- | --- | --- |
| Engine default `spraybrush.kpp` | `plugins/paintops/defaultpresets/` | `krita.spray` | supported | Bounded particle count; seeded pos/size/opacity |
| `y)_Texture_Spray` | bundle (`paintbrush`) | `krita.sprayTexture` | approximated | Textured particles via mask, not full spray op |
| `v)_Texture_Pointillism` | bundle (`spraybrush`) | `krita.sprayDots` | approximated | Larger sparse dots |
| Starfield / FX spray variants | bundle | — | skipped | Decorative stamp packs |

### Hatching / Grid

| Krita preset / engine | Source | Wiggle key | Status | Fidelity notes |
| --- | --- | --- | --- | --- |
| `hatchingbrush.kpp` parallel | `plugins/paintops/hatching/` | `krita.hatchParallel` | approximated | Short parallel ticks in dab |
| Crosshatch preference | same | `krita.hatchCross` | approximated | Two angles per dab |
| Stroke-following hatch | same | `krita.hatchFollow` | approximated | Angle from `delta` |
| `gridbrush.kpp` | `plugins/paintops/gridbrush/` | `krita.gridBasic` | approximated | Small cell pattern stamp |
| Moire / interval-rich hatch | hatching prefs | — | skipped | Needs persistent origin / preference engine |

### Bristle / Tangent Normal

| Krita preset / engine | Source | Wiggle key | Status | Fidelity notes |
| --- | --- | --- | --- | --- |
| `hairybrush.kpp` | `plugins/paintops/hairy/` | `krita.bristle` | approximated | Fixed bristle count; no connected-path ink |
| Bundle bristles (`f)_Bristles-*`) | mostly `paintbrush` tips | — | skipped | Tip-bitmap family; one simplified hairy stamp covers the ask |
| `tangentnormal.kpp` / `w)_Texture_Normal_Map` | `plugins/paintops/tangentnormal/` | `krita.tangentNormal` | approximated | Encodes stroke direction in RGB; no pen tilt/elevation |

### Explicitly skipped families (do not implement)

Color Smudge, Clone, Deform, Filter, Particle, MyPaint, Curve, Sketch,
Experiment/Dyna, wet paint / blender / adjust blend-mode presets, shape stamps
(`t)_*`, `z)_*`), screentones, and all wet/smudge `i)_*` / `k)_*` presets that
require stateful paint ops.

---

## Shared infrastructure (Phase 1)

| Piece | Local file | Role |
| --- | --- | --- |
| Tip / scatter helpers | `src/brushes/kritaTips.ts` | Generated tips, scatter, rotation, mask stamps |
| Registry flag | `Brush.rasterOnly?` in `src/brushes/registry.ts` | UI-only; stamp contract unchanged |
| Availability | `src/brushes/groups.ts` | Filter + safe fallback for layer kind |

Provenance: Phase 1 helpers are **visually inspired** procedural utilities, not
close ports of Krita dab/tile code. Later phases that closely follow a specific
algorithm must add an `IMPORT_LEDGER.md` row in the same commit.
