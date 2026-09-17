// Sprite asset generator — writes the PNG files under assets/sprites/.
//
// These are STANDALONE ASSETS: nothing in src/ loads them yet, the game still draws every
// entity procedurally in src/ecs/systems/render.ts. The art here deliberately reuses that
// file's palette and proportions (GRID_CELL_SIZE 40 with RACK_PADDING 4 => 32px structures,
// RACK_SLOT_CAPACITY 6 slots per rack, PLAYER_RADIUS 12 => a 24x32 character) so that wiring
// a sprite path into the renderer later is a swap, not a redesign.
//
// Run with:  npm run sprites
//
// Written as plain erasable TypeScript so `node --experimental-strip-types` runs it with no
// build step and no new dependencies — PNG encoding is node:zlib plus a CRC table.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

function encodePng(sprite: Sprite): Uint8Array {
  const { width, height, pixels } = sprite;

  // One filter byte (0 = None) per scanline. Pixel art compresses well enough that picking a
  // smarter filter per row would save bytes nobody is counting.
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

// ---------------------------------------------------------------------------
// Raster primitives
// ---------------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

/** '#rgb' | '#rrggbb' | '#rrggbbaa' -> RGBA tuple. */
function color(hex: string): Rgba {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('');
  if (h.length === 6) h += 'ff';
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    parseInt(h.slice(6, 8), 16),
  ];
}

/** Lighten (amount > 0) or darken (amount < 0) toward white/black, keeping alpha. */
function shade(c: Rgba, amount: number): Rgba {
  const mix = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return [mix(c[0]), mix(c[1]), mix(c[2]), c[3]];
}

const TRANSPARENT: Rgba = [0, 0, 0, 0];

class Sprite {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  get(x: number, y: number): Rgba {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return TRANSPARENT;
    const i = (y * this.width + x) * 4;
    return [this.pixels[i], this.pixels[i + 1], this.pixels[i + 2], this.pixels[i + 3]];
  }

  /** Source-over blend of one pixel. Out-of-bounds writes are dropped, not wrapped. */
  set(x: number, y: number, c: Rgba): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (c[3] === 0) return;

    const i = (y * this.width + x) * 4;
    if (c[3] === 255) {
      this.pixels[i] = c[0];
      this.pixels[i + 1] = c[1];
      this.pixels[i + 2] = c[2];
      this.pixels[i + 3] = 255;
      return;
    }

    const sa = c[3] / 255;
    const da = this.pixels[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    for (let k = 0; k < 3; k++) {
      this.pixels[i + k] = Math.round((c[k] * sa + this.pixels[i + k] * da * (1 - sa)) / oa);
    }
    this.pixels[i + 3] = Math.round(oa * 255);
  }

  /** Overwrite (no blending) — used when a shape must punch a hole or reset a pixel. */
  put(x: number, y: number, c: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = c[0];
    this.pixels[i + 1] = c[1];
    this.pixels[i + 2] = c[2];
    this.pixels[i + 3] = c[3];
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  strokeRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    this.hLine(x, x + w - 1, y, c);
    this.hLine(x, x + w - 1, y + h - 1, c);
    this.vLine(x, y, y + h - 1, c);
    this.vLine(x + w - 1, y, y + h - 1, c);
  }

  hLine(x0: number, x1: number, y: number, c: Rgba): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }

  vLine(x: number, y0: number, y1: number, c: Rgba): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
    // Bresenham — pixel art wants hard edges, so no anti-aliasing anywhere in this file.
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: Rgba): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) this.set(x, y, c);
      }
    }
  }

  strokeCircle(cx: number, cy: number, r: number, c: Rgba): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r && d > r - 1) this.set(x, y, c);
      }
    }
  }

  blit(source: Sprite, dx: number, dy: number): void {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const c = source.get(x, y);
        if (c[3] !== 0) this.set(dx + x, dy + y, c);
      }
    }
  }

  /** Mirrors horizontally — the left-facing character frames are the right-facing ones flipped. */
  flippedX(): Sprite {
    const out = new Sprite(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) out.put(this.width - 1 - x, y, this.get(x, y));
    }
    return out;
  }

  /** Nearest-neighbour upscale for the @2x export — no smoothing, ever. */
  scaled(factor: number): Sprite {
    const out = new Sprite(this.width * factor, this.height * factor);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        out.put(x, y, this.get(Math.floor(x / factor), Math.floor(y / factor)));
      }
    }
    return out;
  }
}

/**
 * Wraps every opaque pixel in a 1px outline on the transparent side. Icons are authored as flat
 * silhouettes and get their contrast here, so a tweak to the outline colour is one edit rather
 * than one per icon.
 */
function outline(sprite: Sprite, c: Rgba): Sprite {
  const out = new Sprite(sprite.width, sprite.height);
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (sprite.get(x, y)[3] !== 0) continue;
      const neighbourFilled =
        sprite.get(x - 1, y)[3] !== 0 ||
        sprite.get(x + 1, y)[3] !== 0 ||
        sprite.get(x, y - 1)[3] !== 0 ||
        sprite.get(x, y + 1)[3] !== 0;
      if (neighbourFilled) out.put(x, y, c);
    }
  }
  out.blit(sprite, 0, 0);
  return out;
}

/**
 * Builds a sprite from rows of characters. '.' and ' ' are transparent; every other character
 * must have an entry in the palette. Readable source beats a pile of fillRect calls for anything
 * with an organic shape.
 */
function fromRows(rows: string[], palette: Record<string, string>): Sprite {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const sprite = new Sprite(width, height);
  const resolved: Record<string, Rgba> = {};
  for (const [key, hex] of Object.entries(palette)) resolved[key] = color(hex);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const c = resolved[ch];
      if (!c) throw new Error(`Row ${y} uses '${ch}', which is not in the palette`);
      sprite.put(x, y, c);
    }
  }
  return sprite;
}

// ---------------------------------------------------------------------------
// Palette — lifted from src/ecs/systems/render.ts so sprites and procedural
// drawing stay the same game visually.
// ---------------------------------------------------------------------------

const C = {
  floor: color('#1c1f22'),
  floorLine: color('#25292d'),
  floorSpeck: color('#23272b'),
  floorHole: color('#15181a'),

  rackBody: color('#3a3f47'),
  rackEdge: color('#20242a'),
  rackHeader: color('#474d56'),
  rackPlate: color('#5c646e'),
  rackPlinth: color('#2b3036'),
  slatEmpty: color('#22262b'),
  slatOn: color('#2e343b'),
  slatFailed: color('#3a2226'),

  ledIdle: color('#f7b731'),
  ledPartial: color('#4dabf7'),
  ledFull: color('#3ddc84'),
  ledAlert: color('#e5484d'),

  cracBody: color('#2b4a5c'),
  cracEdge: color('#1c333f'),
  cracWell: color('#1f3a48'),
  cracMetal: color('#6e93a8'),
  cracAccent: color('#5db3eb'),

  chassisEdge: color('#1a1d21'),
  chassisEar: color('#4a5058'),
  chassisScrew: color('#767e88'),
  bay: color('#20242a'),
  bayFace: color('#434a53'),

  skin: color('#e8b98a'),
  skinShade: color('#c99a6d'),
  eye: color('#26303a'),
  hair: color('#3a2e26'),
  hat: color('#f7b731'),
  hatShade: color('#c9901a'),
  vest: color('#2f6fb0'),
  vestShade: color('#24558a'),
  stripe: color('#f7b731'),
  collar: color('#cdd6de'),
  trousers: color('#2a3746'),
  shoe: color('#171b21'),
  ink: color('#10161c'),
};

// ---------------------------------------------------------------------------
// Racks — 32x32, matching GRID_CELL_SIZE 40 minus RACK_PADDING 4 on each side.
// ---------------------------------------------------------------------------

type SlotState = 'empty' | 'idle' | 'partial' | 'full' | 'offline' | 'failed';

const SLOT_FILL: Record<SlotState, Rgba> = {
  empty: C.slatEmpty,
  idle: C.slatOn,
  partial: C.slatOn,
  full: C.slatOn,
  offline: C.slatEmpty,
  failed: C.slatFailed,
};

const SLOT_LED: Record<SlotState, Rgba | null> = {
  empty: null,
  idle: C.ledIdle,
  partial: C.ledPartial,
  full: C.ledFull,
  offline: C.ledAlert,
  failed: C.ledAlert,
};

const RACK_SIZE = 32;
const RACK_SLOTS = 6; // RACK_SLOT_CAPACITY
const RAIL = shade(C.rackBody, -0.22); // cabinet rails between and beside the slats

/** One rack cabinet holding six 1U slats — the state of each slat is the whole sprite variant. */
function drawRack(slots: SlotState[]): Sprite {
  const s = new Sprite(RACK_SIZE, RACK_SIZE);

  s.fillRect(0, 0, RACK_SIZE, RACK_SIZE, C.rackBody);
  s.strokeRect(0, 0, RACK_SIZE, RACK_SIZE, C.rackEdge);
  s.hLine(1, RACK_SIZE - 2, 1, shade(C.rackBody, 0.12)); // top bevel

  // Header: a blank nameplate and two cage-nut holes, so the cabinet has a "front" even empty.
  s.fillRect(1, 1, RACK_SIZE - 2, 4, C.rackHeader);
  s.fillRect(4, 2, 11, 2, C.rackPlate);
  s.set(24, 2, C.rackEdge);
  s.set(27, 2, C.rackEdge);

  const bayTop = 6;
  for (let i = 0; i < slots.length; i++) {
    const state = slots[i];
    const y = bayTop + i * 4;

    s.fillRect(2, y, RACK_SIZE - 4, 3, SLOT_FILL[state]);
    s.hLine(2, RACK_SIZE - 3, y + 3, RAIL); // slat separator

    if (state !== 'empty') {
      // Vent hatch across the face and a mounting handle on the left.
      const vent = shade(SLOT_FILL[state], -0.28);
      for (let x = 8; x <= 22; x += 3) s.vLine(x, y, y + 2, vent);
      s.fillRect(4, y + 1, 2, 1, C.chassisEar);
    }

    const led = SLOT_LED[state];
    if (led) {
      s.fillRect(26, y + 1, 2, 1, led);
      s.set(25, y + 1, shade(led, -0.55)); // 1px glow smear, cheap depth
    }
  }

  // Vertical mounting rails down both sides of the bay — without them an empty cabinet is a
  // featureless dark rectangle.
  s.vLine(2, bayTop, bayTop + slots.length * 4 - 2, RAIL);
  s.vLine(RACK_SIZE - 3, bayTop, bayTop + slots.length * 4 - 2, RAIL);

  // Plinth
  s.fillRect(1, RACK_SIZE - 3, RACK_SIZE - 2, 2, C.rackPlinth);
  s.hLine(1, RACK_SIZE - 2, RACK_SIZE - 2, shade(C.rackPlinth, -0.35));
  return s;
}

function repeatSlots(state: SlotState, count: number): SlotState[] {
  return Array.from({ length: count }, () => state);
}

const RACK_VARIANTS: Record<string, SlotState[]> = {
  'rack-empty': repeatSlots('empty', RACK_SLOTS),
  'rack-partial': ['full', 'partial', 'idle', 'empty', 'empty', 'empty'],
  'rack-full': ['full', 'full', 'partial', 'full', 'full', 'partial'],
  'rack-offline': repeatSlots('offline', RACK_SLOTS),
  'rack-failed': ['full', 'failed', 'full', 'partial', 'empty', 'empty'],
};

// ---------------------------------------------------------------------------
// CRAC unit — same 32x32 footprint, two fan frames for a spin loop.
// ---------------------------------------------------------------------------

function drawCrac(frame: number): Sprite {
  const s = new Sprite(RACK_SIZE, RACK_SIZE);

  s.fillRect(0, 0, RACK_SIZE, RACK_SIZE, C.cracBody);
  s.strokeRect(0, 0, RACK_SIZE, RACK_SIZE, C.cracEdge);
  s.hLine(1, RACK_SIZE - 2, 1, shade(C.cracBody, 0.16));

  // Intake louvres along the top edge
  for (let y = 3; y <= 5; y += 2) s.hLine(4, RACK_SIZE - 5, y, shade(C.cracBody, -0.3));

  // Fan well
  const cx = 15.5;
  const cy = 18.5;
  s.fillCircle(cx, cy, 11, C.cracWell);
  s.strokeCircle(cx, cy, 11, C.cracEdge);
  s.strokeCircle(cx, cy, 10, shade(C.cracWell, 0.14));

  // Three blades, offset per frame so the two sprites alternate into a spin.
  const base = frame * (Math.PI / 3);
  for (let i = 0; i < 3; i++) {
    const a = base + (i * Math.PI * 2) / 3;
    const bladeColor = shade(C.cracMetal, -0.1);
    s.line(
      cx + Math.cos(a) * 3,
      cy + Math.sin(a) * 3,
      cx + Math.cos(a) * 9.5,
      cy + Math.sin(a) * 9.5,
      bladeColor,
    );
    const a2 = a + 0.22;
    s.line(
      cx + Math.cos(a2) * 4,
      cy + Math.sin(a2) * 4,
      cx + Math.cos(a2) * 9,
      cy + Math.sin(a2) * 9,
      shade(C.cracMetal, -0.35),
    );
  }

  s.fillCircle(cx, cy, 2.5, C.cracMetal);
  s.set(15, 18, shade(C.cracMetal, 0.3));

  // Corner bolts + a cold-air accent tick, so it reads as cooling and not just "a fan".
  for (const [bx, by] of [
    [2, 2],
    [29, 2],
    [2, 29],
    [29, 29],
  ]) {
    s.set(bx, by, C.cracMetal);
  }
  s.fillRect(25, 4, 3, 1, C.cracAccent);
  s.fillRect(26, 3, 1, 3, C.cracAccent);

  return s;
}

// ---------------------------------------------------------------------------
// Floor tiles — 32x32, tiling. Same base colours as drawBuilding().
// ---------------------------------------------------------------------------

function drawFloorTile(perforated: boolean): Sprite {
  const s = new Sprite(RACK_SIZE, RACK_SIZE);
  s.fillRect(0, 0, RACK_SIZE, RACK_SIZE, C.floor);

  // Tile seams on two edges only, so laid side by side the seams stay 1px, not 2px.
  s.hLine(0, RACK_SIZE - 1, 0, C.floorLine);
  s.vLine(0, 0, RACK_SIZE - 1, C.floorLine);

  if (perforated) {
    for (let y = 5; y < RACK_SIZE - 3; y += 6) {
      for (let x = 5; x < RACK_SIZE - 3; x += 6) {
        s.fillRect(x, y, 2, 2, C.floorHole);
        s.set(x + 2, y + 2, shade(C.floor, 0.1));
      }
    }
    s.strokeRect(2, 2, RACK_SIZE - 4, RACK_SIZE - 4, shade(C.floorLine, 0.08));
  } else {
    // A fixed scatter of specks — a hash of the coordinates, so the tile is identical on every
    // regeneration and never needs a random seed committed alongside it.
    for (let y = 2; y < RACK_SIZE; y++) {
      for (let x = 2; x < RACK_SIZE; x++) {
        if (((x * 37 + y * 61) ^ (x * y)) % 53 === 0) s.set(x, y, C.floorSpeck);
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Machine chassis — 64x16 front faces, one per MACHINE_TIERS entry. Sized for
// the rack panel's server rows rather than the 40px floor cell.
// ---------------------------------------------------------------------------

type TierId = 'budget' | 'basic' | 'dense' | 'storage' | 'memory';

const CHASSIS_W = 64;
const CHASSIS_H = 16;

function chassisShell(body: Rgba, led: Rgba): Sprite {
  const s = new Sprite(CHASSIS_W, CHASSIS_H);

  s.fillRect(0, 0, CHASSIS_W, CHASSIS_H, body);
  s.strokeRect(0, 0, CHASSIS_W, CHASSIS_H, C.chassisEdge);
  s.hLine(1, CHASSIS_W - 2, 1, shade(body, 0.14));
  s.hLine(1, CHASSIS_W - 2, CHASSIS_H - 2, shade(body, -0.25));

  // Rack ears with screws, both sides
  for (const ex of [1, CHASSIS_W - 5]) {
    s.fillRect(ex, 1, 4, CHASSIS_H - 2, C.chassisEar);
    s.set(ex + 1, 3, C.chassisScrew);
    s.set(ex + 1, CHASSIS_H - 4, C.chassisScrew);
  }

  // Power LED, same position on every tier so a row of them lines up in the panel.
  s.fillRect(7, 7, 2, 2, led);
  s.set(6, 7, shade(led, -0.6));
  s.set(6, 8, shade(led, -0.6));
  return s;
}

/** A recessed bay (drive carrier, blade slot, DIMM bank) with a lit face. */
function drawBay(
  s: Sprite,
  x: number,
  y: number,
  w: number,
  h: number,
  face: Rgba,
  led?: Rgba,
): void {
  s.fillRect(x, y, w, h, C.bay);
  s.fillRect(x, y, w, 1, shade(C.bay, -0.4));
  s.fillRect(x + 1, y + 1, w - 2, h - 2, face);
  if (led) s.fillRect(x + w - 2, y + h - 2, 1, 1, led);
}

function drawChassis(tier: TierId): Sprite {
  if (tier === 'budget') {
    const s = chassisShell(color('#2a2f35'), C.ledIdle);
    drawBay(s, 12, 4, 18, 8, shade(C.bayFace, -0.18));
    for (let x = 34; x <= 52; x += 3) s.vLine(x, 5, 10, shade(C.bay, 0.1));
    s.fillRect(33, 4, 21, 1, C.bay);
    s.fillRect(33, 11, 21, 1, C.bay);
    return s;
  }

  if (tier === 'basic') {
    const s = chassisShell(color('#2e343b'), C.ledFull);
    drawBay(s, 12, 3, 12, 10, C.bayFace, C.ledFull);
    drawBay(s, 25, 3, 12, 10, C.bayFace, C.ledFull);
    for (let x = 40; x <= 55; x += 2) s.vLine(x, 4, 11, shade(C.bay, 0.12));
    s.strokeRect(39, 3, 18, 10, C.bay);
    return s;
  }

  if (tier === 'dense') {
    // Blade chassis: eight vertical blades, each with its own LED.
    const s = chassisShell(color('#333a43'), C.ledPartial);
    for (let i = 0; i < 8; i++) {
      const x = 12 + i * 5;
      drawBay(s, x, 2, 4, 12, shade(C.bayFace, 0.06));
      s.fillRect(x + 1, 3, 2, 1, i % 3 === 2 ? C.ledIdle : C.ledPartial);
    }
    s.vLine(53, 2, 13, C.bay);
    s.fillRect(55, 5, 3, 6, shade(C.bayFace, -0.3));
    return s;
  }

  if (tier === 'storage') {
    // Sixteen drive carriers in two rows — the disk tier should look like disks.
    const s = chassisShell(color('#2e343b'), C.ledPartial);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 8; i++) {
        const x = 12 + i * 5;
        const y = 2 + row * 6;
        drawBay(s, x, y, 5, 6, shade(C.bayFace, -0.1), C.ledPartial);
        s.vLine(x + 2, y + 1, y + 4, shade(C.bayFace, -0.35));
      }
    }
    s.fillRect(54, 4, 4, 8, shade(C.bayFace, -0.3));
    return s;
  }

  // memory: DIMM banks standing on end, violet accent so it never reads as "storage".
  const accent = color('#a78bfa');
  const s = chassisShell(color('#31353f'), accent);
  for (let i = 0; i < 12; i++) {
    const x = 12 + i * 3;
    s.fillRect(x, 3, 2, 10, shade(C.bayFace, -0.05));
    s.fillRect(x, 3, 2, 1, accent);
    s.fillRect(x, 12, 2, 1, shade(C.bay, -0.2));
  }
  s.strokeRect(11, 2, 38, 12, C.bay);
  s.fillRect(52, 5, 6, 6, shade(C.bayFace, -0.3));
  s.fillRect(53, 6, 4, 1, accent);
  return s;
}

const CHASSIS_TIERS: TierId[] = ['budget', 'basic', 'dense', 'storage', 'memory'];

// ---------------------------------------------------------------------------
// The manager — 24x32 per frame, 4 facings x 3 walk frames.
//
// The torso/head is authored once per facing (rows 0-24) and the legs are drawn per frame
// underneath it, so a stride change is one function, not twelve edited pixel maps.
// ---------------------------------------------------------------------------

const MANAGER_W = 24;
const MANAGER_H = 32;
const LEGS_TOP = 25;

const MANAGER_PALETTE: Record<string, string> = {
  K: '#10161c',
  H: '#f7b731',
  h: '#c9901a',
  S: '#e8b98a',
  s: '#c99a6d',
  E: '#26303a',
  R: '#3a2e26',
  r: '#2b211b',
  V: '#2f6fb0',
  v: '#24558a',
  Y: '#f7b731',
  W: '#cdd6de',
};

const BODY_DOWN = [
  '........................',
  '........KKKKKKKK........',
  '.......KHHHHHHHHK.......',
  '......KHHHHHHHHHHK......',
  '.....KHHHHHHHHHHHHK.....',
  '.....KhhhhhhhhhhhhK.....',
  '.......KSSSSSSSSK.......',
  '.......KSSSSSSSSK.......',
  '.......KSEESSEESK.......',
  '.......KSSSSSSSSK.......',
  '.......KSsSSSSsSK.......',
  '.......KSSsssSSSK.......',
  '........KSSSSSSK........',
  '........KWWWWWWK........',
  '....KKKVVVVVVVVVVKKK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvYYYYYYYYvVVK....',
  '....KVVvYYYYYYYYvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KSSvVVVVVVVVvSSK....',
  '....KssvVVVVVVVVvssK....',
  '.....KKVVVVVVVVVVKK.....',
];

const BODY_UP = [
  '........................',
  '........KKKKKKKK........',
  '.......KHHHHHHHHK.......',
  '......KHHHHHHHHHHK......',
  '.....KHHHHHHHHHHHHK.....',
  '.....KhhhhhhhhhhhhK.....',
  '.......KRRRRRRRRK.......',
  '.......KRRRRRRRRK.......',
  '.......KRRRRRRRRK.......',
  '.......KRRRrrRRRK.......',
  '.......KRRrrrrRRK.......',
  '.......KRRrrrrRRK.......',
  '........KSSSSSSK........',
  '........KWWWWWWK........',
  '....KKKVVVVVVVVVVKKK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvYYYYYYYYvVVK....',
  '....KVVvYYYYYYYYvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KVVvVVVVVVVVvVVK....',
  '....KSSvVVVVVVVVvSSK....',
  '....KssvVVVVVVVVvssK....',
  '.....KKVVVVVVVVVVKK.....',
];

const BODY_RIGHT = [
  '........................',
  '........KKKKKKK.........',
  '.......KHHHHHHHK........',
  '......KHHHHHHHHHK.......',
  '......KhhhhhhhhhhhK.....',
  '......KhhhhhhhhhhhK.....',
  '........KSSSSSSK........',
  '........KSSSSSSK........',
  '........KSSSEESK........',
  '........KSSSSSSsK.......',
  '........KSsSSSSsK.......',
  '........KSssSSSK........',
  '.........KSSSSK.........',
  '........KWWWWWWK........',
  '......KKVVVVVVVVKK......',
  '......KVVVVVVVVVVK......',
  '......KVVVVVVVVVVK......',
  '......KVVVVVVVVVVK......',
  '......KVYYYYYYYYVK......',
  '......KVYYYYYYYYVK......',
  '......KVVVVVVVVVVK......',
  '......KVVVVVVVVVVK......',
  '......KVVVVVVVVVVK......',
  '......KvVVVVVVVVvK......',
  '.......KVVVVVVVVK.......',
];

type Facing = 'down' | 'up' | 'left' | 'right';

/** Trouser leg with an ink outline and a shoe at the bottom. */
function drawLeg(s: Sprite, x: number, w: number, bottom: number, shoeOut: number): void {
  s.fillRect(x, LEGS_TOP, w, bottom - LEGS_TOP - 1, C.trousers);
  s.vLine(x - 1, LEGS_TOP, bottom, C.ink);
  s.vLine(x + w, LEGS_TOP, bottom, C.ink);
  s.fillRect(x, LEGS_TOP + 1, 1, bottom - LEGS_TOP - 2, shade(C.trousers, 0.12));

  s.fillRect(x + Math.min(0, shoeOut), bottom - 1, w + Math.abs(shoeOut), 2, C.shoe);
  s.hLine(x + Math.min(0, shoeOut), x + w + Math.abs(shoeOut) - 1, bottom + 1, C.ink);
}

function drawManagerFrame(facing: Facing, frame: number): Sprite {
  const rows = facing === 'down' ? BODY_DOWN : facing === 'up' ? BODY_UP : BODY_RIGHT;
  const body = fromRows(rows, MANAGER_PALETTE);

  const s = new Sprite(MANAGER_W, MANAGER_H);
  s.blit(body, 0, 0);

  if (facing === 'down' || facing === 'up') {
    // Frame 0 stands square; 1 and 2 plant one foot and lift the other. The lifted leg also
    // tucks 1px inward — a purely vertical lift is almost invisible at 24px tall.
    const lift = frame === 0 ? [0, 0] : frame === 1 ? [0, 2] : [2, 0];
    drawLeg(s, 8 + (lift[0] > 0 ? 1 : 0), 3, 30 - lift[0], -1);
    drawLeg(s, 13 - (lift[1] > 0 ? 1 : 0), 3, 30 - lift[1], 1);
  } else {
    // Side view strides along x instead: back leg trails, front leg leads.
    const stride = frame === 0 ? 0 : frame === 1 ? 2 : -2;
    drawLeg(s, 9 - stride, 3, 29, -1); // back leg, drawn first so the front leg overlaps it
    drawLeg(s, 11 + stride, 3, 30, 1);

    // Swinging near arm, opposite phase to the front leg. It hangs at the leading edge of the
    // torso rather than over its middle, or the outline reads as a slab across the chest.
    const armX = 12 + (frame === 0 ? 0 : frame === 1 ? 1 : -1);
    s.fillRect(armX, 16, 3, 6, C.vest);
    s.fillRect(armX, 22, 3, 2, C.skin); // hand
    s.fillRect(armX, 18, 3, 2, C.stripe); // the hi-vis stripe carries across the sleeve
    s.vLine(armX, 16, 21, shade(C.vest, 0.18));
    s.vLine(armX - 1, 16, 23, C.ink);
    s.vLine(armX + 3, 16, 23, C.ink);
    s.hLine(armX - 1, armX + 3, 24, C.ink);
  }

  if (facing === 'left') return s.flippedX();
  return s;
}

const FACINGS: Facing[] = ['down', 'left', 'right', 'up'];
const WALK_FRAMES = 3;

// ---------------------------------------------------------------------------
// HUD icons — 16x16. Authored as flat silhouettes; outline() adds the contrast.
// ---------------------------------------------------------------------------

const ICON_SIZE = 16;
const ICON_OUTLINE = color('#0d1114');

const BOLT_ROWS = [
  '................',
  '........#####...',
  '.......#####....',
  '......#####.....',
  '.....#####......',
  '....##########..',
  '...#########....',
  '.......####.....',
  '......####......',
  '.....####.......',
  '....####........',
  '...####.........',
  '..#####.........',
  '...###..........',
  '....#...........',
  '................',
];

const FLAME_ROWS = [
  '................',
  '.......#........',
  '......##........',
  '......###.......',
  '.....####.......',
  '.....#####......',
  '....###o###.....',
  '....##ooo##.....',
  '...##ooooo##....',
  '...##ooooo##....',
  '..##oooooooo#...',
  '..##oooooooo#...',
  '..##oooooooo#...',
  '...##oooooo#....',
  '....########....',
  '......####......',
];

const WRENCH_ROWS = [
  '................',
  '...##...##......',
  '...##...##......',
  '...#######......',
  '....#####.......',
  '.....###........',
  '.....###........',
  '......###.......',
  '.......###......',
  '........###.....',
  '.........###....',
  '..........###...',
  '...........###..',
  '..........####..',
  '..........###...',
  '................',
];

const LAYERS_ROWS = [
  '................',
  '.......##.......',
  '.....######.....',
  '...##########...',
  '.##############.',
  '...##########...',
  '.....######.....',
  '.......##.......',
  '................',
  '.##..........##.',
  '..####....####..',
  '....########....',
  '................',
  '.##..........##.',
  '..####....####..',
  '....########....',
];

const NETWORK_ROWS = [
  '..###......###..',
  '.#####....#####.',
  '.#####....#####.',
  '..###......###..',
  '...#........#...',
  '...##########...',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '....########....',
  '.....######.....',
  '......####......',
  '................',
];

const THERMOMETER_ROWS = [
  '.......##.......',
  '......#oo#......',
  '......#oo#......',
  '......#oo#......',
  '......#oo#......',
  '......#rr#......',
  '......#rr#......',
  '......#rr#......',
  '......#rr#......',
  '.....#rrrr#.....',
  '....#rrrrrr#....',
  '....#rrrrrr#....',
  '....#rrrrrr#....',
  '.....#rrrr#.....',
  '......####......',
  '................',
];

const DOLLAR_ROWS = [
  '..#..',
  '.###.',
  '#.#.#',
  '#.#..',
  '.###.',
  '..#.#',
  '#.#.#',
  '.###.',
  '..#..',
];

function iconPower(): Sprite {
  return outline(fromRows(BOLT_ROWS, { '#': '#f7b731' }), ICON_OUTLINE);
}

function iconHeat(): Sprite {
  return outline(fromRows(FLAME_ROWS, { '#': '#e5484d', o: '#f7b731' }), ICON_OUTLINE);
}

function iconWrench(): Sprite {
  return outline(fromRows(WRENCH_ROWS, { '#': '#9aa0a6' }), ICON_OUTLINE);
}

function iconWorkload(): Sprite {
  return outline(fromRows(LAYERS_ROWS, { '#': '#4dabf7' }), ICON_OUTLINE);
}

function iconNetwork(): Sprite {
  return outline(fromRows(NETWORK_ROWS, { '#': '#3ddc84' }), ICON_OUTLINE);
}

function iconTemperature(): Sprite {
  return outline(
    fromRows(THERMOMETER_ROWS, { '#': '#cdd6de', o: '#6b7178', r: '#e5484d' }),
    ICON_OUTLINE,
  );
}

function iconCooling(): Sprite {
  // Six spokes with a V tick at each tip — geometry is easier to keep symmetric in code than
  // in a character map.
  const s = new Sprite(ICON_SIZE, ICON_SIZE);
  const c = color('#5db3eb');
  const cx = 7.5;
  const cy = 7.5;
  for (const deg of [90, 30, 150]) {
    const a = (deg * Math.PI) / 180;
    s.line(
      cx - Math.cos(a) * 7,
      cy - Math.sin(a) * 7,
      cx + Math.cos(a) * 7,
      cy + Math.sin(a) * 7,
      c,
    );
  }
  for (const deg of [90, 30, 150, 270, 210, 330]) {
    const a = (deg * Math.PI) / 180;
    const tx = cx + Math.cos(a) * 5.2;
    const ty = cy + Math.sin(a) * 5.2;
    for (const off of [0.9, -0.9]) {
      s.line(tx, ty, tx + Math.cos(a + off) * 2.6, ty + Math.sin(a + off) * 2.6, c);
    }
  }
  s.fillCircle(cx, cy, 1.6, shade(c, 0.35));
  return outline(s, ICON_OUTLINE);
}

function iconMoney(): Sprite {
  const s = new Sprite(ICON_SIZE, ICON_SIZE);
  const gold = color('#f2c94c');
  s.fillCircle(7.5, 7.5, 7, gold);
  s.strokeCircle(7.5, 7.5, 7, shade(gold, -0.35));
  s.strokeCircle(7.5, 7.5, 5.6, shade(gold, 0.25));
  s.blit(fromRows(DOLLAR_ROWS, { '#': '#6b4f11' }), 5, 3);
  return outline(s, ICON_OUTLINE);
}

function iconClock(): Sprite {
  const s = new Sprite(ICON_SIZE, ICON_SIZE);
  const face = color('#2a3037');
  const rim = color('#9aa0a6');
  s.fillCircle(7.5, 7.5, 7, face);
  s.strokeCircle(7.5, 7.5, 7, rim);
  for (const [x, y] of [
    [7, 1],
    [7, 14],
    [1, 7],
    [14, 7],
  ]) {
    s.set(x, y, shade(rim, 0.2));
  }
  s.line(7, 7, 7, 3, rim); // hour hand
  s.line(7, 7, 11, 9, rim); // minute hand
  s.set(7, 7, color('#f7b731'));
  return outline(s, ICON_OUTLINE);
}

function iconWarning(): Sprite {
  const s = new Sprite(ICON_SIZE, ICON_SIZE);
  const amber = color('#f7b731');
  for (let y = 1; y <= 14; y++) {
    const spread = Math.round(((y - 1) / 13) * 7);
    s.hLine(7 - spread, 8 + spread, y, amber);
  }
  s.fillRect(7, 5, 2, 5, color('#2a1d05')); // exclamation bar
  s.fillRect(7, 11, 2, 2, color('#2a1d05')); // exclamation dot
  return outline(s, ICON_OUTLINE);
}

function strokeMark(points: Array<[number, number]>, c: Rgba): Sprite {
  const s = new Sprite(ICON_SIZE, ICON_SIZE);
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    // Three parallel passes make a 3px-thick stroke without an anti-aliased brush.
    for (const off of [-1, 0, 1]) s.line(x0, y0 + off, x1, y1 + off, c);
  }
  return outline(s, ICON_OUTLINE);
}

function iconOk(): Sprite {
  return strokeMark(
    [
      [3, 8],
      [6, 11],
      [12, 4],
    ],
    color('#3ddc84'),
  );
}

function iconFail(): Sprite {
  const s = new Sprite(ICON_SIZE, ICON_SIZE);
  const red = color('#e5484d');
  for (const off of [-1, 0, 1]) {
    s.line(3, 3 + off, 12, 12 + off, red);
    s.line(12, 3 + off, 3, 12 + off, red);
  }
  return outline(s, ICON_OUTLINE);
}

const ICONS: Record<string, () => Sprite> = {
  'icon-power': iconPower,
  'icon-heat': iconHeat,
  'icon-cooling': iconCooling,
  'icon-temperature': iconTemperature,
  'icon-money': iconMoney,
  'icon-wrench': iconWrench,
  'icon-warning': iconWarning,
  'icon-workload': iconWorkload,
  'icon-network': iconNetwork,
  'icon-clock': iconClock,
  'icon-ok': iconOk,
  'icon-fail': iconFail,
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const OUT_ROOT = join(import.meta.dirname, '..', 'assets', 'sprites');
const SCALES = [1, 2]; // 2x covers CAMERA_ZOOM_MAX without resampling blur

interface SpriteEntry {
  width: number;
  height: number;
  files: Record<string, string>;
}

interface SheetFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SheetEntry {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  files: Record<string, string>;
  frames: Record<string, SheetFrame>;
}

const spriteManifest: Record<string, SpriteEntry> = {};
const sheetManifest: Record<string, SheetEntry> = {};

function writePng(relativePath: string, sprite: Sprite): void {
  const full = join(OUT_ROOT, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, encodePng(sprite));
}

/** Writes one sprite at every scale and records it in the manifest. */
function emit(name: string, sprite: Sprite): void {
  const files: Record<string, string> = {};
  for (const scale of SCALES) {
    const path = `${scale}x/${name}.png`;
    writePng(path, scale === 1 ? sprite : sprite.scaled(scale));
    files[`${scale}x`] = path;
  }
  spriteManifest[name] = { width: sprite.width, height: sprite.height, files };
}

/**
 * Packs frames into a uniform grid sheet. Uniform cells (not a tight atlas) keep the lookup a
 * multiply — the loader can index a frame without reading the manifest at all.
 */
function emitSheet(name: string, frames: Array<[string, Sprite]>, columns: number): void {
  const frameWidth = Math.max(...frames.map(([, s]) => s.width));
  const frameHeight = Math.max(...frames.map(([, s]) => s.height));
  const rows = Math.ceil(frames.length / columns);

  const sheet = new Sprite(frameWidth * columns, frameHeight * rows);
  const frameRects: Record<string, SheetFrame> = {};

  frames.forEach(([frameName, sprite], i) => {
    const x = (i % columns) * frameWidth;
    const y = Math.floor(i / columns) * frameHeight;
    sheet.blit(sprite, x + Math.floor((frameWidth - sprite.width) / 2), y);
    frameRects[frameName] = { x, y, w: frameWidth, h: frameHeight };
  });

  const files: Record<string, string> = {};
  for (const scale of SCALES) {
    const path = `sheets/${name}${scale === 1 ? '' : `@${scale}x`}.png`;
    writePng(path, scale === 1 ? sheet : sheet.scaled(scale));
    files[`${scale}x`] = path;
  }

  sheetManifest[name] = { frameWidth, frameHeight, columns, rows, files, frames: frameRects };
}

/** Contact sheet, one group per band, so the whole set can be eyeballed in one image. */
function buildPreview(groups: Array<Array<Sprite>>): Sprite {
  const scale = 2;
  const pad = 8;
  const bandGap = 10;

  const bandWidths = groups.map((group) =>
    group.reduce((sum, s) => sum + s.width * scale + pad, pad),
  );
  const bandHeights = groups.map(
    (group) => Math.max(...group.map((s) => s.height * scale)) + bandGap,
  );

  const width = Math.max(...bandWidths);
  const height = bandHeights.reduce((a, b) => a + b, 0) + bandGap;

  const preview = new Sprite(width, height);
  preview.fillRect(0, 0, width, height, color('#15181a'));

  let y = bandGap;
  groups.forEach((group, bandIndex) => {
    const bandHeight = bandHeights[bandIndex] - bandGap;
    preview.fillRect(0, y - 4, width, bandHeight + 8, color('#1c1f22'));
    preview.hLine(0, width - 1, y - 5, color('#25292d'));

    let x = pad;
    for (const sprite of group) {
      const scaled = sprite.scaled(scale);
      preview.blit(scaled, x, y + Math.floor((bandHeight - scaled.height) / 2));
      x += scaled.width + pad;
    }
    y += bandHeights[bandIndex];
  });

  return preview;
}

// Removed and rewritten on every run, so a renamed sprite leaves no stale PNG behind. Listed
// explicitly rather than wiping OUT_ROOT, which would take README.md with it.
const GENERATED_PATHS = ['1x', '2x', 'sheets', 'preview.png', 'sprites.json'];

function main(): void {
  for (const path of GENERATED_PATHS) {
    rmSync(join(OUT_ROOT, path), { recursive: true, force: true });
  }
  mkdirSync(OUT_ROOT, { recursive: true });

  const rackSprites: Array<[string, Sprite]> = Object.entries(RACK_VARIANTS).map(
    ([name, slots]) => [name, drawRack(slots)],
  );
  for (const [name, sprite] of rackSprites) emit(name, sprite);
  emitSheet('racks', rackSprites, rackSprites.length);

  const cracSprites: Array<[string, Sprite]> = [
    ['crac-0', drawCrac(0)],
    ['crac-1', drawCrac(1)],
  ];
  for (const [name, sprite] of cracSprites) emit(name, sprite);
  emitSheet('crac', cracSprites, cracSprites.length);

  const floorSprites: Array<[string, Sprite]> = [
    ['floor-tile', drawFloorTile(false)],
    ['floor-tile-vent', drawFloorTile(true)],
  ];
  for (const [name, sprite] of floorSprites) emit(name, sprite);

  const chassisSprites: Array<[string, Sprite]> = CHASSIS_TIERS.map((tier) => [
    `server-${tier}`,
    drawChassis(tier),
  ]);
  for (const [name, sprite] of chassisSprites) emit(name, sprite);
  emitSheet('servers', chassisSprites, 1);

  const managerSprites: Array<[string, Sprite]> = [];
  for (const facing of FACINGS) {
    for (let frame = 0; frame < WALK_FRAMES; frame++) {
      managerSprites.push([`manager-${facing}-${frame}`, drawManagerFrame(facing, frame)]);
    }
  }
  for (const [name, sprite] of managerSprites) emit(name, sprite);
  emitSheet('manager', managerSprites, WALK_FRAMES);

  const iconSprites: Array<[string, Sprite]> = Object.entries(ICONS).map(([name, make]) => [
    name,
    make(),
  ]);
  for (const [name, sprite] of iconSprites) emit(name, sprite);
  emitSheet('icons', iconSprites, 6);

  const preview = buildPreview([
    rackSprites.map(([, s]) => s),
    [...cracSprites, ...floorSprites].map(([, s]) => s),
    chassisSprites.map(([, s]) => s),
    managerSprites.filter((_, i) => i % WALK_FRAMES !== 3).map(([, s]) => s),
    iconSprites.map(([, s]) => s),
  ]);
  writePng('preview.png', preview);

  writeFileSync(
    join(OUT_ROOT, 'sprites.json'),
    `${JSON.stringify(
      {
        generator: 'tools/generate-sprites.ts',
        note: 'Standalone assets — not loaded by the game yet.',
        scales: SCALES,
        sprites: spriteManifest,
        sheets: sheetManifest,
      },
      null,
      2,
    )}\n`,
  );

  const total = Object.keys(spriteManifest).length;
  const sheets = Object.keys(sheetManifest).length;
  console.log(`Wrote ${total} sprites (x${SCALES.length} scales), ${sheets} sheets, preview.png`);
}

main();
