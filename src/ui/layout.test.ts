// Layer 2 (.plans/testing-strategy.md): pure rect-geometry regression tests. Every function
// under test here takes numbers in and returns a Rect out — no canvas, no DOM. Four of the
// seven bugs in .plans/playtest-findings.md (B1, B2, B5, F6) were exactly this shape: two
// rects overlapping, or a rect not fitting inside its container, at a real canvas size.
import { describe, it, expect } from 'vitest';
import {
  type Rect,
  getBuildPanelEntryRect,
  getHudBarRect,
  getMuteButtonRect,
  getRecenterButtonRect,
  getOffersModalRect,
  getOffersModalCardRect,
  getOffersModalButtonRect,
  getJobsModalRect,
  getJobsModalContentRect,
  getJobsModalContentHeight,
  getJobsModalCloseButtonRect,
  getRackPanelRect,
  getRackPanelContentRect,
  getServerRowRect,
  getTrayCardRect,
  getTrayDropRect,
  getShopPanelRect,
  getShopRowRect,
  getShopBuyButtonRect,
  getGameViewportRect,
  getTutorialBannerRect,
  getTutorialActionButtonRect,
  getTutorialSkipRect,
} from './layout';
import { BUILDABLES } from '../ecs/components';
import { MAX_OFFERS } from '../ecs/game-data';

// A handful of real sizes this game has actually shipped bugs at — see
// .plans/playtest-findings.md B1 (any width) and B5 (<=~1100px wide).
const CANVAS_SIZES: [number, number][] = [
  [820, 600],
  [1100, 700],
  [1280, 800],
];

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function isWithin(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + 0.01 &&
    inner.y + inner.height <= outer.y + outer.height + 0.01
  );
}

describe('build panel', () => {
  it('entries never overlap each other', () => {
    for (const [, h] of CANVAS_SIZES) {
      for (let i = 0; i < BUILDABLES.length; i++) {
        for (let j = i + 1; j < BUILDABLES.length; j++) {
          expect(rectsOverlap(getBuildPanelEntryRect(i, h), getBuildPanelEntryRect(j, h))).toBe(false);
        }
      }
    }
  });
});

describe('HUD bar / mute / recenter buttons', () => {
  it('mute and recenter buttons stay within the canvas at every known width', () => {
    for (const [w] of CANVAS_SIZES) {
      const bar = getHudBarRect(w);
      const mute = getMuteButtonRect(w);
      const recenter = getRecenterButtonRect(w);
      expect(isWithin(mute, bar)).toBe(true);
      expect(isWithin(recenter, bar)).toBe(true);
    }
  });

  it('recenter sits to the left of mute, and they never overlap (B5: HUD items collided below ~1100px)', () => {
    for (const [w] of CANVAS_SIZES) {
      const mute = getMuteButtonRect(w);
      const recenter = getRecenterButtonRect(w);
      expect(recenter.x + recenter.width).toBeLessThanOrEqual(mute.x);
      expect(rectsOverlap(mute, recenter)).toBe(false);
    }
  });
});

describe('offers modal (F6 regression: offer card slots reflowed under the cursor)', () => {
  it('every slot rect stays fully distinct from every other slot, at every known canvas size', () => {
    for (const [w, h] of CANVAS_SIZES) {
      for (let a = 0; a < MAX_OFFERS; a++) {
        for (let b = a + 1; b < MAX_OFFERS; b++) {
          expect(rectsOverlap(getOffersModalCardRect(a, w, h), getOffersModalCardRect(b, w, h))).toBe(
            false,
          );
        }
      }
    }
  });

  it('accept/decline buttons fit inside their own card, for every slot', () => {
    for (const [w, h] of CANVAS_SIZES) {
      for (let slot = 0; slot < MAX_OFFERS; slot++) {
        const card = getOffersModalCardRect(slot, w, h);
        expect(isWithin(getOffersModalButtonRect(slot, 'accept', w, h), card)).toBe(true);
        expect(isWithin(getOffersModalButtonRect(slot, 'decline', w, h), card)).toBe(true);
      }
    }
  });

  it('accept and decline buttons in the same slot never overlap each other', () => {
    for (const [w, h] of CANVAS_SIZES) {
      for (let slot = 0; slot < MAX_OFFERS; slot++) {
        expect(
          rectsOverlap(
            getOffersModalButtonRect(slot, 'accept', w, h),
            getOffersModalButtonRect(slot, 'decline', w, h),
          ),
        ).toBe(false);
      }
    }
  });

  it('the modal never exceeds the canvas bounds', () => {
    for (const [w, h] of CANVAS_SIZES) {
      const modal = getOffersModalRect(w, h);
      expect(modal.x).toBeGreaterThanOrEqual(0);
      expect(modal.y).toBeGreaterThanOrEqual(0);
      expect(modal.x + modal.width).toBeLessThanOrEqual(w + 0.01);
      expect(modal.y + modal.height).toBeLessThanOrEqual(h + 0.01);
    }
  });
});

describe('jobs modal', () => {
  it('the scrollable content rect stays within the outer modal rect, for any job counts', () => {
    for (const [w, h] of CANVAS_SIZES) {
      for (const pendingCount of [0, 1, 8]) {
        for (const activeCount of [0, 1, 8]) {
          const contentHeight = getJobsModalContentHeight(pendingCount, activeCount);
          const modal = getJobsModalRect(w, h, contentHeight);
          const content = getJobsModalContentRect(w, h, contentHeight);
          expect(isWithin(content, modal)).toBe(true);
        }
      }
    }
  });

  it('the close button fits inside the modal', () => {
    for (const [w, h] of CANVAS_SIZES) {
      const contentHeight = getJobsModalContentHeight(3, 3);
      const modal = getJobsModalRect(w, h, contentHeight);
      expect(isWithin(getJobsModalCloseButtonRect(w, h, contentHeight), modal)).toBe(true);
    }
  });

  it('content height grows with more jobs rather than truncating (unlike the old docked panel)', () => {
    const fewer = getJobsModalContentHeight(1, 1);
    const more = getJobsModalContentHeight(5, 5);
    expect(more).toBeGreaterThan(fewer);
  });
});

describe(
  'tutorial banner (B1 regression: the banner used to sit on top of the shop door, ' +
    'blocking clicks the tutorial itself required). The offers/workload columns this used to ' +
    'also check against are gone — both are toggled modals now (.plans/job-panels.md), and a ' +
    'modal already absorbs every click while open regardless of whether the banner overlaps it.',
  () => {
    it('never overlaps the build panel at any known canvas size', () => {
      for (const [w, h] of CANVAS_SIZES) {
        const banner = getTutorialBannerRect(w, h);
        for (let i = 0; i < BUILDABLES.length; i++) {
          expect(rectsOverlap(banner, getBuildPanelEntryRect(i, h))).toBe(false);
        }
      }
    });

    it('stays within the canvas bounds', () => {
      for (const [w, h] of CANVAS_SIZES) {
        const banner = getTutorialBannerRect(w, h);
        expect(banner.x).toBeGreaterThanOrEqual(0);
        expect(banner.y).toBeGreaterThanOrEqual(0);
        expect(banner.x + banner.width).toBeLessThanOrEqual(w + 0.01);
        expect(banner.y + banner.height).toBeLessThanOrEqual(h + 0.01);
      }
    });

    it('action and skip buttons fit inside the banner', () => {
      for (const [w, h] of CANVAS_SIZES) {
        const banner = getTutorialBannerRect(w, h);
        expect(isWithin(getTutorialActionButtonRect(w, h), banner)).toBe(true);
        expect(isWithin(getTutorialSkipRect(w, h), banner)).toBe(true);
      }
    });
  },
);

describe('rack panel', () => {
  it('the scrollable content rect stays within the outer panel rect', () => {
    for (const [w, h] of CANVAS_SIZES) {
      for (const serverCount of [0, 1, 6]) {
        for (const trayCount of [0, 1, 10]) {
          const panel = getRackPanelRect(w, h, serverCount, trayCount);
          const content = getRackPanelContentRect(w, h, serverCount, trayCount);
          expect(isWithin(content, panel)).toBe(true);
        }
      }
    }
  });

  it('server rows never overlap each other', () => {
    const [w, h] = [1280, 800];
    const serverCount = 6; // RACK_SLOT_CAPACITY
    const trayCount = 4;
    const rows = Array.from({ length: serverCount }, (_, i) => getServerRowRect(i, w, h, serverCount, trayCount));
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        expect(rectsOverlap(rows[i], rows[j])).toBe(false);
      }
    }
  });

  it('tray cards never overlap each other, including when they wrap onto multiple rows', () => {
    const [w, h] = [1280, 800];
    const serverCount = 2;
    const trayCount = 12; // forces wrapping at the panel's fixed width
    const cards = Array.from({ length: trayCount }, (_, i) => getTrayCardRect(i, w, h, serverCount, trayCount));
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        expect(rectsOverlap(cards[i], cards[j])).toBe(false);
      }
    }
  });

  it('the tray drop target sits below every server row', () => {
    const [w, h] = [1280, 800];
    const serverCount = 3;
    const trayCount = 2;
    const lastRow = getServerRowRect(serverCount - 1, w, h, serverCount, trayCount);
    const trayDrop = getTrayDropRect(w, h, serverCount, trayCount);
    expect(trayDrop.y).toBeGreaterThanOrEqual(lastRow.y + lastRow.height);
  });
});

describe('shop panel', () => {
  it('buy buttons fit inside their own row, and rows never overlap', () => {
    const [w, h] = [1280, 800];
    const rowCount = 6;
    const rows = Array.from({ length: rowCount }, (_, i) => getShopRowRect(i, w, h, rowCount));
    for (let i = 0; i < rows.length; i++) {
      expect(isWithin(getShopBuyButtonRect(i, w, h, rowCount), rows[i])).toBe(true);
      for (let j = i + 1; j < rows.length; j++) {
        expect(rectsOverlap(rows[i], rows[j])).toBe(false);
      }
    }
  });

  it('the panel never exceeds the canvas bounds, even with many rows', () => {
    for (const [w, h] of CANVAS_SIZES) {
      const panel = getShopPanelRect(w, h, 20);
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(w + 0.01);
      expect(panel.y + panel.height).toBeLessThanOrEqual(h + 0.01);
    }
  });
});

describe('game viewport', () => {
  it('never goes negative even on a very narrow canvas', () => {
    const viewport = getGameViewportRect(200, 200);
    expect(viewport.width).toBeGreaterThanOrEqual(0);
    expect(viewport.height).toBeGreaterThanOrEqual(0);
  });

  it('fills the full canvas width below the top bar (no docked side columns to reserve)', () => {
    const [w, h] = [1280, 800];
    const viewport = getGameViewportRect(w, h);
    expect(viewport.x).toBe(0);
    expect(viewport.width).toBe(w);
    expect(viewport.y).toBeGreaterThan(0); // top HUD bar still reserved
    expect(viewport.height).toBeLessThan(h);
  });
});
