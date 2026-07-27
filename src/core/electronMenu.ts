// ============================================================================
// core/electronMenu.ts — typed renderer access to the Electron app-menu bridge.
// ============================================================================

export type WigoMenuBridge = {
  onMenuUndo(cb: () => void): void;
  onMenuRedo(cb: () => void): void;
};

declare global {
  interface Window {
    wigoMenu?: WigoMenuBridge;
  }
}

export function menuBridge(): WigoMenuBridge | null {
  return window.wigoMenu ?? null;
}
