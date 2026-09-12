export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  clear(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to acquire 2D rendering context');
  }

  function resize(): void {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    canvas,
    context,
    clear() {
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
