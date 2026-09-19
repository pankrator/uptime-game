// Standalone raw input tracker: listens for key presses, mouse movement, and mouse clicks, and
// keeps a snapshot of current input state between frames. Deliberately separate from
// src/input/index.ts (which owns gesture interpretation — wheel/pinch zoom, long-press,
// touch/pen via Pointer Events — for systems that haven't migrated onto this tracker yet; see
// .plans/input-router-refactor.md D1). This module tracks raw state for input.ts's click/key
// router and rack-panel.ts's chip/tray drag.

export interface InputStateSnapshot {
  keysDown: ReadonlySet<string>;
  mouseX: number;
  mouseY: number;
  mouseButtonsDown: ReadonlySet<number>;
  // How far the mouse moved since the last update() call — the basis for drag movement.
  mouseDeltaX: number;
  mouseDeltaY: number;
  // Buttons down both at the previous update() call and now (as opposed to freshly pressed
  // this frame) — i.e. still being held, the basis for "a drag is in progress".
  mouseButtonsHeldSincePreviousFrame: ReadonlySet<number>;
  // Buttons that went down since the last update() call — a one-shot press edge, accumulated the
  // same way as keysPressedSincePreviousFrame/wasClicked below (not derived from
  // mouseButtonsDown/mouseButtonsHeldSincePreviousFrame, which would miss a press+release that
  // both land between two update() calls). This is what a drag-start hit test should trigger on
  // — hit-testing every held frame instead would re-pick whatever's under the cursor each frame.
  mouseButtonsPressedSincePreviousFrame: ReadonlySet<number>;
  // Keys that went down since the last update() call — a one-shot "just pressed" edge, not
  // "currently held" (keysDown), so a poller doesn't repeat-fire a one-shot action like Escape
  // or a build hotkey every frame the key stays down.
  keysPressedSincePreviousFrame: ReadonlySet<string>;
  // Left button pressed and released, within TAP_MAX_MOVEMENT_PX, since the last update() call.
  // One-shot like the above — a poller reads it once per frame and it's gone.
  wasClicked: boolean;
}

export interface InputStateTracker {
  getState(): InputStateSnapshot;
  // Advances the "previous frame" snapshot used for every *SincePreviousFrame field and
  // wasClicked. Call once per frame, after reading getState() for that frame.
  update(): void;
  dispose(): void;
}

// A press+release closer together than this (in pixels) counts as a click, not a drag —
// matches src/input/index.ts's TAP_MAX_MOVEMENT_PX.
const TAP_MAX_MOVEMENT_PX = 10;

export function createInputStateTracker(
  canvas: HTMLCanvasElement,
  target: Window = window,
): InputStateTracker {
  const keysDown = new Set<string>();
  const mouseButtonsDown = new Set<number>();
  let mouseX = 0;
  let mouseY = 0;

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

  // Accumulated by the raw DOM handlers below (not deferred to update()), so a press+release or
  // a keydown that both land within the same frame — before update() next runs — still register:
  // reading keysDown/mouseButtonsDown alone at update() time would miss a key, press, or click
  // that came and went between two update() calls.
  let pendingKeyPresses = new Set<string>();
  let pendingButtonPresses = new Set<number>();
  let pendingClick = false;
  let leftPressOrigin: { x: number; y: number } | null = null;

  function handleKeyDown(event: KeyboardEvent): void {
    // event.repeat is true for OS auto-repeat while a key stays held, not a fresh physical
    // press — without this check, a held key would repeat-fire keysPressedSincePreviousFrame
    // every tick the OS keeps sending repeats, defeating the whole point of a "just pressed"
    // edge over keysDown.
    if (!event.repeat) pendingKeyPresses.add(event.key);
    keysDown.add(event.key);
  }
  function handleKeyUp(event: KeyboardEvent): void {
    keysDown.delete(event.key);
  }
  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);

  function canvasPoint(event: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function updateMousePosition(event: MouseEvent): void {
    const point = canvasPoint(event);
    mouseX = point.x;
    mouseY = point.y;
  }
  function handleMouseMove(event: MouseEvent): void {
    updateMousePosition(event);
  }
  function handleMouseDown(event: MouseEvent): void {
    // Stops native text-selection/drag-ghost while the button is held over the canvas — parity
    // with src/input/index.ts's pointerdown handler.
    event.preventDefault();
    updateMousePosition(event);
    mouseButtonsDown.add(event.button);
    pendingButtonPresses.add(event.button);
    if (event.button === 0) leftPressOrigin = { x: mouseX, y: mouseY };
  }
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mousedown', handleMouseDown);

  // Released on the window, not the canvas: a button pressed on the canvas and released after
  // the pointer has left it must still clear mouseButtonsDown, or it would be stuck "down".
  function handleMouseUp(event: MouseEvent): void {
    mouseButtonsDown.delete(event.button);
    if (event.button === 0 && leftPressOrigin) {
      const releasePoint = canvasPoint(event);
      const distance = Math.hypot(
        releasePoint.x - leftPressOrigin.x,
        releasePoint.y - leftPressOrigin.y,
      );
      if (distance <= TAP_MAX_MOVEMENT_PX) pendingClick = true;
      leftPressOrigin = null;
    }
  }
  target.addEventListener('mouseup', handleMouseUp);

  return {
    getState() {
      return {
        keysDown,
        mouseX,
        mouseY,
        mouseButtonsDown,
        mouseDeltaX,
        mouseDeltaY,
        mouseButtonsHeldSincePreviousFrame,
        mouseButtonsPressedSincePreviousFrame,
        keysPressedSincePreviousFrame,
        wasClicked,
      };
    },
    update() {
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
    },
    dispose() {
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      target.removeEventListener('mouseup', handleMouseUp);
    },
  };
}
