// Render-frame-rate tracker — sampled once per requestAnimationFrame tick by the game loop
// (src/core/index.ts), read by hud.ts to draw the counter. Not ECS state: it measures the rAF
// callback cadence itself, not anything about an entity, so it's a small standalone module
// (same shape as camera.ts/audio.ts) rather than a component/system.
export interface FpsCounter {
  readonly value: number;
  sample(nowMs: number): void;
}

// Averaging over a short rolling window smooths out single-frame jitter (e.g. GC pauses) while
// still reacting to a sustained drop within about half a second.
const SAMPLE_WINDOW_MS = 500;

export function createFpsCounter(): FpsCounter {
  const frameTimestamps: number[] = [];
  let value = 0;

  return {
    get value() {
      return value;
    },
    sample(nowMs: number) {
      frameTimestamps.push(nowMs);
      const cutoff = nowMs - SAMPLE_WINDOW_MS;
      while (frameTimestamps.length > 0 && frameTimestamps[0] < cutoff) {
        frameTimestamps.shift();
      }
      if (frameTimestamps.length < 2) return;
      const elapsedSeconds =
        (frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0]) / 1000;
      if (elapsedSeconds <= 0) return;
      value = (frameTimestamps.length - 1) / elapsedSeconds;
    },
  };
}
