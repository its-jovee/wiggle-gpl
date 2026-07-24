// ============================================================================
// icons/studio.ts — Studio UI icons via Reicon (https://reicon.dev).
//
// Each export is a Reicon IconFunction: call it to get an SVGSVGElement, or use
// `.toSvg()` for string markup. Weight defaults to Outline for tool chrome.
// Direct per-icon imports keep the Vite bundle tree-shakeable.
// ============================================================================

import type { IconFunction } from "reicon";
import AddSquare from "reicon/icons/AddSquare";
import Brush from "reicon/icons/Brush";
import Brush2 from "reicon/icons/Brush2";
import Brush3 from "reicon/icons/Brush3";
import Clipboard from "reicon/icons/Clipboard";
import ClipboardTick from "reicon/icons/ClipboardTick";
import Copy from "reicon/icons/Copy";
import CopySuccess from "reicon/icons/CopySuccess";
import Crop from "reicon/icons/Crop";
import Cursor from "reicon/icons/Cursor";
import Eraser from "reicon/icons/Eraser";
import Expand from "reicon/icons/Expand";
import Frame from "reicon/icons/Frame";
import Frame2 from "reicon/icons/Frame2";
import Grid9 from "reicon/icons/Grid9";
import Hand from "reicon/icons/Hand";
import Layers from "reicon/icons/Layers";
import Layout from "reicon/icons/Layout";
import Menu4 from "reicon/icons/Menu4";
import Paintbucket from "reicon/icons/Paintbucket";
import Paperclip from "reicon/icons/Paperclip";
import Pause from "reicon/icons/Pause";
import Play from "reicon/icons/Play";
import Redo from "reicon/icons/Redo";
import Repeat from "reicon/icons/Repeat";
import Sparkles from "reicon/icons/Sparkles";
import StackPerspective from "reicon/icons/StackPerspective";
import Text from "reicon/icons/Text";
import Timer from "reicon/icons/Timer";
import TimerAlt from "reicon/icons/TimerAlt";
import Trash from "reicon/icons/Trash";
import Undo from "reicon/icons/Undo";

export type StudioIcon = IconFunction;

/** Catalog of icons used by the editor chrome. */
export const StudioIcons = {
  BrushClassic: Brush,
  BrushTexture: Brush2,
  BrushScatter: Brush3,
  Bucket: Paintbucket,
  ClipboardCheck: ClipboardTick,
  ClipboardPaste: Clipboard,
  Clip: Paperclip,
  Copy,
  CopyCheck: CopySuccess,
  Eraser,
  FrameInsertBefore: Frame,
  FrameInsertAfter: Frame2,
  Layers,
  DragGrip: Menu4,
  Move: Hand,
  Perspective: StackPerspective,
  Pointer: Cursor,
  Scale: Expand,
  Selection: Crop,
  SubPanel: Layout,
  Text,
  Tone: Grid9,
  Timer,
  Timelapse: TimerAlt,
  Trash,
  Undo,
  Redo,
  Add: AddSquare,
  Sparkle: Sparkles,
  Play,
  Pause,
  Repeat,
} satisfies Record<string, StudioIcon>;
