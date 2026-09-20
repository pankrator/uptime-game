// The sole input tracker (.plans/input-router-refactor.md D1 follow-up — replaces
// src/input/index.ts entirely). Listens for keys, pointer position/clicks/drag, wheel, and
// pinch/ctrl-wheel zoom via Pointer Events (unifying mouse, touch, and pen — see
// .plans/mobile-touch-support.md), and keeps a snapshot of input state between frames. Consumers
// poll getState() and act on it directly — no callback registration, no consumer-owned gesture
// interpretation (that's input.ts's job for clicks/keys, rack-panel.ts's for chip/tray drag).
//
// Most fields are a plain "as of the last update() call" snapshot: safe to read from any number
// of places at any rate. wheelDeltaY/zoomDelta are the deliberate exception — genuine
// consume-on-read accumulators (consumeWheelDeltaY()/consumeZoomDelta()), because they're read
// from two different loops at two different rates (input.ts/rack-panel.ts/job-panels.ts from the
// 30Hz simulation tick, camera.ts's render system from requestAnimationFrame) and are additive:
// a snapshot field left un-drained between an update() call and the next would double-apply zoom
// on every extra render frame in between. A one-shot edge like wasClicked has no such problem —
// reading "true" twice before the next update() just means two idempotent reactions to the same
// click, which every consumer here already is.

export interface InputStateSnapshot {
  keysDown: ReadonlySet<string>;
  // Keys that went down since the last update() call — a one-shot "just pressed" edge, not
  // "currently held" (keysDown), so a poller doesn't repeat-fire a one-shot action like Escape
  // or a build hotkey every frame the key stays down. Filters out OS auto-repeat (event.repeat).
  keysPressedSincePreviousFrame: ReadonlySet<string>;
  // Continuous hover/press position, canvas-relative. null until the first pointer event this
  // tracker has seen (see render.ts's hover-gated rack labels/build-panel preview, which must not
  // draw at a stale (0,0) before any real pointer event has happened).
  mousePosition: { x: number; y: number } | null;
  // The primary pointer (mouse left button, or the first finger down) only — this game has one
  // draggable gesture at a time, so "down" is a single boolean modeled as a one-element Set for
  // API consistency with the *SincePreviousFrame fields below. A second finger (pinch) never
  // enters this; real mouse right-click never does either (see wasRightClicked instead).
  mouseButtonsDown: ReadonlySet<number>;
  // How far the mouse moved since the last update() call — the basis for drag movement.
  mouseDeltaX: number;
  mouseDeltaY: number;
  // Down both at the previous update() call and now (as opposed to freshly pressed this frame)
  // — i.e. still being held, the basis for "a drag is in progress".
  mouseButtonsHeldSincePreviousFrame: ReadonlySet<number>;
  // Went down since the last update() call — a one-shot press edge, accumulated the same way as
  // keysPressedSincePreviousFrame/wasClicked (not derived from mouseButtonsDown/
  // mouseButtonsHeldSincePreviousFrame, which would miss a press+release landing between two
  // update() calls). What a drag-start hit test should trigger on — hit-testing every held frame
  // instead would re-pick whatever's under the cursor each frame.
  mouseButtonsPressedSincePreviousFrame: ReadonlySet<number>;
  // Left button (or a tap) pressed and released within TAP_MAX_MOVEMENT_PX, since the last
  // update() call.
  wasClicked: boolean;
  // Right mouse button, or a touch/pen long-press (LONG_PRESS_MS held within
  // TAP_MAX_MOVEMENT_PX) — the "view a rack" affordance. Since the last update() call.
  wasRightClicked: boolean;
}

export interface InputStateTracker {
  getState(): InputStateSnapshot;
  // Advances the "previous frame" snapshot used for every *SincePreviousFrame field, wasClicked,
  // and wasRightClicked. Call once per simulation tick (input.ts, which runs first in
  // main.ts's updateSystems) — NOT from the render loop, see the file header.
  update(): void;
  // Accumulated vertical wheel delta since the last read, consumed on read — see the file header
  // for why this (and zoom below) can't be a plain update()-gated snapshot field. Positive
  // scrolls down, matching the DOM WheelEvent.deltaY sign.
  consumeWheelDeltaY(): number;
  // Accumulated zoom signal since the last read, consumed on read — positive zooms in, negative
  // zooms out. Folds together two-finger pinch (touch) and ctrl+wheel (the standard
  // trackpad-pinch-emulation signal browsers emit), already normalized to camera-scale units.
  consumeZoomDelta(): number;
  dispose(): void;
}

// A press+release closer together than this (in pixels) counts as a click/tap, not a drag.
const TAP_MAX_MOVEMENT_PX = 10;
// Touch-and-hold duration that counts as a long-press (the touch equivalent of right-click,
// since touch has no second button) — matches typical OS long-press thresholds.
const LONG_PRESS_MS = 500;
// Scale-units-per-pixel of pinch-distance change — a typical full-hand pinch across a phone
// screen (a few hundred px) covers roughly the whole zoom range.
const PINCH_ZOOM_SENSITIVITY = 0.003;
// Scale-units-per-wheel-unit for ctrl+wheel zoom (trackpad pinch emulation). Wheel deltaY is
// negative when the gesture means "zoom in" (matches native browser page-zoom conventions).
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export function createInputStateTracker(
  canvas: HTMLCanvasElement,
  target: Window = window,
): InputStateTracker {
  const keysDown = new Set<string>();
  const mouseButtonsDown = new Set<number>();
  let mousePosition: { x: number; y: number } | null = null;

  // Captured by update() at the end of the previous frame, compared against the live state
  // above to derive *SincePreviousFrame fields for the frame in progress.
  let previousMouseX = 0;
  let previousMouseY = 0;
  let previousMouseButtonsDown = new Set<number>();
  let mouseDeltaX = 0;
  let mouseDeltaY = 0;
  let mouseButtonsHeldSincePreviousFrame = new Set<number>();
  let mouseButtonsPressedSincePreviousFrame = new Set<number>();
  let keysPressedSincePreviousFrame = new Set<string>();
  let wasClicked = false;
  let wasRightClicked = false;

  // Accumulated by the raw DOM handlers below (not deferred to update()), so a press+release, a
  // keydown, or a right-click that all land within the same frame — before update() next runs —
  // still register.
  let pendingKeyPresses = new Set<string>();
  let pendingButtonPresses = new Set<number>();
  let pendingClick = false;
  let pendingRightClick = false;
  let pendingWheelDeltaY = 0;
  let pendingZoomDelta = 0;
  let leftPressOrigin: { x: number; y: number } | null = null;

  // Multi-pointer tracking exists only to detect a two-finger pinch — this game has one player
  // and no multi-touch gameplay beyond zoom. primaryPointerId is the single pointer (mouse, or
  // the first finger down) that drives press/click/drag/position the way a mouse always has; a
  // second finger is tracked only in activePointers, for pinch distance.
  const activePointers = new Map<number, { x: number; y: number }>();
  let primaryPointerId: number | null = null;
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

  function handleKeyDown(event: KeyboardEvent): void {
    // F5 is bound in-game to quicksave (see main.ts) — without this, the browser's own refresh
    // would fire on the same keypress and tear the page down before the save completes.
    if (event.key === 'F5') event.preventDefault();
    // event.repeat is true for OS auto-repeat while a key stays held, not a fresh physical press
    // — without this check, a held key would repeat-fire keysPressedSincePreviousFrame every
    // tick the OS keeps sending repeats, defeating the whole point of a "just pressed" edge.
    if (!event.repeat) pendingKeyPresses.add(event.key);
    keysDown.add(event.key);
  }
  function handleKeyUp(event: KeyboardEvent): void {
    keysDown.delete(event.key);
  }
  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);

  function canvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pinchDistance(): number | null {
    if (activePointers.size !== 2) return null;
    const [a, b] = [...activePointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Suppress the browser's context menu so right-click is free to mean "view this rack" in-game
  // instead of opening a native menu.
  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    pendingRightClick = true;
  }
  canvas.addEventListener('contextmenu', handleContextMenu);

  function handlePointerDown(event: PointerEvent): void {
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Only the first finger (or the mouse's primary button) drives press/click/drag — a second
    // finger touching down mid-gesture must not look like a fresh press. A real mouse
    // right/middle button press is ignored entirely here (button !== 0) — right-click is a
    // separate, non-conflicting signal via contextmenu above, not a press/drag/click gesture.
    if (event.button !== 0 || primaryPointerId !== null) {
      if (primaryPointerId !== null) cancelLongPress();
      return;
    }
    primaryPointerId = event.pointerId;
    const point = canvasPoint(event);
    mousePosition = point;
    leftPressOrigin = point;
    mouseButtonsDown.add(0);
    pendingButtonPresses.add(0);
    longPressFired = false;

    // Touch-and-hold → wasRightClicked (see LONG_PRESS_MS above). Mouse already has an explicit
    // right-click for this, so the timer is only armed for touch/pen.
    if (event.pointerType !== 'mouse') {
      longPressTimer = target.setTimeout(() => {
        longPressTimer = undefined;
        if (primaryPointerId === null || !leftPressOrigin || !mousePosition) return;
        const moved = Math.hypot(
          mousePosition.x - leftPressOrigin.x,
          mousePosition.y - leftPressOrigin.y,
        );
        if (moved <= TAP_MAX_MOVEMENT_PX) {
          longPressFired = true;
          pendingRightClick = true;
        }
      }, LONG_PRESS_MS);
    }
  }
  canvas.addEventListener('pointerdown', handlePointerDown);

  function handlePointerMove(event: PointerEvent): void {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    // Mouse-hover tracking: no press is active yet, so there's no primary pointer/pressOrigin to
    // protect — touch has no equivalent idle-hover state (a touch's first pointermove always
    // follows a pointerdown, which already claims primaryPointerId), so this never fires for
    // touch/pen.
    if (primaryPointerId === null && event.pointerType === 'mouse') {
      mousePosition = canvasPoint(event);
    }
    if (event.pointerId === primaryPointerId) {
      mousePosition = canvasPoint(event);

      // A real drag/pan is in progress, not a hold in place — a long-press should never fire
      // once the finger has clearly moved.
      if (leftPressOrigin) {
        const moved = Math.hypot(
          mousePosition.x - leftPressOrigin.x,
          mousePosition.y - leftPressOrigin.y,
        );
        if (moved > TAP_MAX_MOVEMENT_PX) cancelLongPress();
      }
    }

    const distance = pinchDistance();
    if (distance !== null) {
      if (lastPinchDistance !== null) {
        pendingZoomDelta += (distance - lastPinchDistance) * PINCH_ZOOM_SENSITIVITY;
      }
      lastPinchDistance = distance;
    } else {
      lastPinchDistance = null;
    }
  }
  canvas.addEventListener('pointermove', handlePointerMove);

  // Released on the window, not the canvas: a press that ends after the pointer has left the
  // canvas must still be seen as released, or a drag could get stuck "held" with no way to end.
  function handlePointerUp(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) lastPinchDistance = null;

    if (event.pointerId !== primaryPointerId) return;
    primaryPointerId = null;
    cancelLongPress();
    mouseButtonsDown.delete(0);

    // Self-computed tap detection rather than the native `click` event — needed for touch, and
    // consistent for mouse. Skipped if a long-press already fired for this same press: releasing
    // a finger that just opened a rack's viewing panel must not also walk there.
    if (!longPressFired && leftPressOrigin) {
      const releasePoint = canvasPoint(event);
      const distance = Math.hypot(
        releasePoint.x - leftPressOrigin.x,
        releasePoint.y - leftPressOrigin.y,
      );
      if (distance <= TAP_MAX_MOVEMENT_PX) pendingClick = true;
    }
    leftPressOrigin = null;
    longPressFired = false;
  }
  target.addEventListener('pointerup', handlePointerUp);

  // An OS-interrupted touch (an incoming call, the browser reassigning the gesture to
  // scroll/navigation) must clear state the same way pointerup does, or a drag could be left
  // stuck "held" forever. Never counts as a tap.
  function handlePointerCancel(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    lastPinchDistance = null;

    if (event.pointerId !== primaryPointerId) return;
    primaryPointerId = null;
    cancelLongPress();
    leftPressOrigin = null;
    longPressFired = false;
    mouseButtonsDown.delete(0);
  }
  target.addEventListener('pointercancel', handlePointerCancel);

  // passive: false so preventDefault can stop the page itself from scrolling/zooming while the
  // pointer is over the canvas.
  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey) {
      pendingZoomDelta += -event.deltaY * WHEEL_ZOOM_SENSITIVITY;
    } else {
      pendingWheelDeltaY += event.deltaY;
    }
  }
  canvas.addEventListener('wheel', handleWheel, { passive: false });

  return {
    getState() {
      return {
        keysDown,
        keysPressedSincePreviousFrame,
        mousePosition,
        mouseButtonsDown,
        mouseDeltaX,
        mouseDeltaY,
        mouseButtonsHeldSincePreviousFrame,
        mouseButtonsPressedSincePreviousFrame,
        wasClicked,
        wasRightClicked,
      };
    },
    update() {
      const mouseX = mousePosition?.x ?? previousMouseX;
      const mouseY = mousePosition?.y ?? previousMouseY;
      mouseDeltaX = mouseX - previousMouseX;
      mouseDeltaY = mouseY - previousMouseY;
      mouseButtonsHeldSincePreviousFrame = new Set(
        [...mouseButtonsDown].filter((button) => previousMouseButtonsDown.has(button)),
      );
      previousMouseX = mouseX;
      previousMouseY = mouseY;
      previousMouseButtonsDown = new Set(mouseButtonsDown);

      mouseButtonsPressedSincePreviousFrame = pendingButtonPresses;
      pendingButtonPresses = new Set();

      keysPressedSincePreviousFrame = pendingKeyPresses;
      pendingKeyPresses = new Set();

      wasClicked = pendingClick;
      pendingClick = false;

      wasRightClicked = pendingRightClick;
      pendingRightClick = false;
    },
    consumeWheelDeltaY() {
      const delta = pendingWheelDeltaY;
      pendingWheelDeltaY = 0;
      return delta;
    },
    consumeZoomDelta() {
      const delta = pendingZoomDelta;
      pendingZoomDelta = 0;
      return delta;
    },
    dispose() {
      cancelLongPress();
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
      target.removeEventListener('pointercancel', handlePointerCancel);
      canvas.removeEventListener('wheel', handleWheel);
    },
  };
}
