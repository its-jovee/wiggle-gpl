# Layer Tools And Animation Design

Date: 2026-06-02
Project: WiggleStudio

## Scope

This design covers four layer-focused features:

- Move the active layer's contents with a dedicated move tool.
- Copy and paste layers.
- Add a clipping/shading toggle so a layer can paint inside the visible alpha of the layer below.
- Add per-layer animation with easing presets and Copy Animation / Paste Animation controls.

Palette remapping is explicitly out of scope for this pass. Existing color behavior stays as stored hex colors on strokes, fills, and text.

True nested groups are also out of scope. Per-layer animation plus animation copy/paste is the first-pass substitute for group-like motion.

## Existing Context

The app is vanilla TypeScript and DOM. The document model is a serializable `Project` containing panels, layers, strokes, fills, text elements, and sub-panels. Rendering is centralized through `renderPanel(ctx, panel, tick, width, height, opts)`, and export paths reuse that renderer.

Important existing constraints remain unchanged:

- Strokes store raw, unjittered points.
- Display, wiggle, and sequence clocks stay decoupled.
- Wiggle randomness stays deterministic and seeded.
- Brushes keep the registry shape `(BrushContext) => void`.

Current layer support includes visibility, name, opacity, ordering, add/delete, and text-layer tagging. There is no current per-layer animation UI or render transform.

## Data Model

Bump `Project.version` from `3` to `4` and migrate v3 projects by adding optional fields with default behavior.

Extend `Layer` with:

```ts
export type EasingKind = "linear" | "easeIn" | "easeOut" | "easeInOut";
export type LayerLoopKind = "none" | "repeat" | "pingpong";

export type LayerAnimTransform = {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
};

export type LayerAnimation = {
  enabled: boolean;
  startTick: number;
  durationTicks: number;
  from: LayerAnimTransform;
  to: LayerAnimTransform;
  easing: EasingKind;
  loop?: LayerLoopKind;
};

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  kind?: LayerKind;
  clipToBelow?: boolean;
  animation?: LayerAnimation;
  strokes: Stroke[];
  fills: Fill[];
  texts?: TextElement[];
};
```

Default layer behavior is unchanged:

- `clipToBelow` missing or false means normal compositing.
- `animation` missing or disabled means identity transform.
- `loop` missing means `"none"`.

The move layer tool mutates stored raw content coordinates by adding `dx/dy` to stroke points, fill points, and text positions. It does not write jittered points.

Layer animation is render-time only. It never rewrites stroke or fill data.

## Animation Semantics

Add layer animation helpers in `src/core/anim.ts`, separate from existing enter/exit helpers.

Animation progress is derived from:

- `localMs`
- `project.wiggleFps`
- `animation.startTick`
- `animation.durationTicks`

Easing presets:

- `linear`: direct progress.
- `easeIn`: slow start, fast end.
- `easeOut`: fast start, slow end.
- `easeInOut`: slow start and slow end.

Loop modes:

- `none`: clamp after the duration.
- `repeat`: wrap progress back to 0 after each duration.
- `pingpong`: alternate forward and backward passes.

The evaluated transform includes translation, opacity, scale, and rotation. The transform is deterministic because it depends only on project data and the current local time.

## Clipping Semantics

A layer with `clipToBelow` renders only inside the visible alpha of the nearest lower visible non-clipped layer in the same layer container.

Stacked shading layers all clip to the same base by default:

```text
Highlight      clipToBelow=true   clips to Base
Shadow         clipToBelow=true   clips to Base
Base           clipToBelow=false  provides mask
Background     clipToBelow=false
```

Clipped layers follow the base layer's movement and animation:

- If the base layer animates and the clipped layer has no animation, the clipped layer follows the base.
- If the clipped layer also animates, its animation composes on top of the base transform.
- If the base layer was moved destructively with the move tool, the base's raw content changes. Clipped layers are not rewritten, but their render transform remains attached to the base during clipping.

The clip mask is derived from the base layer after its transform is applied, so the visible clipping boundary matches the base layer's on-screen position.

## Render Design

Update `src/core/render.ts` while keeping `renderPanel()` as the single source used by display, WebM, and MP4.

Rendering a layer should follow this pipeline:

1. Render raw layer contents into a layer offscreen canvas as today.
2. Evaluate the layer's own animation transform.
3. If clipped, resolve the current clip base and compose base transform with layer transform.
4. Composite the transformed layer into a temporary transformed-layer canvas.
5. If clipped, apply the transformed base alpha mask with `destination-in`.
6. Draw the result to the target context using `layer.opacity` and animation opacity.

The renderer should track the latest visible non-clipped layer as the clip base for later clipped layers. Clipped layers do not become a new clip base unless a future design explicitly adds that behavior.

Sub-panel layers use the same layer compositing logic inside the existing sub-panel clip path.

## Move Tool

Add a new tool key for Move Layer. It acts on the active layer in the active container, where the active container may be the root panel or the selected sub-panel.

Pointer behavior:

- Pointer down starts a layer move if there is an active visible layer.
- Pointer move previews by mutating the active layer's raw contents by the delta since the previous pointer event.
- Pointer up pushes one history snapshot.
- Escape cancels only if a reversible preview mechanism is added. Otherwise, undo handles rollback.

Moved content:

- Stroke points move.
- Fill seed points move.
- Text element `x/y` positions move.

The tool does not move sub-panel bounds. Existing sub-panel select behavior remains separate.

## Layer Copy And Paste

Use an in-memory layer clipboard.

Copy layer:

- Deep clone the active layer with JSON serialization.
- Store it outside the project.

Paste layer:

- Insert the clone above the active layer in the current container.
- Generate a new layer `id`.
- Generate new IDs for contained `TextElement` values.
- Select the pasted layer.
- Push history.

This first pass pastes only into the current root panel or sub-panel container. Cross-panel paste can be added later using the same clipboard data.

## Animation Copy And Paste

Use a separate in-memory animation clipboard.

Copy Animation:

- Copies only the active layer's `animation` object.
- Disabled when the active layer has no animation.

Paste Animation:

- Applies the copied animation object to the active layer.
- Deep clones the animation so later edits do not mutate the clipboard.
- Pushes history.

This enables quasi-group behavior: copy one layer's animation and paste it onto clouds, sky, foreground, or character layers as needed.

## UI Design

Use Lucide icons for compact tool and layer-row controls. This adds one small open-source icon dependency.

Recommended icons:

- Move layer: `Move`
- Duplicate/copy layer: `Copy`
- Paste layer: `ClipboardPaste`
- Clip/shading: `Scissors` or `Layers`
- Copy animation: `CopyCheck`
- Paste animation: `ClipboardCheck`
- Animation enabled: `Activity`
- Loop: `Repeat`
- Easing: `Spline`

Buttons should be icon-first with `title` tooltips and accessible labels. Avoid adding visible labels to dense layer rows except where form fields need labels.

Layer panel additions:

- Clip toggle per layer row.
- Copy Layer button.
- Paste Layer button, disabled when no layer clipboard exists.
- Copy Animation button.
- Paste Animation button, disabled when no animation clipboard exists.

Layer inspector additions:

- Animation enabled toggle.
- Start tick input.
- Duration tick input.
- From and To controls for `x`, `y`, opacity, scale, and rotation.
- Easing select.
- Loop select.
- Copy Animation and Paste Animation buttons.

Timeline track view additions:

- Add one row per layer in the active panel.
- Show a draggable animation bar when a layer has enabled animation.
- Dragging the bar changes `startTick`, matching the existing track-bar behavior.
- Duration remains edited in the inspector for this pass.

## Verification

Required commands before declaring implementation done:

```sh
npx tsc --noEmit
npx vite build
```

Manual checks:

- Move active layer and undo.
- Copy and paste a layer; confirm layer and text IDs are regenerated.
- Toggle clipping on a shading layer above a base layer.
- Animate a base layer and confirm clipped layers follow it.
- Animate a clipped layer too and confirm its motion composes on top of the base.
- Copy animation from one layer and paste onto another.
- Open track view and drag a layer animation bar.
- Export still uses the same deterministic `renderPanel()` path.

## Rollout Plan

Implementation should be split into focused slices:

1. Model and migration.
2. Animation helper functions and render compositing.
3. Move layer tool.
4. Layer and animation clipboards.
5. Lucide icons and UI controls.
6. Type-check, build, and manual verification.

## Open Constraint

This checkout currently has no `.git` directory, so the design can be written but cannot be committed from this workspace until git metadata is restored or a new repository is initialized.
