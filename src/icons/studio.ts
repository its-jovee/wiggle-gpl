// ============================================================================
// icons/studio.ts — WiggleStudio's first-party UI icon catalog.
//
// Icons use the same tuple shape as Lucide so existing DOM rendering stays
// tiny, but the drawings are local and tailored for animation/drawing tools.
// ============================================================================

export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

export const StudioIcons = {
  BrushClassic: [
    ["path", { d: "M5 19c2.8-.2 4.7-1.2 5.6-3.1" }],
    ["path", { d: "M9.5 15.8 20 5.3c.8-.8.8-2 0-2.8s-2-.8-2.8 0L6.7 13" }],
    ["path", { d: "M6.7 13c-1.2.2-2.2 1-2.7 2.2-.5 1.4.2 2.9 1.7 3.5" }],
    ["path", { d: "M8.2 11.8l4 4" }],
  ],
  BrushTexture: [
    ["path", { d: "M5 19c2.6-.1 4.5-1 5.4-2.8" }],
    ["path", { d: "M10 15.8 19.8 6c.8-.8.8-2 0-2.8s-2-.8-2.8 0l-9.8 9.8" }],
    ["path", { d: "M7.2 13c-1.4.2-2.5 1.1-3 2.4-.5 1.4.3 2.9 1.8 3.4" }],
    ["path", { d: "M14 6.4 17.6 10" }],
    ["path", { d: "M4.5 6.5h.01" }],
    ["path", { d: "M7.5 4.5h.01" }],
    ["path", { d: "M5.8 9.5h.01" }],
  ],
  BrushScatter: [
    ["path", { d: "M7 17c1.6-.5 2.7-1.3 3.4-2.6" }],
    ["path", { d: "M10 14.4 18.8 5.6" }],
    ["path", { d: "M8.5 12.8l3 3" }],
    ["circle", { cx: 5, cy: 6, r: 1 }],
    ["circle", { cx: 8.5, cy: 4, r: 0.8 }],
    ["circle", { cx: 18, cy: 15, r: 1.1 }],
    ["circle", { cx: 15, cy: 19, r: 0.8 }],
    ["circle", { cx: 20, cy: 9, r: 0.7 }],
  ],
  Bucket: [
    ["path", { d: "M5 11.5 11.5 5 18 11.5 11.5 18 5 11.5Z" }],
    ["path", { d: "M9 7.5 5.5 4" }],
    ["path", { d: "M5.2 11.3h12.6" }],
    ["path", { d: "M18.5 16.5c.8.8 1.5 1.5 1.5 2.4a1.8 1.8 0 0 1-3.6 0c0-.9.7-1.6 2.1-2.4Z" }],
  ],
  ClipboardCheck: [
    ["rect", { x: 6, y: 4, width: 12, height: 16, rx: 2 }],
    ["path", { d: "M9 4.5C9 3.7 9.7 3 10.5 3h3C14.3 3 15 3.7 15 4.5V6H9V4.5Z" }],
    ["path", { d: "m9 13 2 2 4-5" }],
  ],
  ClipboardPaste: [
    ["rect", { x: 6, y: 4, width: 12, height: 16, rx: 2 }],
    ["path", { d: "M9 4.5C9 3.7 9.7 3 10.5 3h3C14.3 3 15 3.7 15 4.5V6H9V4.5Z" }],
    ["path", { d: "M12 10v6" }],
    ["path", { d: "m9.5 13.5 2.5 2.5 2.5-2.5" }],
  ],
  Clip: [
    ["rect", { x: 5, y: 5, width: 9, height: 9, rx: 1.5 }],
    ["rect", { x: 10, y: 10, width: 9, height: 9, rx: 1.5 }],
    ["path", { d: "M10 14h4v-4" }],
    ["path", { d: "M14 10v4h-4" }],
  ],
  Copy: [
    ["rect", { x: 8, y: 8, width: 11, height: 11, rx: 2 }],
    ["path", { d: "M5 15V7c0-1.1.9-2 2-2h8" }],
  ],
  CopyCheck: [
    ["rect", { x: 8, y: 8, width: 11, height: 11, rx: 2 }],
    ["path", { d: "M5 15V7c0-1.1.9-2 2-2h8" }],
    ["path", { d: "m10.5 13.8 1.8 1.8 4-4" }],
  ],
  Eraser: [
    ["path", { d: "m4 15.5 7.8-7.8c1-1 2.5-1 3.5 0l2.9 2.9c1 1 1 2.5 0 3.5L13.3 19H7.5L4 15.5Z" }],
    ["path", { d: "m9 10.5 5.5 5.5" }],
    ["path", { d: "M13.3 19H21" }],
  ],
  FrameInsertBefore: [
    ["rect", { x: 9, y: 5, width: 11, height: 14, rx: 2 }],
    ["path", { d: "M5 6v12" }],
    ["path", { d: "M3 12h5" }],
    ["path", { d: "M5.5 9.5 3 12l2.5 2.5" }],
    ["path", { d: "M13 12h3" }],
    ["path", { d: "M14.5 10.5v3" }],
  ],
  FrameInsertAfter: [
    ["rect", { x: 4, y: 5, width: 11, height: 14, rx: 2 }],
    ["path", { d: "M19 6v12" }],
    ["path", { d: "M16 12h5" }],
    ["path", { d: "M18.5 9.5 21 12l-2.5 2.5" }],
    ["path", { d: "M8 12h3" }],
    ["path", { d: "M9.5 10.5v3" }],
  ],
  Layers: [
    ["path", { d: "m12 3 8 4.5-8 4.5-8-4.5L12 3Z" }],
    ["path", { d: "m4 12 8 4.5 8-4.5" }],
    ["path", { d: "m4 16.5 8 4.5 8-4.5" }],
  ],
  Move: [
    ["path", { d: "M12 3v18" }],
    ["path", { d: "M3 12h18" }],
    ["path", { d: "m8 7 4-4 4 4" }],
    ["path", { d: "m8 17 4 4 4-4" }],
    ["path", { d: "m7 8-4 4 4 4" }],
    ["path", { d: "m17 8 4 4-4 4" }],
  ],
  Perspective: [
    ["path", { d: "M4 19 12 4l8 15H4Z" }],
    ["path", { d: "M12 4v15" }],
    ["path", { d: "M7.8 12h8.4" }],
    ["path", { d: "M4 19h16" }],
  ],
  Pointer: [
    ["path", { d: "M6 3v16l4.2-4.2 2.4 5.2 2.7-1.2-2.4-5.1H19L6 3Z" }],
  ],
  Scale: [
    ["path", { d: "M5 9V5h4" }],
    ["path", { d: "M19 15v4h-4" }],
    ["path", { d: "M5 5l6 6" }],
    ["path", { d: "M19 19l-6-6" }],
    ["rect", { x: 8, y: 8, width: 8, height: 8, rx: 1.5 }],
  ],
  Selection: [
    ["rect", { x: 5, y: 5, width: 13, height: 13, rx: 1.5, "stroke-dasharray": "3 3" }],
    ["path", { d: "m14 14 5 5" }],
    ["path", { d: "m17 15 2 4-4-2" }],
  ],
  SubPanel: [
    ["rect", { x: 4, y: 5, width: 16, height: 14, rx: 2 }],
    ["path", { d: "M8 9h4" }],
    ["path", { d: "M8 13h8" }],
    ["path", { d: "M14 9h2" }],
  ],
  Text: [
    ["path", { d: "M5 6h14" }],
    ["path", { d: "M12 6v13" }],
    ["path", { d: "M8.5 19h7" }],
    ["path", { d: "M6 6v3" }],
    ["path", { d: "M18 6v3" }],
  ],
  Tone: [
    ["circle", { cx: 6, cy: 6, r: 1.4 }],
    ["circle", { cx: 12, cy: 6, r: 1.4 }],
    ["circle", { cx: 18, cy: 6, r: 1.4 }],
    ["circle", { cx: 6, cy: 12, r: 1.4 }],
    ["circle", { cx: 12, cy: 12, r: 1.4 }],
    ["circle", { cx: 18, cy: 12, r: 1.4 }],
    ["circle", { cx: 6, cy: 18, r: 1.4 }],
    ["circle", { cx: 12, cy: 18, r: 1.4 }],
    ["circle", { cx: 18, cy: 18, r: 1.4 }],
  ],
  Timer: [
    ["circle", { cx: 12, cy: 13, r: 7 }],
    ["path", { d: "M9 2h6" }],
    ["path", { d: "M12 6V3" }],
    ["path", { d: "M12 13l3-3" }],
  ],
  Timelapse: [
    ["circle", { cx: 12, cy: 12, r: 8 }],
    ["path", { d: "M12 7v5l3 2" }],
    ["path", { d: "M4 12a8 8 0 0 1 8-8" }],
    ["path", { d: "M4 8v4h4" }],
  ],
  Trash: [
    ["path", { d: "M5 7h14" }],
    ["path", { d: "M9 7V5c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v2" }],
    ["path", { d: "M7 7l1 13h8l1-13" }],
    ["path", { d: "M10.5 11v5" }],
    ["path", { d: "M13.5 11v5" }],
  ],
} satisfies Record<string, IconNode>;
