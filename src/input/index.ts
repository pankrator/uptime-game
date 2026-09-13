export interface InputState {
  isKeyDown(key: string): boolean;
  onKeyDown(key: string, handler: () => void): () => void;
  getPointerPosition(): { x: number; y: number } | null;
  wasClicked(): boolean;
}

export function createInput(canvas: HTMLCanvasElement, target: Window = window): InputState {
  const keysDown = new Set<string>();
  const keyDownHandlers = new Map<string, Set<() => void>>();
  let pointerPosition: { x: number; y: number } | null = null;
  let clicked = false;

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
  };
}
