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
import ChatLine from "reicon/icons/ChatLine";
import Brush2 from "reicon/icons/Brush2";
import Brush3 from "reicon/icons/Brush3";
import Clipboard from "reicon/icons/Clipboard";
import ClipboardTick from "reicon/icons/ClipboardTick";
import Copy from "reicon/icons/Copy";
import CopySuccess from "reicon/icons/CopySuccess";
import Crop from "reicon/icons/Crop";
import Cursor from "reicon/icons/Cursor";
import Element3 from "reicon/icons/Element3";
import ElementPlus from "reicon/icons/ElementPlus";
import Eraser from "reicon/icons/Eraser";
import Expand from "reicon/icons/Expand";
import Eye from "reicon/icons/Eye";
import EyeOff from "reicon/icons/EyeOff";
import Frame from "reicon/icons/Frame";
import Frame2 from "reicon/icons/Frame2";
import Grid9 from "reicon/icons/Grid9";
import Hand from "reicon/icons/Hand";
import Layers from "reicon/icons/Layers";
import Layout from "reicon/icons/Layout";
import Menu4 from "reicon/icons/Menu4";
import Paintbucket from "reicon/icons/Paintbucket";
import NoteText from "reicon/icons/NoteText";
import Paperclip from "reicon/icons/Paperclip";
import Pause from "reicon/icons/Pause";
import Play from "reicon/icons/Play";
import Redo from "reicon/icons/Redo";
import Repeat from "reicon/icons/Repeat";
import Scissors from "reicon/icons/Scissors";
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
  Balloon: ChatLine,
  Bucket: Paintbucket,
  Gradient: Grid9,
  ClipboardCheck: ClipboardTick,
  ClipboardPaste: Clipboard,
  Clip: Paperclip,
  Copy,
  CopyCheck: CopySuccess,
  Eraser,
  Eye,
  EyeOff,
  FrameInsertBefore: Frame,
  FrameInsertAfter: Frame2,
  Layers,
  LayerAdd: ElementPlus,
  Raster: Element3,
  DragGrip: Menu4,
  Move: Hand,
  Note: NoteText,
  Perspective: StackPerspective,
  Pointer: Cursor,
  Scale: Expand,
  Selection: Crop,
  SubPanel: Layout,
  CutSubPanel: Scissors,
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
