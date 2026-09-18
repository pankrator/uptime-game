// Standalone raw input tracker: listens for key presses, mouse movement, and mouse clicks, and
// keeps a snapshot of current input state between frames. Deliberately separate from
// src/input/index.ts (which owns gesture interpretation — drag lifecycle, wheel/pinch zoom,
// long-press, tap-vs-drag detection — for the ECS input system). This module does none of that:
// it only tracks raw state for later integration elsewhere.

export interface InputStateSnapshot {
  keysDown: ReadonlySet<string>;
  mouseX: number;
  mouseY: number;
  mouseButtonsDown: ReadonlySet<number>;
}

export interface InputStateTracker {
  getState(): InputStateSnapshot;
  dispose(): void;
}

export function createInputStateTracker(
  canvas: HTMLCanvasElement,
  target: Window = window,
): InputStateTracker {
  const keysDown = new Set<string>();
  const mouseButtonsDown = new Set<number>();
  let mouseX = 0;
  let mouseY = 0;

  function handleKeyDown(event: KeyboardEvent): void {
    keysDown.add(event.key);
  }
  function handleKeyUp(event: KeyboardEvent): void {
    keysDown.delete(event.key);
  }
  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);

  function updateMousePosition(event: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
  }
  function handleMouseMove(event: MouseEvent): void {
    updateMousePosition(event);
  }
  function handleMouseDown(event: MouseEvent): void {
    updateMousePosition(event);
    mouseButtonsDown.add(event.button);
  }
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mousedown', handleMouseDown);

  // Released on the window, not the canvas: a button pressed on the canvas and released after
  // the pointer has left it must still clear mouseButtonsDown, or it would be stuck "down".
  function handleMouseUp(event: MouseEvent): void {
    mouseButtonsDown.delete(event.button);
  }
  target.addEventListener('mouseup', handleMouseUp);

  return {
    getState() {
      return { keysDown, mouseX, mouseY, mouseButtonsDown };
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
