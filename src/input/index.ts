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
  // free to mean something in-game.
  wasRightClicked(): boolean;
}

export function createInput(canvas: HTMLCanvasElement, target: Window = window): InputState {
  const keysDown = new Set<string>();
  const keyDownHandlers = new Map<string, Set<() => void>>();
  let pointerPosition: { x: number; y: number } | null = null;
  let clicked = false;
  let rightClicked = false;
  let pointerDown = false;
  let pressed = false;
  let released = false;

  target.addEventListener('keydown', (event) => {
    keysDown.add(event.key);
    for (const handler of keyDownHandlers.get(event.key) ?? []) {
      handler();
    }
  });
  target.addEventListener('keyup', (event) => keysDown.delete(event.key));

  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointerPosition = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  });

  canvas.addEventListener('click', () => {
    clicked = true;
  });

  // Suppress the browser's context menu so right-click is free to mean "view this rack"
  // in-game instead of opening a native menu.
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    rightClicked = true;
  });

  canvas.addEventListener('mousedown', () => {
    pointerDown = true;
    pressed = true;
  });

  // Released on the window, not the canvas: a drag that ends after the pointer has left the
  // canvas (dragged off-canvas, or the browser delivers mouseup elsewhere) must still be seen
  // as released, or a drag could get stuck "held" with no way to end it.
  target.addEventListener('mouseup', () => {
    if (!pointerDown) return;
    pointerDown = false;
    released = true;
  });

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
  };
}
