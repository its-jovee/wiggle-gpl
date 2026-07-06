# Audio Timeline Design

Date: 2026-06-06
Project: WiggleStudio

## Scope

This design adds Electron-first audio creation and editing for story narration,
sound effects, and music. Audio is a project-level timeline independent from
panels and visual frames.

V1 includes:

- Microphone input source selection.
- Record-to-picture voice-over: recording starts at the current playhead while
  playback runs.
- Import external audio files for sound effects and music.
- Multiple stacked audio tracks.
- Clip drag, trim start/end, split at playhead, per-clip volume, fade in/out,
  and waveform display.
- Track mute.
- Playback with mixed audio.
- MP4 export with mixed audio.
- Export choice between stopping at the visual end or including the full audio
  tail.

V1 does not include solo, clip gain keyframes, crossfades, snapping, grouping,
time-stretching, noise cleanup, browser parity, or panel-attached clips.

## Existing Context

The app is vanilla TypeScript in the renderer with an Electron shell. The
document model is a serializable `Project` containing panels, layers, strokes,
fills, text, sub-panels, and layer animations. Rendering is centralized through
`renderPanel(ctx, panel, tick, width, height, opts)`, and export paths reuse that
renderer.

Important existing constraints remain unchanged:

- Strokes store raw, unjittered points.
- Display, wiggle, and sequence clocks stay decoupled.
- Wiggle randomness stays deterministic and seeded.
- Brushes keep the registry shape `(BrushContext) => void`.

Audio must not become part of `renderPanel()`. Visual determinism remains intact
because audio mixing does not alter strokes, jitter, panels, or visual ticks.

## Product Behavior

Audio clips live at absolute project times, stored in milliseconds from project
start. Changing panel durations does not move audio in v1.

The visual sequence still uses panel durations. During playback, the shared
project playhead determines the visible panel with `panelAtTime(project.panels,
playheadMs)`. Wiggle ticks still derive from local panel time, so audio does not
collapse the existing three-clock design.

Recording is designed for narration:

1. The user selects an input source.
2. The user positions the playhead.
3. The user presses Record in the Audio Desk.
4. Visual playback starts from the playhead while microphone input records.
5. Stopping creates a recording asset and places a clip on the Voice track at
   the recording start time.

## Data Model

Bump `Project.version` from `4` to `5` and add an optional `audio` field:

```ts
export type Project = {
  version: 5;
  width: number;
  height: number;
  wiggleFps: number;
  panels: Panel[];
  audio?: AudioProject;
};
```

Audio data is JSON metadata only. Files are referenced externally so project
JSON stays small.

```ts
export type AudioProject = {
  sampleRate: 48000;
  assets: AudioAsset[];
  tracks: AudioTrack[];
};

export type AudioAsset = {
  id: string;
  kind: "recording" | "import";
  name: string;
  path: string;
  durationMs: number;
  waveformPeaks?: number[];
  createdAt: number;
};

export type AudioTrack = {
  id: string;
  name: string;
  muted: boolean;
  clips: AudioClip[];
};

export type AudioClip = {
  id: string;
  assetId: string;
  startMs: number;
  offsetMs: number;
  durationMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
};
```

Default v5 projects should include three tracks: Voice, SFX, and Music. The
migration from v4 to v5 creates an empty `audio` object with those default
tracks.

## Persistence

Imported audio files keep their existing local paths. Recorded takes are written
to a project media folder when the project file location is known. If the
project has not been saved yet, recordings are written to an app-managed media
folder and remain referenced from there until a future collect/relocate workflow
is added.

The `.wiggle.json` project file stores only metadata, file paths, and waveform
peaks. Moving a project to another computer requires moving the referenced media
files as well.

## Architecture

Keep audio logic out of `src/main.ts` where practical. Add focused modules:

- `src/core/audioTypes.ts`: serializable audio model, constructors, and
  migration defaults.
- `src/core/audioTimeline.ts`: pure helpers for clip timing, trim, split, drag,
  fade clamping, total audio duration, and validation.
- `src/core/audioPreview.ts`: renderer-side Web Audio graph for playback,
  track mute, clip volume, fades, and playhead sync.
- `src/core/waveform.ts`: waveform peak data shape and renderer drawing helpers.
- `electron/audio.cjs`: desktop helpers for external paths, recording
  destination paths, file metadata, waveform generation, and ffmpeg audio
  mixing/export support.
- `src/core/export.ts`: preserve deterministic visual frame generation, then
  hand visual output and audio mix instructions to Electron/ffmpeg for muxing.

The Electron main process is the primary media engine. Browser/Vite behavior may
remain useful for visual editing, but audio does not need full browser parity in
v1.

## Audio Desk UI

Selecting Audio mode from the bottom timeline opens a floating Audio Desk rather
than adding more controls to the crowded right sidebar.

The Audio Desk is a draggable, resizable panel over the workspace. It contains:

- Input source dropdown.
- Record-to-picture button.
- Import Audio button.
- Add Track button.
- Track rows with mute and name controls.
- Project-level audio timeline with a seconds ruler, playhead, waveform clips,
  drag, trim, and split behavior.
- Selected clip controls for volume, fade in, fade out, start, duration, and
  source file.
- Compact status for missing files, recording state, and waveform generation.

The bottom timeline keeps its existing modes and adds Audio:

- Panels: current thumbnail panel strip.
- Visual Tracks: current active-panel animation timing view.
- Audio: opens the Audio Desk and shows project-level audio editing context.

When Audio mode is inactive, the Audio Desk closes or minimizes. Its position
and size can be remembered for the current session only.

## Playback

Playback gets a shared project playhead in milliseconds. Visual playback uses
the existing panel sequence behavior. Audio preview schedules clips from the
same playhead through Web Audio.

Preview behavior:

- Muted tracks are excluded.
- Clip `volume` applies as gain.
- `fadeInMs` and `fadeOutMs` apply as gain ramps.
- `offsetMs` starts playback from inside the source asset.
- Clips can overlap and stack across tracks.
- Missing-file clips remain visible but do not play.

## Recording

Input devices are enumerated with `navigator.mediaDevices.enumerateDevices()`.
Recording uses the selected device from the Audio Desk.

Recording flow:

1. Resolve the selected microphone device.
2. Start visual playback from the current project playhead.
3. Capture microphone input.
4. Stop recording when the user stops record or playback.
5. Save the take to disk.
6. Probe duration and generate waveform peaks.
7. Add an `AudioAsset`.
8. Add an `AudioClip` to the Voice track at the recording start time.
9. Push one history snapshot.

Prefer WAV for editing and export reliability if implementation cost is
reasonable. WebM/Opus is acceptable for v1 if MediaRecorder support makes WAV
capture too expensive for the first pass.

## Export

MP4 remains the deliverable path. Existing visual rendering stays deterministic:
frames are generated from project data and frame index, not wall clock time.

Audio export is mixed separately with ffmpeg using:

- Audio asset file paths.
- Clip `startMs`.
- Clip `offsetMs`.
- Clip `durationMs`.
- Clip `volume`.
- Clip `fadeInMs` and `fadeOutMs`.
- Track mute state.

The final MP4 muxes deterministic video frames with the mixed audio track.
Export must not silently fall back to video-only if audio mixing fails.

The export flow asks:

- End at visual duration.
- Include full audio tail.

The quick WebM export can remain video-only in v1 unless preview-audio capture is
straightforward. MP4 is the prioritized export path.

## Error Handling

Missing audio files are shown in the Audio Desk. Their clips remain in the
project but are muted until a future relink workflow is added.

If microphone permission is denied, recording controls disable and the Audio
Desk shows the permission error.

If the selected input device disappears, fall back to the default input and show
a warning in the Audio Desk.

If waveform generation fails, the clip still imports or records and displays as
a plain block without a waveform.

If ffmpeg audio mixing fails, MP4 export reports the error and does not produce
a video-only file as if the export succeeded.

## Verification

Required commands before declaring implementation done:

```sh
npx tsc --noEmit
npx vite build
```

Unit tests:

- `audioTimeline` trim clamps clip duration and offset correctly.
- `audioTimeline` split creates two valid clips at the playhead.
- Dragging clips clamps negative start times to zero.
- Fade durations clamp to clip duration.
- Total audio duration includes unmuted clip tails.
- Muted tracks are excluded from export mix planning.
- v4 migration creates a v5 project with empty default audio tracks.
- Export planning creates expected ffmpeg mix instructions from project audio
  metadata without running ffmpeg.

Manual checks:

- Select microphone input.
- Record voice-over to picture.
- Import SFX and music.
- Stack clips on multiple tracks.
- Drag, trim, split, adjust volume, and set fades.
- Mute a track and confirm preview/export exclude it.
- Export MP4 ending at visual duration.
- Export MP4 including full audio tail.

## Future Follow-Up Work

These items are intentionally outside v1 but should be tracked for later:

- Collect Media: copy all referenced audio files into a project media folder.
- Relink missing files.
- Move/rename project media folder when using Save As.
- Clean up orphaned recorded takes that are no longer referenced by a project.
- Browser fallback for recording/import where useful.
- Track solo.
- Clip gain keyframes.
- Crossfades.
- Timeline snapping.
- Clip grouping.
- Audio ducking for lowering music under narration.
- Noise cleanup or basic voice enhancement.
- Panel-attached audio clips.
- Project package export that bundles `.wiggle.json` plus media.
