# macOS Editor Redesign Design

Date: 2026-06-07
Project: Wigo Studio

## Scope

This design turns the current Electron app into a more polished, macOS-inspired
desktop editor without changing the drawing, animation, audio, or export engine.

The redesign focuses on usability:

- Replace always-visible controls with contextual workspaces.
- Make the canvas the visual center of the app.
- Combine visual timing and audio editing into a unified Sequence workspace.
- Dock the audio timeline by default, with an option to detach it into a
  floating panel.
- Add a consistent design token system and product language.
- Preserve the existing Electron implementation and data model behavior.

This is not a Swift rewrite, framework rewrite, or rendering rewrite.

## Existing Context

The app is a vanilla TypeScript renderer in an Electron shell. `index.html`
contains the app shell and styles. `src/main.ts` owns DOM wiring, pointer input,
the render loop, tools, sidebars, timeline views, audio desk, playback, and
export controls.

Important existing constraints remain unchanged:

- Strokes store raw, unjittered points.
- Display, wiggle, and sequence clocks stay decoupled.
- Wiggle randomness stays deterministic and seeded.
- Brushes keep the registry shape `(BrushContext) => void`.
- Audio must not become part of `renderPanel()`.

The current audio implementation already supports record-to-picture voice-over:
recording starts at the current playhead, visual playback starts, and the
recorded clip lands on the Voice track at the recording start time. The redesign
must preserve this behavior.

## Product Direction

Wigo Studio should feel like a focused creator tool: closer to a small native
macOS editor than a browser demo. The visual tone should be quiet, crisp, and
professional while preserving the playful drawing output.

The product should not hide all functionality behind a command palette. Drawing
and timeline editing still need direct manipulation. The command palette is a
secondary accelerator for frequent actions and search.

## Workspace Model

Use three top-level modes:

### Draw

Draw is for visual creation and object editing.

Visible surfaces:

- Dominant 9:16 canvas.
- Compact mode rail.
- Context tools for draw, fill, text, sub-panel, select, marquee, and move.
- Brush controls only when a brush-like tool is active.
- Palette controls only when color is relevant.
- Layers and selected-object inspector.
- Onion skin controls in the inspector or a compact canvas control.
- Compact panel strip for navigation.

Hidden or minimized:

- Audio tracks.
- Full animation track editor.
- Export settings.

### Sequence

Sequence is for building the short: panels, timing, visual animations, voice-over,
sound effects, music, playback, and sync.

Visible surfaces:

- Canvas preview remains central.
- Bottom timeline expands into a docked sequence editor.
- Panel lane shows project panels and durations.
- Visual lanes show panel/keyframe/animation timing where relevant.
- Audio lanes show Voice, SFX, Music, imported clips, recorded clips, waveforms,
  mute controls, trim handles, split, drag, fades, and volume.
- Recording controls are available in the timeline toolbar.
- Clip inspector appears only when an audio or visual timing item is selected.

The existing floating Audio Desk becomes a detachable version of the docked
sequence panel. The default is docked. The user can choose Detach Timeline to
float the sequence editor, and Dock Timeline to return it to the bottom.

### Export

Export is for final output.

Visible surfaces:

- Final preview.
- Duration summary: visual duration, audio duration, final export duration.
- Quick WebM.
- Final MP4.
- Include audio tail choice when audio exceeds visual duration.
- Render progress and output status.
- Export warnings for missing audio files or unavailable desktop audio bridge.

Hidden or minimized:

- Brush controls.
- Layer editing controls.
- Detailed sequence editing unless needed for an export warning.

## Shell Layout

Use a stable desktop app shell:

- Top chrome: document title, dirty state, mode selector, core transport, and
  lightweight file/export affordances.
- Left sidebar: mode navigation and context tools.
- Center: canvas stage and matte.
- Right sidebar: contextual inspector for the selected thing.
- Bottom dock: mode-aware panel strip, sequence timeline, or export status.

The sidebars should feel translucent or glass-adjacent in the macOS sense, but
the implementation can use CSS colors and subtle blur only where performance and
readability remain good. Do not add heavy decorative gradients or unrelated
visual effects.

## Contextual Inspector

The right inspector should be empty or minimal until there is a relevant
selection. It should not show every possible feature all the time.

Inspector contexts:

- Brush: brush, size, pressure, jitter, color.
- Fill: fill color and fill-specific settings.
- Text: font, size, color, wiggle, selected text details.
- Sub-panel: shape, bounds, tail, nested layers.
- Layer: name, visibility, opacity, clipping, animation.
- Panel: duration, background, palette, enter/exit animation.
- Audio clip: start, duration, volume, fade in, fade out, source path.
- Export: format, duration, tail behavior, render status.

Empty states should be short and specific, such as `No clip selected` or
`Select a layer to edit layer settings`.

## Docked Sequence Timeline

The Sequence timeline replaces the current split between panel thumbnails,
visual track mode, and the floating Audio Desk as the primary workflow.

Required behavior:

- Docked by default at the bottom.
- Can be detached into a floating, draggable, resizable panel.
- Can be docked again without losing selection, playhead, or timeline state.
- Keeps the current record-while-playing behavior.
- Keeps the current Voice, SFX, and Music default tracks.
- Keeps existing clip drag, trim, split, volume, fades, mute, and track rename.
- Keeps audio stored as external file paths, timing, and waveform peaks.
- Keeps MP4 audio mixing through the existing ffmpeg path.

The docked timeline should have a clear toolbar:

- Play / Stop.
- Record Voiceover.
- Import Audio.
- Add Track.
- Split.
- Detach Timeline or Dock Timeline.
- Timeline view density or zoom if added later.

## Command Palette

Add a command palette as a secondary access layer. It should search and run
existing actions without becoming the only way to use the app.

Initial command groups:

- File: New, Open, Save, Save As.
- Edit: Undo, Redo, Copy Layer, Paste Layer.
- View: Fit Canvas, Actual Size, Toggle Onion Skin.
- Draw: Select Brush, Select Tool, Load Palette.
- Sequence: Add Panel, Duplicate Panel, Record Voiceover, Import Audio, Split
  Clip, Toggle Loop.
- Export: Quick WebM, Final MP4.

Commands should respect current context. For example, Split Clip is disabled
unless an audio clip is selected and the playhead is inside it.

## Design Tokens

Use named CSS tokens instead of scattered colors. This first pass can define the
tokens in `index.html`; a later cleanup can move styles into a dedicated CSS
file if desired.

```css
:root {
  /* Base */
  --app-bg: #101012;
  --window-bg: #17171a;
  --sidebar-bg: rgba(30, 30, 34, 0.86);
  --panel-bg: #202024;
  --panel-bg-raised: #28282d;
  --canvas-matte: #0b0b0d;

  /* Text */
  --text-primary: #f2f2f4;
  --text-secondary: #b2b2b8;
  --text-muted: #74747d;
  --text-disabled: #55555d;

  /* Lines */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.16);

  /* Accent */
  --accent: #ff8f5a;
  --accent-hover: #ffa36f;
  --accent-soft: rgba(255, 143, 90, 0.16);

  /* Timeline */
  --sequence-video: #7dd3fc;
  --sequence-audio-voice: #a78bfa;
  --sequence-audio-sfx: #34d399;
  --sequence-audio-music: #fbbf24;
  --playhead: #ff8f5a;

  /* Geometry */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Type */
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
}
```

These tokens are a starting contract. During implementation, sample the current
rendered UI and adjust only if a color is unreadable, too low contrast, or
visually inconsistent with the approved direction.

## Product Language

Use short, direct labels.

Preferred labels:

- Draw
- Sequence
- Export
- Record Voiceover
- Import Audio
- Add Track
- Panels
- Visual Tracks
- Audio Tracks
- Detach Timeline
- Dock Timeline
- Quick WebM
- Final MP4
- Include audio tail
- No clip selected

Avoid:

- Generic `Record` where `Record Voiceover` is clearer.
- Long instructional paragraphs in persistent app chrome.
- Decorative labels, badges, or marketing copy inside the editor.
- Multiple names for the same concept, such as switching between `Audio`,
  `Audio Desk`, and `Sound` for the same workspace.

## Component Language

Buttons should be icon-first when the action is familiar and repeated, with
tooltips and accessible labels. Text labels are appropriate for primary actions
such as Record Voiceover, Quick WebM, and Final MP4.

Use familiar controls:

- Segmented controls for modes.
- Icon buttons for tools.
- Sliders or numeric fields for continuous values.
- Checkboxes or toggles for binary settings.
- Menus for option sets.
- Rows and lanes for timeline content.

Avoid nested cards. Sidebars are panels; repeated rows and timeline clips can be
framed, but whole sections should not become cards inside cards.

## Implementation Boundaries

The first implementation plan should not introduce React, Vue, SwiftUI, or a new
rendering engine. Stay with the existing vanilla TypeScript and DOM structure
unless a later design explicitly approves a framework migration.

Recommended implementation order:

1. Add mode state and shell structure for Draw, Sequence, and Export.
2. Introduce design tokens and restyle the existing chrome.
3. Make the inspector contextual by mode and selection.
4. Convert the Audio Desk into a dockable Sequence panel while preserving its
   floating behavior.
5. Add command palette after the main surfaces are clearer.
6. Polish responsive/minimum-window behavior.

## Verification

Before declaring implementation complete:

- Run `npx tsc --noEmit`.
- Run `npx vite build`.
- Run the app in Electron or Vite and verify the visible product.
- Verify Draw mode: drawing, brush selection, palette, layers, inspector, onion
  skin controls.
- Verify Sequence mode: panel selection, visual tracks, audio import, record
  voice-over while playback runs, clip select, move, trim, split, fades, volume,
  mute, and dock/float/dock again.
- Verify Export mode: quick WebM, final MP4, audio tail prompt, and missing
  audio warnings.
- Verify no bare `Math.random()` was introduced in render or brush paths.
- Verify export output still uses deterministic visual rendering.

## Impeccable Validation Gate

Run Impeccable on the redesigned UI before final acceptance if a local
Impeccable command or tool is available.

Current discovery result:

- `impeccable` was not found on PATH.
- `impeccable` is not installed in this repository's `node_modules`.
- No Impeccable connector/tool was available in this Codex session.
- Running it through `npm exec` would fetch and execute an external package, so
  it requires explicit approval or a provided local command/path.

The implementation plan should include an Impeccable step, but it should not
block local design work until the command is available.

## Non-Goals

- No native Swift rewrite.
- No new frontend framework.
- No cloud accounts or collaboration.
- No generative-AI image features.
- No changes to raw stroke storage, seeded randomness, brush registry shape, or
  the three-clock model.
- No redesign of the exported visual format beyond clearer export controls.

## Implementation Boundary For `src/main.ts`

The implementation may start by reorganizing UI state inside `src/main.ts`, but
large new UI surfaces should be extracted when they become independently
testable. The first extraction candidates are:

- Sequence timeline rendering and dock/float state.
- Contextual inspector rendering.
- Command palette command registry.

Do not refactor unrelated drawing, rendering, export, or input code as part of
the first redesign pass.
