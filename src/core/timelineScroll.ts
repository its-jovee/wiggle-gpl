// ============================================================================
// core/timelineScroll.ts — small, DOM-free policy for preserving the horizontal
// filmstrip position across timeline rebuilds while keeping the active panel
// reachable after add / duplicate / selection operations.
// ============================================================================

export type TimelineScrollState = {
  previousScrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  activeLeft: number;
  activeRight: number;
};

function clampScroll(scrollLeft: number, viewportWidth: number, contentWidth: number): number {
  return Math.max(0, Math.min(scrollLeft, Math.max(0, contentWidth - viewportWidth)));
}

export function timelineScrollAfterRebuild(state: TimelineScrollState): number {
  const previous = clampScroll(state.previousScrollLeft, state.viewportWidth, state.contentWidth);
  const viewportRight = previous + state.viewportWidth;

  if (state.activeLeft >= previous && state.activeRight <= viewportRight) {
    return previous;
  }

  if (state.activeLeft < previous) {
    return clampScroll(state.activeLeft, state.viewportWidth, state.contentWidth);
  }

  return clampScroll(state.activeRight - state.viewportWidth, state.viewportWidth, state.contentWidth);
}
