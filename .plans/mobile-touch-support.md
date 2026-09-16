# Mobile/tablet support: touch input, pinch-zoom, touch-friendly UI

## Context

Today the game only understands a mouse and a keyboard:

- `src/input/index.ts` listens for `mousedown`/`mouseup`/`mousemove`/`click`/`wheel`/`contextmenu`
  only — no `touch*` or `pointer*` events exist anywhere in the codebase.
- `src/camera/index.ts`'s `Camera` has no zoom concept at all — `worldToScreen`/`screenToWorld`
  are a pure translate, and panning is WASD-only with space to re-center (both keyboard-only).
- `src/rendering/index.ts`'s `resize()` sets `canvas.width = canvas.clientWidth` with no
  `devicePixelRatio` scaling, so on any high-DPI screen (every current phone/tablet) the canvas
  backing buffer is upscaled by the browser and everything drawn looks soft/blurry.
- `src/ui/layout.ts`'s smallest interactive hit-rects (mute button 24px, offer accept/decline
  22px tall, rack/shop close buttons 24px) are under the ~44×44px minimum generally recommended
  for touch targets (Apple HIG, WCAG 2.5.5) — comfortable for a mouse cursor, easy to mis-tap
  with a finger.

`index.html` already has `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
and the canvas fills the window via CSS, so the page itself is mobile-sized correctly — the gap
is entirely in input handling, camera zoom, rendering sharpness, and hit-target size, not layout.

Goal: make the existing interaction model (tap-to-move-and-open-panels, drag-and-drop dispatch,
build panel) work with a finger, add zoom so the floor is legible at phone size, and fix the two
rendering issues (DPR blur, small hit targets) that would otherwise make it work but feel bad.

## Design decisions

**D1 — Touch rides the existing input pipeline via Pointer Events, not a parallel touch path.**
Switch `src/input/index.ts`'s mouse-specific listeners to the Pointer Events API
(`pointerdown`/`pointermove`/`pointerup`/`pointercancel`), which unifies mouse, touch, and pen
into one event stream with the same `clientX`/`clientY` semantics already used, and is supported
by every current mobile/desktop browser. `input.ts`'s click-priority chain, the drag lifecycle in
`rack-panel.ts`, and every hit-test in `ui/layout.ts` stay untouched — they only see
`wasClicked`/`wasPressed`/`wasReleased`/pointer position, same as today. Native `click` still
fires for a tap (kept as-is for `wasClicked`). Add `touch-action: none` on the canvas plus
`event.preventDefault()` in the pointer handlers so the browser doesn't hijack two-finger
gestures as page pinch-zoom/scroll before we see them.

**D2 — Zoom is one `Camera.scale` feature with two input sources, not a touch-only special case.**
Pinch-to-zoom (touch) and ctrl+wheel (the standard trackpad-pinch signal browsers emit,
`event.ctrlKey` on a `wheel` event) both feed a single `getZoomDelta()` consumed-on-read signal —
one thing for `camera.ts` to read, mirroring how it already reads WASD+space from one
`InputState`. Confirmed from `render.ts` (`createRenderSystem`) that `camera.applyTransform`
wraps only the floor/rack/player drawing, and HUD/panels are drawn afterward in screen space
following `camera.resetTransform` — so zoom only rescales the world view and needs **zero**
changes to `ui/layout.ts`'s HUD/panel hit-testing. Clamp `scale` (e.g. 0.6x–2x) so pathing clicks
and the HUD-safe viewport (`getGameViewportRect`) stay sane at both extremes.

**D3 — Drag-to-pan on empty floor, uniformly for mouse and touch.** The only keyboard-only
affordance with no existing equivalent is camera panning (WASD) and re-centering (space) — build
hotkeys and Esc-cancel already have tap-equivalents (panel entries are already tappable, shop/rack
panels already have close buttons, build-mode cancel already works by re-tapping the same panel
entry). Add: a drag (press + move past a small threshold, as opposed to a tap) on empty floor —
no build mode, no panel open, not starting on a rack — pans the camera and sets the same
`detached` flag WASD panning sets. Applying this to both input sources (rather than gating on
"was this a touch pointer") avoids two interaction models for the same gesture and keeps `input.ts`
free of pointer-type branching, consistent with D1. Needs a re-center trigger reachable without a
keyboard — natural fits from existing patterns are re-tapping the player or a small on-screen
button that only appears once `detached`; the render-only `hud.ts`/`render.ts` split makes either
a small addition, decide the exact affordance at implementation time.

**D4 — Bump touch-target constants for everyone, don't fork the layout.** Rather than a
mobile-specific geometry, raise the shared constants in `src/ui/layout.ts`
(`MUTE_BUTTON_SIZE`, `OFFER_BUTTON_HEIGHT`, `RACK_CLOSE_BUTTON_SIZE`, `SHOP_CLOSE_BUTTON_SIZE`,
`SHOP_BUY_BUTTON_HEIGHT`, `BUILD_PANEL_ENTRY_HEIGHT`) toward ~40-44px. Desktop mouse users lose
nothing from slightly larger buttons; maintaining one hit-testing geometry instead of two is worth
more than the pixels saved on desktop.

**D5 — Render at device-pixel resolution.** Fix `createRenderer`'s `resize()` once: size the
canvas backing buffer to `clientWidth/Height * devicePixelRatio` and apply a matching
`ctx.scale(dpr, dpr)`, so every existing drawing call keeps working in CSS-pixel coordinates with
no other call site touched. Also listen for `orientationchange` alongside `resize`, since some
mobile browsers don't fire a timely `resize` on rotation.

## Approach

1. **Pointer-event unification** (`src/input/index.ts`)
   - Replace `mousedown`/`mousemove` (canvas) and `mouseup` (window, unchanged target — see the
     existing comment on why it's window-bound) with `pointerdown`/`pointermove`/`pointerup`.
     Keep `click`, `contextmenu`, `wheel` as-is.
   - Add `touch-action: none` to the canvas and `preventDefault()` in the new handlers.
   - Track active pointers in a `Map<number, {x, y}>` keyed by `pointerId` (enough for two-finger
     pinch — this game has one player, no multi-touch gameplay beyond zoom, so a full multi-touch
     system would be solving a problem it doesn't have). Handle `pointercancel` the same way
     `mouseup` clears `pointerDown` today (an OS-interrupted touch, e.g. an incoming call, must
     not leave a stuck drag).
   - Add `getZoomDelta(): number` (consumed-on-read, same pattern as `wheelDeltaY`): accumulates
     pinch-distance delta between exactly two active pointers, plus `wheel` deltas where
     `event.ctrlKey` is true.

2. **Camera zoom** (`src/camera/index.ts`)
   - Add `scale` to `Camera` (default `1`), read/write like `x`/`y`.
   - `worldToScreen`/`screenToWorld` multiply/divide by `scale`; `applyTransform` adds
     `ctx.scale(scale, scale)` — keep the translate/scale order consistent with
     `worldToScreen`'s math (pick one, comment why).
   - `update()` reads `input.getZoomDelta()`, eases `scale` toward the new clamped value
     (0.6–2x) the same way position already eases, so a single pinch frame doesn't jump.
   - `clampAxis`'s viewport-size argument must divide by `scale` (the world-space extent the
     viewport shows changes with zoom) or panning clamps go wrong once zoomed.

3. **Drag-to-pan on empty floor** (`src/camera/index.ts` or `src/ecs/systems/input.ts` — decide
   at implementation time; `camera.ts` already owns `detached` and reads `InputState` directly,
   which may be the smaller change) — per D3: a press-then-move-past-threshold on empty floor
   (no build mode, no panel open, no rack under the initial press) pans the camera and sets
   `detached`. Must not fire on what's actually a tap-to-walk (small movement, quick release) —
   use a distance/time threshold, mirroring how `rack-panel.ts` already distinguishes a drag from
   a click for its own gestures (see `docs/ecs-systems/input.md`'s drag lifecycle notes). Add a
   re-center affordance reachable without a keyboard (exact UI decided at implementation time).

4. **Touch-friendly hit targets** — bump the constants named in D4 in `src/ui/layout.ts`.

5. **Rack panel scroll-by-drag** (`src/ecs/systems/rack-panel.ts`) — today `RackScroll` only
   moves on `wheel`. Add: a drag that starts inside the panel's content area but doesn't hit a
   chip/tray card (i.e. `tryStartDrag` finds nothing to pick up) adjusts `RackScroll` by the
   drag's vertical delta instead, reusing the existing `maxRackScroll` clamp.

6. **Device-pixel-ratio rendering** (`src/rendering/index.ts`) — per D5.

7. **Follow-up polish, not required for this plan:** on-screen +/- zoom buttons as a fallback for
   trackpad-only laptops without ctrl+wheel muscle memory; `viewport-fit=cover` + safe-area inset
   padding if the game ever runs fullscreen/as an installed PWA on a notched phone.

## Files modified

- `src/input/index.ts` — pointer events, multi-pointer tracking, `getZoomDelta`, `touch-action`
- `src/camera/index.ts` — `scale`, zoom easing/clamping, scale-aware pan clamp, drag-to-pan (or
  `src/ecs/systems/input.ts`, see step 3)
- `src/ecs/systems/rack-panel.ts` — scroll-by-drag on non-item touch
- `src/ui/layout.ts` — bump touch-target constants
- `src/rendering/index.ts` — DPR-aware canvas sizing, `orientationchange` listener

## Trade-offs

- **Pointer Events vs. separate touch listeners** — one code path for mouse+touch+pen instead of
  maintaining `mousedown`/`touchstart`/etc. in parallel; the whole existing click-priority chain
  and drag lifecycle stay untouched. Cost: a marginally less universally-known API than raw touch
  events, but it's the standard modern choice for canvas games needing both input types.
- **Zoom clamped to 0.6–2x rather than unbounded** — keeps click-to-grid-cell math and pathing
  sane and stops zooming out past the HUD-safe viewport showing less floor than a rack's width.
- **Touch-target constants raised for everyone, not just mobile** — one hit-testing geometry
  instead of two, at the cost of marginally larger desktop buttons.
- **Drag-to-pan applies to mouse too, not gated to touch** — avoids branching `input.ts` on
  pointer type for one gesture; today a mouse-drag on empty floor already does nothing but walk
  on release (no floor-drag threshold exists yet), so this is a net-new but low-risk desktop
  behavior change, not a regression.
- **No separate mobile layout/breakpoint system** — deliberately out of scope. The panels already
  clamp their width to the canvas (`Math.min(PANEL_WIDTH, canvasWidth - margins)` throughout
  `ui/layout.ts`), so narrow phone screens already reflow reasonably; this plan doesn't redesign
  panel content for small screens, only makes existing panels tappable and legible.

## Verification

Per CLAUDE.md, verification is manual — no browser automation, no starting the project from an
agent.

- `npm run lint` and `npm run build` pass.
- On an actual touchscreen device, or Chrome DevTools' device toolbar:
  - Tap the floor → player walks there (unchanged from mouse click).
  - Two-finger pinch in/out on the floor → world zooms smoothly within the clamped range; HUD bar,
    side panels, and any open rack/shop panel stay the same on-screen size and stay tappable.
  - Ctrl+scroll on a trackpad also zooms (desktop/laptop parity check).
  - Single-finger drag on empty floor → camera pans and stops following the player; the re-center
    affordance brings it back to following.
  - Tap a rack → panel opens; drag a workload chip onto a server → placement works as with a
    mouse; drag on the panel's empty background (not a chip/card) → panel content scrolls.
  - Mute button, offer accept/decline, shop buy buttons, and panel close buttons are all
    comfortably tappable without hitting a neighboring control.
  - Rotate the device / resize the window → canvas resizes and stays crisp (no blur) at the new
    size and pixel ratio.
  - Regression check on desktop: WASD pan + space re-center, number-key build hotkeys, and mouse
    click/drag/wheel all still behave exactly as before.
