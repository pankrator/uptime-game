export interface InputState {
  isKeyDown(key: string): boolean;
  getPointerPosition(): { x: number; y: number } | null;
  wasClicked(): boolean;
}

export function createInput(canvas: HTMLCanvasElement, target: Window = window): InputState {
  const keysDown = new Set<string>();
  let pointerPosition: { x: number; y: number } | null = null;
  let clicked = false;

  target.addEventListener('keydown', (event) => keysDown.add(event.key));
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
