// ============================================================================
// tools/pointerGesture.ts — single-owner lifecycle for canvas pointer gestures.
//
// The editor may have many gesture kinds, but only one pointer may own the
// canvas interaction at a time. Finishing and cancelling detach the gesture
// before application callbacks run, preventing re-entrant events from acting
// on stale drag state.
// ============================================================================

export type PointerGesture = {
  kind: string;
  pointerId: number;
};

export class PointerGestureSession<Gesture extends PointerGesture> {
  #current: Gesture | null = null;

  get current(): Gesture | null {
    return this.#current;
  }

  begin(gesture: Gesture): Gesture | null {
    const replaced = this.#current;
    this.#current = gesture;
    return replaced;
  }

  ownedBy(pointerId: number): Gesture | null {
    return this.#current?.pointerId === pointerId ? this.#current : null;
  }

  finish(pointerId: number): Gesture | null {
    return this.#take(pointerId);
  }

  cancel(pointerId: number): Gesture | null {
    return this.#take(pointerId);
  }

  clear(): Gesture | null {
    const gesture = this.#current;
    this.#current = null;
    return gesture;
  }

  #take(pointerId: number): Gesture | null {
    if (this.#current?.pointerId !== pointerId) return null;
    const gesture = this.#current;
    this.#current = null;
    return gesture;
  }
}
