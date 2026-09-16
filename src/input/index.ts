export interface InputState {
  isKeyDown(key: string): boolean;
  onKeyDown(key: string, handler: () => void): () => void;
  getPointerPosition(): { x: number; y: number } | null;
  wasClicked(): boolean;
  // Press/release edges, for drag gestures (rack panel drag-and-drop — see
  // .plans/workload-dispatch.md step 6) that wasClicked() alone can't express: a drag needs to
  // know WHEN the pointer went down (to start) and WHEN it came up (to commit/cancel), not just
  // that a full click happened. wasClicked() is unaffected and still fires on click, same as
  // before — this is purely additive.
  wasPressed(): boolean;
  wasReleased(): boolean;
  isPointerDown(): boolean;
  // Right-click, used as the "view a rack" affordance (D4 — inspect without committing to
  // walk there). The browser's context menu is suppressed on the canvas so right-click is
  // free to mean something in-game. Also fires on a touch-and-hold (see LONG_PRESS_MS below) —
  // touch's equivalent, since there's no second mouse button (mobile-touch-support.md D3).
  wasRightClicked(): boolean;
  // Accumulated vertical wheel delta since the last read, consumed on read (same one-shot
  // pattern as wasClicked/wasPressed/wasReleased) — used by the rack panel to scroll its
  // content. Positive scrolls down, matching the DOM WheelEvent.deltaY sign.
  consumeWheelDeltaY(): number;
  // Accumulated zoom signal since the last read, consumed on read like the wheel delta above —
  // positive zooms in, negative zooms out. Folds together two-finger pinch (touch) and
  // ctrl+wheel (the standard trackpad-pinch-emulation signal browsers emit) into one number,
  // already normalized to camera-scale units, so camera.ts has exactly one thing to read
  // regardless of which input produced it (see .plans/mobile-touch-support.md D2).
  getZoomDelta(): number;
}

// Scale-units-per-pixel of pinch-distance change — chosen so a typical full-hand pinch across a
// phone screen (a few hundred px) covers roughly the whole zoom range.
const PINCH_ZOOM_SENSITIVITY = 0.003;
// Scale-units-per-wheel-unit for ctrl+wheel zoom (trackpad pinch emulation). Wheel deltaY is
// negative when the gesture means "zoom in" (matches native browser page-zoom conventions).
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
// A press+release closer together than this (in pixels) is a tap, not a drag — computed
// ourselves rather than relying on the browser's native `click` event, which some mobile
// browsers fire (or suppress) inconsistently once pointerdown has called preventDefault() (see
// .plans/mobile-touch-support.md D1). input.ts's drag-vs-click logic doesn't otherwise change:
// it still just reads wasClicked()/wasPressed()/wasReleased().
const TAP_MAX_MOVEMENT_PX = 10;
// Touch-and-hold duration that fires wasRightClicked() on touch/pen — the touch equivalent of
// right-click's "view a rack" affordance (D4), since touch has no second mouse button. Matches
// typical OS long-press thresholds. Mouse is untouched: right-click already covers it, so the
// timer is only armed for non-mouse pointers (see the pointerdown handler below) rather than
// adding a second, surprising way to trigger the same thing while holding the left button.
const LONG_PRESS_MS = 500;

export function createInput(canvas: HTMLCanvasElement, target: Window = window): InputState {
  const keysDown = new Set<string>();
  const keyDownHandlers = new Map<string, Set<() => void>>();
  let pointerPosition: { x: number; y: number } | null = null;
  let clicked = false;
  let rightClicked = false;
  let pointerDown = false;
  let pressed = false;
  let released = false;
  let wheelDeltaY = 0;
  let zoomDelta = 0;

  // Multi-pointer tracking exists only to detect a two-finger pinch — this game has one player
  // and no multi-touch gameplay beyond zoom, so a full multi-touch system would be solving a
  // problem it doesn't have. `primaryPointerId` is the single pointer (mouse, or the first
  // finger down) that drives click/press/drag/position the way a mouse always has; a second
  // finger is tracked only in `activePointers`, for pinch distance.
  const activePointers = new Map<number, { x: number; y: number }>();
  let primaryPointerId: number | null = null;
  let pressOrigin: { x: number; y: number } | null = null;
  let lastPinchDistance: number | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressFired = false;

  function cancelLongPress(): void {
    if (longPressTimer === undefined) return;
    target.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }

  // Turns off the browser's own scroll/pinch-zoom/double-tap-zoom on the canvas so our own
  // tap/drag/pinch handling below is the only thing interpreting touches.
  canvas.style.touchAction = 'none';

  target.addEventListener('keydown', (event) => {
    keysDown.add(event.key);
    for (const handler of keyDownHandlers.get(event.key) ?? []) {
      handler();
    }
  });
  target.addEventListener('keyup', (event) => keysDown.delete(event.key));

  function canvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pinchDistance(): number | null {
    if (activePointers.size !== 2) return null;
    const [a, b] = [...activePointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Suppress the browser's context menu so right-click is free to mean "view this rack"
  // in-game instead of opening a native menu.
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    rightClicked = true;
  });

  // Pointer Events unify mouse, touch, and pen into one stream with the same clientX/clientY
  // semantics `canvasPoint` already expects — one code path drives input.ts's whole
  // click-priority chain and rack-panel.ts's drag lifecycle regardless of what's pointing (see
  // .plans/mobile-touch-support.md D1).
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Only the first finger (or the mouse) drives press/click/drag — a second finger touching
    // down mid-gesture must not look like a fresh press (it would restart tryStartDrag, or
    // misfire a click when the pinch ends). It does mean this is becoming a pinch, though, not
    // a long-press, so cancel any timer armed for the primary pointer.
    if (primaryPointerId !== null) {
      cancelLongPress();
      return;
    }
    primaryPointerId = event.pointerId;
    pointerPosition = canvasPoint(event);
    pressOrigin = pointerPosition;
    pointerDown = true;
    pressed = true;
    longPressFired = false;

    // Touch-and-hold → wasRightClicked() (see LONG_PRESS_MS above). Mouse already has an
    // explicit right-click for this, so the timer is only armed for touch/pen.
    if (event.pointerType !== 'mouse') {
      longPressTimer = target.setTimeout(() => {
        longPressTimer = undefined;
        if (!pointerDown || !pressOrigin || !pointerPosition) return;
        const moved = Math.hypot(pointerPosition.x - pressOrigin.x, pointerPosition.y - pressOrigin.y);
        if (moved <= TAP_MAX_MOVEMENT_PX) {
          longPressFired = true;
          rightClicked = true;
        }
      }, LONG_PRESS_MS);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (event.pointerId === primaryPointerId) {
      pointerPosition = canvasPoint(event);

      // A real drag/pan is in progress, not a hold in place — a long-press should never fire
      // once the finger has clearly moved (the timer callback double-checks this anyway, but
      // cancelling here avoids the wasted wait).
      if (pressOrigin) {
        const moved = Math.hypot(pointerPosition.x - pressOrigin.x, pointerPosition.y - pressOrigin.y);
        if (moved > TAP_MAX_MOVEMENT_PX) cancelLongPress();
      }
    }

    const distance = pinchDistance();
    if (distance !== null) {
      if (lastPinchDistance !== null) {
        zoomDelta += (distance - lastPinchDistance) * PINCH_ZOOM_SENSITIVITY;
      }
      lastPinchDistance = distance;
    } else {
      lastPinchDistance = null;
    }
  });

  // Released on the window, not the canvas: a drag that ends after the pointer has left the
  // canvas (dragged off-canvas, or the browser delivers pointerup elsewhere) must still be seen
  // as released, or a drag could get stuck "held" with no way to end it.
  target.addEventListener('pointerup', (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) lastPinchDistance = null;

    if (event.pointerId !== primaryPointerId) return;
    primaryPointerId = null;
    cancelLongPress();
    if (!pointerDown) return;
    pointerDown = false;
    released = true;

    // Self-computed tap detection (see TAP_MAX_MOVEMENT_PX above) rather than the native
    // `click` event — this is what actually makes a tap register as a click on touch. Skipped
    // if a long-press already fired for this same press: releasing a finger that just opened
    // a rack's viewing panel must not also walk there / open it in dispatching mode.
    if (!longPressFired && pressOrigin) {
      const releasePoint = canvasPoint(event);
      const distance = Math.hypot(releasePoint.x - pressOrigin.x, releasePoint.y - pressOrigin.y);
      if (distance <= TAP_MAX_MOVEMENT_PX) clicked = true;
    }
    pressOrigin = null;
    longPressFired = false;
  });

  // An OS-interrupted touch (an incoming call, the browser reassigning the gesture to
  // scroll/navigation) must clear state the same way pointerup does, or a drag could be left
  // stuck "held" forever with no release to end it. Never counts as a tap.
  target.addEventListener('pointercancel', (event) => {
    activePointers.delete(event.pointerId);
    lastPinchDistance = null;

    if (event.pointerId !== primaryPointerId) return;
    primaryPointerId = null;
    cancelLongPress();
    pressOrigin = null;
    longPressFired = false;
    if (pointerDown) {
      pointerDown = false;
      released = true;
    }
  });

  // passive: false so preventDefault can stop the page itself from scrolling/zooming while the
  // pointer is over the canvas (the rack panel is the only thing that should respond to plain
  // wheel; ctrl+wheel is trackpad pinch-to-zoom instead, kept separate from the scroll delta so
  // the two gestures never fight over the same accumulator).
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        zoomDelta += -event.deltaY * WHEEL_ZOOM_SENSITIVITY;
      } else {
        wheelDeltaY += event.deltaY;
      }
    },
    { passive: false },
  );

  return {
    isKeyDown(key: string) {
      return keysDown.has(key);
    },
    onKeyDown(key: string, handler: () => void) {
      let handlers = keyDownHandlers.get(key);
      if (!handlers) {
        handlers = new Set();
        keyDownHandlers.set(key, handlers);
      }
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    getPointerPosition() {
      return pointerPosition;
    },
    wasClicked() {
      if (!clicked) return false;
      clicked = false;
      return true;
    },
    wasRightClicked() {
      if (!rightClicked) return false;
      rightClicked = false;
      return true;
    },
    wasPressed() {
      if (!pressed) return false;
      pressed = false;
      return true;
    },
    wasReleased() {
      if (!released) return false;
      released = false;
      return true;
    },
    isPointerDown() {
      return pointerDown;
    },
    consumeWheelDeltaY() {
      const delta = wheelDeltaY;
      wheelDeltaY = 0;
      return delta;
    },
    getZoomDelta() {
      const delta = zoomDelta;
      zoomDelta = 0;
      return delta;
    },
  };
}
