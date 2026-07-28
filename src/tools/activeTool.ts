// ============================================================================
// tools/activeTool.ts — typed editor tool identity and recent-tool migration.
//
// Paint brushes and editor tools used to share one string variable. Editor
// tools were encoded as brush-looking sentinel keys such as "__marquee__",
// which meant every consumer had to remember which strings were safe to pass
// to the brush registry. This module makes that state explicit while retaining
// read compatibility with recent-tool values written by older builds.
// ============================================================================

export const EDITOR_TOOL_KINDS = [
  "bucket",
  "gradient",
  "text",
  "subpanel",
  "balloon",
  "cut-subpanel",
  "select",
  "marquee",
  "move-layer",
  "perspective",
  "scale",
] as const;

export type EditorToolKind = typeof EDITOR_TOOL_KINDS[number];

export type ActiveTool =
  | { kind: "brush"; brushKey: string }
  | { kind: EditorToolKind };

const EDITOR_TOOL_KIND_SET = new Set<string>(EDITOR_TOOL_KINDS);

const LEGACY_TOOL_KIND_BY_KEY: Readonly<Record<string, EditorToolKind>> = {
  __bucket__: "bucket",
  __gradient__: "gradient",
  __text__: "text",
  __subpanel__: "subpanel",
  __balloon__: "balloon",
  __cut_subpanel__: "cut-subpanel",
  __select__: "select",
  __marquee__: "marquee",
  __move_layer__: "move-layer",
  __perspective__: "perspective",
  __scale__: "scale",
};

export function brushTool(brushKey: string): ActiveTool {
  return { kind: "brush", brushKey };
}

export function editorTool(kind: EditorToolKind): ActiveTool {
  return { kind };
}

export function isEditorToolKind(value: string): value is EditorToolKind {
  return EDITOR_TOOL_KIND_SET.has(value);
}

export function isActiveEditorTool(
  active: ActiveTool,
  kind: EditorToolKind,
): boolean {
  return active.kind === kind;
}

export function activeBrushKey(active: ActiveTool): string | null {
  return active.kind === "brush" ? active.brushKey : null;
}

/** Stable session preference key. Brush keys remain unchanged; editor tools
 * use an explicit namespace so they can never collide with registry entries. */
export function recentToolKey(active: ActiveTool): string {
  return active.kind === "brush" ? active.brushKey : `tool:${active.kind}`;
}

/** Decode current and legacy recent-tool preference values. Unknown brush
 * values are rejected by the caller-provided registry predicate. */
export function activeToolFromRecentKey(
  key: string,
  isKnownBrushKey: (key: string) => boolean,
): ActiveTool | null {
  if (key.startsWith("tool:")) {
    const kind = key.slice("tool:".length);
    return isEditorToolKind(kind) ? editorTool(kind) : null;
  }
  const legacyKind = LEGACY_TOOL_KIND_BY_KEY[key];
  if (legacyKind) return editorTool(legacyKind);
  return isKnownBrushKey(key) ? brushTool(key) : null;
}
