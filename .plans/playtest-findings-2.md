# Playtest findings, round 2: UI and click bugs, plus scenario validation

> **A findings report, not a feature plan.** Written from scripted browser sessions driving the
> real game through the real click chain (Vite dev server + Chromium, real
> `pointerdown`/`pointerup`/`wheel`/`keydown` on the canvas), not from reading the code. Every
> entry below has a reproduction with measured numbers.
>
> Round 1 lives in [`playtest-findings.md`](playtest-findings.md) — everything here is new
> except **U12** (its B7, still open) and **U11** (a gap left by its B5 fix). Nothing in this document has been fixed; entries are
> ordered by severity within each section.
>
> Promote an entry to its own `.plans/<name>.md` before implementing, per `ideas-backlog.md`.

## How this was measured

Chromium at DPR 1, viewports from 390×844 to 1920×1080, driving the game through real pointer
and keyboard events. Sessions run:

- the guided tutorial start to finish on a fresh save;
- ~4.5 minutes of steady-state play on a fresh save (2 Budget Boxes, one rack);
- ~5 minutes of steady-state play from the dev stress preset (8 racks, 24 servers);
- targeted probes for rack-panel scrolling, pointer sampling, right-click, decommission,
  overheating, brownout, hardware failure, save/load, and layout across seven viewport sizes.

Where a scenario needed a state that takes 20+ minutes to reach naturally (a rack hot enough to
trip, a machine at full wear, a facility at its power ceiling), the **setup** used the game's own
`spawnMachine` / `acceptOffer` / `placeWorkload` / `buy` functions; everything observed afterwards
is the live simulation with its normal systems running. Each such case says so.

---

## 1. Click and input bugs

### U1 — A scrolled rack panel repairs and decommissions the _wrong_ machine (destructive)

`input.ts` hit-tests the three interactive targets inside the rack panel's scrollable region —
`getServerRepairButtonRect`, `getServerDecommissionButtonRect`, `getTrayCardDropButtonRect` —
against the **raw screen pointer**. But `render.ts` draws that region translated by
`-scrollOffsetPx`, and `rack-panel.ts`'s drag path converts the pointer through
`toContentSpace` (which adds the scroll offset back and rejects pointers outside the content
viewport) precisely because the rects are laid out in unscrolled content space. The click path
skips that conversion, so as soon as the panel is scrolled, the button you see and the button
you hit are different rows.

Measured, 1280×800, one rack filled to 6 servers, panel scrolled down 172 px (one server row):

| clicked (as drawn)  | server under the cursor | what actually happened                                                                                                             |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Decommission, row 3 | id 45, "Server"         | confirm chip armed on id 5, **"Storage Array"** (row 2); second click queued `{kind:'decommission', machineId:5}` and destroyed it |
| Repair, row 3       | id 45, "Server"         | repair task started on id 5, **$152 debited immediately**                                                                          |

The decommission confirm gives no protection: both clicks land on the same wrong row, so the
"are you sure" step confirms the mistake instead of catching it.

The milder half is the same bug with a small offset — the button simply goes dead:

- 1280×720, a rack with **3** servers, wheel down 16 px (the maximum): clicking the drawn
  Decommission button of row 2 does nothing at all (`DecommissionConfirm` stays `undefined`).
- 6 servers + 1 tray card scrolled to the bottom (422 px): clicking the tray card's "✕"
  abandon button does nothing — the contract stays in the tray.

**This fires far more often than "a rack with 6 servers" suggests**, because of U2 below: the
rack panel is scrollable by 16 px in _every_ configuration, including an empty rack.

```
maxScroll by (servers/tray) at 1280×800: sc0..sc3 = 16px, sc4 = 78, sc5 = 250, sc6 = 422
                              at 800×600: sc0..sc2 = 16px, sc3 = 106, sc4 = 278, sc5 = 450, sc6 = 622
```

**Fix:** route those three hit-tests through the `toContentSpace` conversion `rack-panel.ts`
already owns (export it, or move the button hit-testing next to the drag hit-testing), including
its "pointer outside the visible content viewport → no hit" rule.

### U2 — Every rack panel is scrollable by 16 px even when nothing overflows

`getRackPanelContentHeight` = `serversHeight + RACK_PANEL_PADDING + trayHeight`, but the content
viewport `getRackPanelContentRect` is `panel.height - 82`, and the unclamped panel height is
`82 + serversHeight + trayHeight`. The extra `RACK_PANEL_PADDING` (16) in the content height has
no counterpart in the viewport, so `maxScroll` never reaches 0 (table above — an empty rack at
1920×1080 still scrolls 16 px).

Visible consequences: the tray strip's bottom 16 px is always clipped, a panel that visibly fits
still wobbles under the wheel, and — via U1 — a single stray wheel notch or drag-scroll over an
ordinary two-server rack is enough to make Repair/Decommission start hitting nothing.

**Fix:** drop the stray padding from `getRackPanelContentHeight` (or add it to the viewport), and
add a layout test pinning `maxScroll === 0` when the content fits.

### U3 — Clicks and drags are resolved wherever the pointer is up to 33 ms later

`input/index.ts` latches the gesture _edges_ (`wasPressed` / `wasReleased` / `wasClicked` are
one-shot booleans) but not the _positions_: `getPointerPosition()` always returns the live
pointer. The update loop runs at 30 Hz (`UPDATE_HZ` in `core/index.ts`), so every gesture is
resolved against wherever the mouse has travelled to by the next tick — up to 33 ms of movement
after the button went down or up. `pressOrigin` is already recorded inside the input module for
tap detection; nothing outside can see it.

**Repro A — a click lands somewhere else.** Player parked away from a rack; press and release on
the rack, then keep moving the mouse to an empty floor tile:

| gesture                                      | result                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| click the rack, pointer stays put            | rack panel opens (`{rackId:2, mode:'dispatching'}`), player walks to (140, 380) — the rack |
| click the rack, pointer moves on immediately | **no panel**; player walks to (300, 460) — the tile the cursor moved to                    |

Moving the mouse right after clicking is what everyone does. The result is a rack click that
silently becomes a floor click.

**Repro B — a quick drag never picks the card up.** Rack panel open and arrived, one contract in
the tray:

| drag                            | `DragState` created? | placed? | side effect                                   |
| ------------------------------- | -------------------- | ------- | --------------------------------------------- |
| mousedown → move immediately    | **no**               | no      | panel drag-scrolls instead (offset 0 → 16 px) |
| mousedown → 150 ms pause → move | yes                  | yes     | —                                             |

Because `tryStartDrag` sees the already-moved pointer, it finds no card there, so
`rack-panel.ts`'s drag-to-scroll takes the gesture instead. In a 4½-minute scripted session
_every_ dispatch failed this way (10+ consecutive drags) until the harness inserted a 150 ms hold
after mousedown; with the hold, every drag succeeded.

**Fix:** latch positions alongside the edges — expose `getPressPosition()` / `getReleasePosition()`
from `input/index.ts` (both already computable from `pressOrigin` and the pointerup point) and
have `input.ts` resolve drags at the press point and clicks at the release point.

### U4 — Right-click walks the player to the rack instead of viewing it remotely

D4's "inspecting a rack is remote" affordance does not work with a mouse. The `pointerdown` and
`pointerup` handlers never check `event.button`, so a right-click also sets `pressed`, `released`
and `clicked`. `input.ts`'s click chain runs before `rack-panel.ts`'s right-click handler, opens a
**dispatching** panel and calls `moveControlledTo`; by the time the right-click handler runs it
sees `mode === 'dispatching'` and deliberately no-ops.

Measured: player parked at the room's far corner, right-click on a rack across the floor →
`{rackId:2, mode:'dispatching', arrived:false}` with `moveTarget {x:140, y:380}`; 2.5 s later the
player is standing at the rack. Expected: `mode:'viewing'`, no movement.

(The long-press path on touch is unaffected — it sets `longPressFired`, which suppresses the tap.)

**Fix:** ignore non-primary buttons in the pointerdown/pointerup bookkeeping
(`if (event.button !== 0) return;` before claiming `primaryPointerId`).

### U5 — Silent no-ops: five actions that do nothing and say nothing

Each of these is a click a player will make, that produces no toast, no flash, and no cursor
change:

| action                                                        | what happens                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Repair with insufficient funds                                | `tryStartRepair` returns early — no task, no message (measured with $5 against a $94 repair)                                     |
| Press `2`..`6` then click a rack with 0 of that tier in stock | `tryInstallIntoRack` no-ops **and build mode is cleared anyway**, so the player is dropped out of build mode with nothing placed |
| Build-place a rack outside the room                           | refused (build mode does stay active)                                                                                            |
| Click outdoor void (not room/corridor/shop)                   | `moveControlledTo` finds no walkable goal, player doesn't move                                                                   |
| Click the HUD's `2 offers [O]` / `4 jobs [J]` chips           | nothing — they read as buttons but are keyboard-only (probed five x positions across both chips)                                 |

**Fix:** the toast system already exists (`effects.ts`) — "Not enough money for this repair",
"None in stock", "Racks must go inside the room" cost one line each. The two HUD chips should
either be clickable or stop looking like buttons.

### U6 — The shop panel traps the player until it is explicitly dismissed

The shop opens on proximity and, like every modal, absorbs every click that isn't its own
✕/tab/buy. So a player standing at the door cannot walk away by clicking the floor: four floor
clicks at different points all left the player at (1180, 100) with the panel still open. Escape
or the ✕ dismisses it, after which a corridor click works normally.

Related knife-edge, same area: `SHOP_REACH_PX` is exactly 80 and the natural pathing stop two
cells below the door is exactly 80.00 px from it, so whether the shop opens depends on
sub-pixel movement error — measured across two approaches in one session, player x = 1180.00
(distance 80.000, opened) vs x = 1179.43 (distance 80.002, **did not open**).

**Fix:** let a click on the floor outside the panel dismiss the shop and walk (the panel is a
proximity overlay, not a modal the player opened), and give `SHOP_REACH_PX` a little slack
(e.g. 100) so the obvious standing tile is unambiguously in range.

---

## 2. Layout and rendering bugs

### U7 — Tall modals slide under the HUD bar and lose the top of their ✕

Every centered modal sizes itself to `min(content, canvas − 2×padding)` and centers, so once it
is tall enough it starts at y = 16 — inside the 44 px HUD bar, which `pointerInHud` blocks before
the modal's own hit-testing runs.

Measured (1280×800, rack panel with 6 servers): close button rect is y 25..57, of which the top
19 px is dead.

| click y      | 28  | 34  | 40  | 43  | 45  | 50  | 55  |
| ------------ | --- | --- | --- | --- | --- | --- | --- |
| panel closes | ❌  | ❌  | ❌  | ❌  | ✅  | ✅  | ✅  |

The header text ("Rack — PLACING WORK") is painted behind the bar as well. Across the sweep: the
rack panel is affected at **every** size tested from 1920×1080 down to 390×844; the jobs modal at
900×600 and below; the offers modal at 844×390.

**Fix:** clamp modal tops to `HUD_BAR_HEIGHT + padding` rather than the canvas top (the
`getCenteredRect` helper is the single place for it).

### U8 — The tutorial banner paints over modals, including the buttons it tells you to press

`drawTutorialBanner` runs last and unconditionally. Measured overlap at 1280×800: **460×118 px
with the rack panel** and **460×118 px with the offers modal** — the banner's whole footprint.

At 800×600 the banner covers offer slot 0's demand line, pay line and both Accept/Decline
buttons, while the banner's own "Got it →" button sits on top of that card's button row — so a
click aimed at the hidden Accept advances the tutorial instead. This is the same shape of problem
as round 1's B1 (the banner making the shop door unreachable), one layer up.

**Fix:** skip the banner while a modal is open, or draw it beneath modals and above the world.

### U9 — Landscape phone (844×390): the banner renders off-canvas and the tutorial cannot be skipped

`getTutorialBannerRect` reserves the build panel's full column before placing itself:
`12 + 316 (7 buildables: 7 × 40 + 6 × 6) + 8 + 118 = 454 px` of vertical space in a 390 px canvas. The
result is `y = −64`: the banner's body is above the top edge, its **skip link (y = −56) is
unreachable**, and only the bottom strip with "Got it →" is visible, overlapping the HUD bar's
money/power readouts.

The build panel doesn't fit either — at 316 px tall it runs from y = 62 to y = 378 in a 390 px
viewport, covering the left third of the play area and starting immediately under the HUD bar.

**Fix:** clamp the banner rect into the viewport, and give the build panel a compact layout (two
columns, or icon-only) below a height threshold.

### U10 — Overheating and hardware failure are silent

`contractMissed` gets a red toast, and the resource near-limit warning gets an amber one. A
thermal trip (a whole rack dropping offline and dumping its work back to the tray) and a hardware
failure (a machine dying) produce **only a sound**. Measured at the tick a 6-machine rack tripped:
6 machines offline, 6 workloads returned to the tray, `toasts` empty; same for a forced failure
of three machines at once.

**Fix:** one `spawnToast` in `thermal.ts`'s trip branch and one in `wear.ts`'s failure branch,
matching the miss toast's wording ("Rack overheated — 6 servers offline").

### U11 — The top bar's last item still runs under the mute button

Round 1's B5 fix added a `rightLimit` budget to `drawTopBar`, but each section is gated on
`if (x < rightLimit)` — the item's **start**, not its end. An item that begins just left of the
limit still draws its full width past it.

Measured at 1440 px wide (`rightLimit` = 1440 − 6 − 34 − 10 = 1390): the `served N  peak N`
section starts inside the budget and then draws straight under the mute button — the icon covers
the "a" of "peak" in the captured bar, and the same overlap shows in a live 1440×900 mid-game
session (`served 13`). 1280 and 1920 happen to fall clear.

**Fix:** measure the section's text (and its inline bar) before drawing and skip it if
`x + width > rightLimit`, rather than testing `x` alone.

### U12 — Still no favicon (round 1's B7)

`index.html` declares no `<link rel="icon">`; `GET /favicon.ico` returns 404 on every load,
logged as a console error in every session captured here. One line.

---

## 3. Simulation corner cases

### U13 — Decommissioning a server orphans the workloads running on it (destructive)

`maintenance.ts`'s decommission branch destroys the machine entity without calling
`unplaceAllOn` — the call every other server-goes-away path (brownout, thermal trip, hardware
failure) makes.

Repro: one Web Hosting contract placed on server 3; decommission server 3 through the rack panel
(two real clicks, then the 2 s walk-and-work). Afterwards, over 16 s of observation:

```
{"id":46,"state":"placed","placedOn":3,"work":39.5,"dl":73.4}   ← server 3 no longer exists
{"id":46,"state":"placed","placedOn":3,"work":39.5,"dl":69.3}
{"id":46,"state":"placed","placedOn":3,"work":39.5,"dl":65.3}
{"id":46,"state":"placed","placedOn":3,"work":39.5,"dl":57.3}
```

`workRemainingSeconds` is frozen (nothing advances it: the `PlacedOn.serverId` lookup returns
`undefined`), the deadline keeps running, and the contract is invisible — not in the tray, so it
can't be re-dragged, and no chip is drawn because its server is gone. It ends in a full miss:
−8 reputation plus `penaltyOnMiss`. The jobs panel lists it as ACTIVE with a progress bar that
never moves.

**Fix:** `unplaceAllOn(world, job.machineId)` before `destroyEntity` in the decommission branch,
so the work lands back in the tray like every other path.

### U14 — A fully loaded rack oscillates trip → recover → trip forever

Setup (stress preset, so other racks are also running): one rack given 6 Blade Chassis, each
with a workload placed on it so all six draw full power. The "workloads placed" column below is
facility-wide, so the drop from 10 to 4 is exactly this rack's six. Heat is
6 × 1.4 = **8.4 kW**; with only `BASELINE_COOLING_KW` (0.6) the target temperature is
`20 + 8.4×6 − 0.6×6 = 66.8 °C`, just above `TRIP_C` (65). There is no stable operating point, so
the rack cycles:

| t    | temp | tripped | machines online | workloads placed         |
| ---- | ---- | ------- | --------------- | ------------------------ |
| 6 s  | 54.5 | no      | 6/6             | 10                       |
| 11 s | 63.3 | no      | 6/6             | 10                       |
| 16 s | 43.4 | **yes** | 0/6             | 4 (6 dumped to the tray) |
| 21 s | 58.1 | no      | 6/6             | 10 (auto-restored)       |
| 29 s | 47.2 | **yes** | 0/6             | 4                        |
| 41 s | 63.0 | **yes** | 0/6             | 4                        |

...continuing for as long as it was watched. Round 1's F4 auto-restore is what closes the loop:
the work goes straight back onto the machines that just overheated. Each cycle burns deadline —
three contracts missed in one such run (−$160 and −24 reputation) — and, per U10, the player is
told nothing.

**Fix:** this is a tuning question as much as a bug. Options: make the trip sticky for a few
seconds (a real trip should cost more than 5 s), shed only _part_ of the rack instead of all of
it, refuse auto-restore onto a rack that tripped within the last N seconds, or drop
`HEAT_TO_DEGREES` so a full rack sits inside the throttle band rather than above the trip line.

### U15 — "+5kW Cooling" from the shop does not cool anything

There are two unrelated quantities both called cooling: `CoolingCapacity` (a facility-wide
brownout budget, what the shop upgrade and the HUD's `❄ COOLING x / y kW` readout refer to) and
what `thermal.ts` actually integrates (`BASELINE_COOLING_KW` + CRAC units in range). Nothing
connects them.

Measured — one rack, 4 Blade Chassis each running work (5.6 kW heat), settled:

| step                                           | rack temp   | throttle | facility cooling |
| ---------------------------------------------- | ----------- | -------- | ---------------- |
| settled                                        | 50.0 °C     | 0.75     | 13.7 / 40 kW     |
| after buying 6 × "+5kW Cooling" ($2,100)       | **50.0 °C** | **0.75** | 13.7 / 70 kW     |
| after placing one CRAC ($450) next to the rack | **38.0 °C** | **1.00** | 13.7 / 70 kW     |

So the player watching a rack badge read `🌡 THROTTLED` — losing 25 % of that rack's income —
sees a HUD that says cooling is at 34 % of capacity, and the shop's only cooling-labelled upgrade
does nothing for it. $2,100 of "cooling" bought no cooling.

**Fix:** rename one of the two (the facility budget is really a _cooling plant_ / heat-rejection
capacity), and/or let purchased capacity feed `BASELINE_COOLING_KW` so the intuitive reading is
also the true one. Separately, the rack panel should show the rack's temperature and delivered
cooling, not just a badge.

### U16 — Hardware failure is effectively unreachable in a real session

`BASE_FAILURE_RATE` is 0.0004/s at wear 1.0, so a machine at **full** wear has a mean time to
failure of ~2,500 s (~42 minutes) of online runtime; over a 20-minute stretch at full wear
P(failure) ≈ 38 %. Wear itself reaches 1.0 after ~20 minutes online (`WEAR_PER_SECOND` 0.0008).
Across ~25 minutes of live play here, no machine failed on its own; a machine pinned at wear 1.0
for two minutes never failed.

The mechanic itself works when it does fire (forced roll: machine marked `Failed`, taken offline,
its workloads unplaced to the tray, Repair button appears, repair walks-and-fixes, wear
0.901 → 0.553, `Failed` cleared, machine back online; repair cost charged up front and correctly
refunded when the task is cancelled). It is just tuned far below the point where a player meets
it — which also means the repair economy (`REPAIR_COST_FRACTION`, the replace-vs-repair decision
D6 exists to create) never comes up.

**Fix:** raise `BASE_FAILURE_RATE` by roughly an order of magnitude, or make the roll a function
of time-above-wear-threshold rather than a flat per-second chance, and re-measure against a
20-minute session.

### U17 — No fail state, and no signal when the money runs out

`clampReputation` bounds reputation to [0, 100]. At 0 nothing happens except that the archetype
ladder narrows to Web Hosting — the game continues indefinitely. Measured in the fresh-save
session where dispatch kept failing (see U3): reputation fell 10 → 0 over 4 minutes of accepted-
but-undispatched contracts, and the session simply carried on.

Money is unbounded below: power keeps billing (0.025 $/s with a single idle Budget Box, more with
anything real installed), so a player who over-builds drifts negative forever. `buy()` correctly
refuses purchases (`Math.floor(money) >= cost`), but nothing tells the player they are insolvent,
and the only way back is decommissioning hardware — which, per U13, will eat any contracts still
placed on it.

**Fix:** out of scope for a bug list, but worth a decision: either a real fail/recovery state
(loan, forced sale, game over) or an explicit "you can't afford anything" signal.

---

## 4. What held up

Verified working, worth keeping in the regression set:

- **Brownout.** 24 servers saturated at 20.4 kW; capacity cut to 3 kW → warning toast fired,
  21 machines offline, 22 workloads returned to the tray, no crash. Capacity restored to 40 kW →
  everything back online and all 22 workloads auto-re-placed within a tick. Parked exactly at
  capacity (20.4 / 20.4 kW) for 14 s: **zero** online/offline flips, no thrash.
- **Over-cooling floor.** Seven CRACs around one rack settled it at 18.2 °C and falling toward
  `SUPPLY_AIR_C` (14) — no negative temperatures.
- **Save/load.** F5 → toast + 1,657 bytes in localStorage; reload + Continue restored money,
  reputation, inventory, rack/machine layout, wear (0.501), a placed workload's remaining work
  and deadline, the tray card, the demand clock and tutorial state; the loaded game kept earning
  (0.765 $/s).
- **Zoom.** Clicking a rack resolves to the right grid cell at camera scale 2.0 and 0.6.
- **Viewing-mode panels** correctly refuse drags (no `DragState`, nothing placed, no
  `PendingDrop`).
- **Escape mid-drag** closes the panel, clears the drag, and the release does not walk the player.
- **Camera recenter** button appears when detached and re-attaches on click.
- **Top bar degradation** (round 1's B5 fix) mostly holds: at 1280 px the readouts stop cleanly
  before the mute button and at 390 px everything after power is dropped rather than overlapped
  — see U11 for the width where it still overruns.
- **Rejected drops** flash and leave the workload at its origin.
- **Tutorial**, played start to finish with real clicks on a fresh save, completes every step
  (welcome → move → rack → machine → panel → shop → offer → dispatch).

## 5. Repo health

### U18 — Two unit tests are red on this branch, both stale against the idle-power change

`npm test` on `claude/dazzling-wright-keb9xs` (clean tree): **2 failed | 129 passed**.

| test                                                                                                                  | failure                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `capacity.test.ts` → "rolls up rack power/heat/server-count from its online installed machines"                       | expects `MACHINE_TIERS.basic.powerKw + MACHINE_TIERS.dense.powerKw` (2.0), gets 0.7 |
| `resource.test.ts` → "takes the newest online machine offline when draw exceeds capacity, and unplaces its workloads" | expects the newest machine offline, it stays online                                 |

Both are the same root cause, and neither is a product bug: round 1's F5 fix made an online
machine with nothing placed on it draw `IDLE_POWER_FRACTION` (0.35) of its rated power, and these
two tests still assert the pre-F5 full draw — 2.0 × 0.35 = 0.7 in the first, and in the second the
reduced idle draw no longer exceeds the test's capacity so no brownout fires.

**Fix:** update both tests to the idle/active split (place a workload on each machine, or assert
against `IDLE_POWER_FRACTION`). Left red, they hide real regressions in exactly the two systems
U14/U15 are about.

---

## 6. Pacing data

| session                             | length  | result                                                                           |
| ----------------------------------- | ------- | -------------------------------------------------------------------------------- |
| fresh save, 1 rack / 2 Budget Boxes | 4.4 min | $630 → $938, rep 10 → 23, 3 contracts served                                     |
| fresh save, dispatch failing (U3)   | 4.4 min | $630 → $418, rep 10 → **0**, 0 served                                            |
| stress preset, 8 racks / 24 servers | 5 min   | $12.0k → $20.9k, rep 10 → **100 (capped)**, 25 contracts served, peak compute 16 |

Neither session logged an invariant violation (no orphaned placements, no past-deadline
survivors, no negative balance) or a console error beyond the favicon 404.

Two pacing notes:

- **The early-game cliff moved, it didn't go away.** Once reputation passes 20, Batch Job (8 CPU)
  enters the offer pool and a Budget Box has 4 CPU — so a player on starting hardware spends the
  second half of the early game declining most offers at −1 reputation each (measured: 9 of the
  fresh-save session's offers needed the unservable-accept confirm and were declined instead).
  Round 1's F2 fix moved the opening minute onto servable ground; the same cliff now sits at the
  rep-20 unlock.
- **Reputation is a four-minute stat in the mid game.** From the stress preset it went 10 → 31
  → 73 → 100 in 222 s and then sat at the cap for the rest of the session, with every archetype
  unlocked and `getArrivalInterval`'s reputation term bottomed out. Round 1's closing note about
  money needing a sink applies here too: revenue reached 86.5 $/s against 6.9 $/s of power cost,
  against a catalog that tops out at $4,500.

---

## 7. Proposals, sized

| #   | Change                                                                              | Fixes   | Cost    |
| --- | ----------------------------------------------------------------------------------- | ------- | ------- |
| Q1  | Route the rack panel's button hit-tests through `toContentSpace`                    | U1      | trivial |
| Q2  | Drop the stray 16 px from `getRackPanelContentHeight`                               | U2      | trivial |
| Q3  | `unplaceAllOn` before destroying a decommissioned machine                           | U13     | trivial |
| Q4  | Ignore non-primary buttons in the pointer handlers                                  | U4      | trivial |
| Q5  | Clamp modal tops below the HUD bar                                                  | U7      | trivial |
| Q6  | Favicon                                                                             | U12     | trivial |
| Q6b | Measure each top-bar section before drawing it                                      | U11     | trivial |
| Q7  | Latch press/release positions in `input/index.ts`, resolve gestures against them    | U3      | small   |
| Q8  | Toasts for thermal trip, machine failure, and the silent no-ops                     | U5, U10 | small   |
| Q9  | Hide the tutorial banner while a modal is open; clamp it into the viewport          | U8, U9  | small   |
| Q10 | Shop: floor click dismisses and walks; widen `SHOP_REACH_PX`                        | U6      | small   |
| Q11 | Re-tune thermal so a full rack has a stable operating point; make trips sticky      | U14     | medium  |
| Q12 | Reconcile the two meanings of "cooling"; surface per-rack temp/cooling in the panel | U15     | medium  |
| Q13 | Re-tune failure rates so hardware failure is met in a normal session                | U16     | medium  |
| Q14 | Compact build panel for short viewports                                             | U9      | medium  |

### The two that matter most

**Q1 + Q7 are the whole feel of the game.** Between them, a player who scrolls a rack panel can
destroy the wrong $500 machine, and a player who moves the mouse at normal speed cannot reliably
dispatch a contract or click a rack at all. Both are contained fixes in code that already has the
right primitives (`toContentSpace`, `pressOrigin`) — they are wiring, not design.

**Q3 is a five-word fix for a silent contract loss**, and it is the only bug here that destroys
player state with no path back.
