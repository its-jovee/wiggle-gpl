// ============================================================================
// core/electronMenu.ts — typed renderer access to the Electron app-menu bridge.
// ============================================================================

export type WiggleMenuBridge = {
  onMenuUndo(cb: () => void): void;
  onMenuRedo(cb: () => void): void;
};

declare global {
  interface Window {
    wiggleMenu?: WiggleMenuBridge;
  }
}

export function menuBridge(): WiggleMenuBridge | null {
  return window.wiggleMenu ?? null;
}
