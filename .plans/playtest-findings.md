# Playtest findings: bugs, friction, and what to do about them

> **Not a feature plan — a findings report with proposed fixes.** Written from an actual
> played session (dev server + scripted browser input, driving the real game through the real
> click chain), not from reading the code. Every claim below has a reproduction.
>
> Entries are grouped by kind and ordered by severity within each group. Section 3's proposals
> are sized but deliberately under-specified — promote one to its own `.plans/<name>.md`
> before implementing, per `ideas-backlog.md`'s convention.
>
> **Status:** B1, B2, B3, B4, B5, F6, and F9 are fixed (see each entry). Re-verified against the
> real click chain (or, for B3, the scaling math directly) the same way each was originally
> found — not just read back. Everything else in this report is still open.

## How this was measured

A 1280×800 browser at DPR 1 (so `canvas.width` == CSS pixels, matching what `input.ts` reads),
driving real `mousedown`/`mouseup`/`keydown` through the canvas. Sessions run: full guided
tutorial start-to-finish; ~3 minutes of steady-state play with four servers across two racks;
a forced late-game state (Large Room, 54 racks, 162 servers); and targeted probes for the
deadline-miss and brownout paths.

---

## 1. Bugs

### B1 — The tutorial banner makes the shop unreachable (blocker)

**The tutorial's `visit-shop` step asks the player to do something the tutorial itself
prevents.**

The shop door is at grid `(29, 0)` → world `(1180, 20)`. The camera clamps at the world's top
edge (`camY` bottoms out at `-viewport.y` = `-36`), so the door is **always** drawn at screen
`y = 56`. The tutorial banner occupies `y = 44..162`, centred horizontally — and as the player
walks toward the door, the camera centres the door under the banner at `x ≈ 630`.

`input.ts` checks `pointerInHud(...)` and returns early, so every click in that region is
swallowed. `SHOP_REACH_PX` is 80, and the entire 80px reach radius around the door maps to
screen space covered by the HUD bar (`y < 36`) plus the banner (`y ≥ 44`).

What survives is an **8-pixel-tall sliver at `y ∈ [36, 43]`**. Measured, clicking at `x=632`:

| screen y | 38 | 40 | 42 | 44 | 46 | 50 | 56 (the door itself) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shop opens | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

Same click with `progress.skipped = true` walks the player straight there and opens the shop.
So the only reliable way to finish the tutorial's shop step is to **skip the tutorial**.

**Fix:** the banner should not be part of `pointerInHud`'s blocking region — it is an overlay,
not an interactive panel. Its two real hit targets (action button, skip link) are already
checked ahead of everything else in the click chain, so removing the banner rect from
`pointerInHud` costs nothing and unblocks the floor beneath it. Additionally, move the banner
to the **bottom** of the viewport during the tutorial: the top strip is where the corridor and
shop live, and the build panel already owns the bottom-left.

**Fixed.** `pointerInHud` no longer blocks on the banner at all, and `getTutorialBannerRect`
now anchors to the bottom of the canvas, above the build panel (reserving its full column, not
just its current width, so they can never overlap). Re-ran the exact repro above: clicking the
door at screen `(632, 56)` now opens the shop with the banner up, identically to with it
skipped.

### B2 — "no server fits this" is drawn underneath the Accept button

`drawOfferCard` lays text out at `card.y + 14`, `+28`, `+42`, then the warning at `+54`. The
Accept/Decline buttons are at `card.y + card.height - 22 - 6` = `card.y + 48`, height 22 —
spanning `48..70`. The warning at `54` (with `textBaseline = 'middle'`) lands squarely inside
them and is painted first, so the buttons cover it.

The whole card is also drawn at `globalAlpha = 0.55` when unservable, which dims the warning
further. Net effect: **the one signal that stops a player accepting an impossible contract is
invisible.** Only a red sliver peeks above the button.

**Fix:** grow `OFFER_CARD_HEIGHT` for the unservable case (or move the warning to the
right of the title, where there is free space), and exempt the warning text from the dimming.

**Fixed.** `OFFER_CARD_HEIGHT` went from 76 to 96 (uniformly, not just for unservable cards —
avoids variable-height stacking), giving the warning its own line clear of the buttons, and it
now draws at `globalAlpha = 1` regardless of the card's own dimming. Re-screenshotted three
unservable offers: the "⚠ no server fits this" line is fully legible above both buttons on
every card.

### B3 — Demand scaling is mathematically dead; the game has no progression

`getComputeScale` returns `Math.min(timeScale, capacityScale)` where
`capacityScale = Math.max(1, peakComputeServed / 30)`.

`peakComputeServed` is set from `workload.demands.cpu` of **completed** workloads. With
`scale = 1`, the largest CPU demand in the catalog is ML Training's **12**. So `peak` can
never exceed 12, so `capacityScale` is `max(1, 0.4)` = **1**, so `scale = min(timeScale, 1)`
= **1**, forever. Raising `peak` requires an already-scaled contract, which requires a raised
`peak`. It is a closed loop that never opens.

Measured over a simulated 22 minutes:

| minute | 0 | 4 | 8 | 12 | 16 | 20 |
| --- | --- | --- | --- | --- | --- | --- |
| `timeScale` | 1.00 | 1.80 | 2.60 | 3.00 | 3.00 | 3.00 |
| **actual `scale`** | **1.000** | **1.000** | **1.000** | **1.000** | **1.000** | **1.000** |
| max CPU offered | 12 | 12 | 12 | 12 | 12 | 12 |

Live confirmation: after 175 s of real play and 5 contracts served, `peakComputeServed` was
**6**. The `scales: true` flag on batch/render/training is inert, the 10-minute `timeScale`
ramp is unreachable, and the HUD's `peak` counter can never exceed 12.

The consequence is the biggest structural problem in the game: **contracts never get bigger.**
The only thing that changes over a session is arrival cadence (~16.8 s → ~7.2 s at rep 50).
A fully built-out facility measured **CPU 0/1200, RAM 0/4800, SSD 0/150000** against a largest
possible contract of 12 CPU / 96 GB / 400 GB — roughly **100× more capacity than the demand
system can ever consume.**

**Fix:** decouple the two terms. `capacityScale` should track installed/served *facility*
capacity (e.g. `utilization.traitsTotal.cpu / 30`), not the single largest completed workload.
That makes the "behind an active player, ahead of a passive one" intent actually hold.

**Fixed** — see `.plans/compute-scale-fix.md` for the full design writeup. `capacityScale` now
keys off `Utilization.traitsTotal.cpu` (installed, online facility CPU) instead of
`peakComputeServed`. Doing that naively surfaced a second bug the deadlock had been hiding:
letting the achieved scale climb toward `timeScale`'s existing 3x ceiling breaks catalog fit —
`training`'s demands stop fitting any server tier past ~1.33x, `render` past ~2.5x. Fixed by
splitting the one `scale` into a VALUE scale (drives `payPerSecond`/`penaltyOnMiss`, uncapped by
fit, reaches the intended 3x) and a DEMAND scale (drives `demands`, clamped to
`MAX_DEMAND_SCALE[archetypeId]` — computed from the catalog itself, not hand-typed). Once an
archetype's demand hits its fit ceiling, its size stops growing but its pay keeps climbing —
late game becomes "the same job pays more," not "an unfittable job."

### B4 — A running workload's deadline is invisible

In `drawWorkloadPanel`, an **active** row shows `Math.ceil(workload.workRemainingSeconds)` and
a work-progress bar. It never shows `deadlineRemainingSeconds`. A **pending** row shows the
opposite — deadline only.

So the moment you dispatch a workload, the clock that can actually kill it disappears from the
UI. Observed in a real session:

```
{"type":"render","state":"running","work":21.4,"dl":15.1,"on":9}
```

21.4 s of work left, 15.1 s of deadline left. **This contract is already lost** — it will
occupy a server for 15 more seconds, pay out, then miss and cost 8 reputation. The HUD
displayed "21s" and a healthy green progress bar the whole time.

**Fix:** show both on the active row, and colour the row red once
`workRemainingSeconds > deadlineRemainingSeconds` (provably doomed).

**Fixed.** The active row now shows `⏱ Ns` (deadline remaining) right-aligned on the stats
line, amber normally, and the whole row (label, bar, both countdowns) turns red once
`workRemainingSeconds > deadlineRemainingSeconds`. Verified in a live autoplay session's
screenshot: a healthy job shows "16s" work / "49s ⏱" in amber, not the misleadingly-plain
green-everything display from before.

### B5 — HUD top bar overflows and collides below ~1100px wide

`drawTopBar` lays items out left-to-right with no width budget. At 820×600 the mute button is
drawn on top of the `SSD 0/0` readout, and the inventory (`📦 n in stock`) and `served / peak`
counters run off the canvas entirely. The tutorial banner (fixed 460px, centred) also overlaps
the offers column (fixed 220px at `x = 12`), clipping the Decline button's label.

**Fix:** either drop low-priority top-bar items below a width threshold, or reserve the mute
button's width and clip. The banner should clamp its width against the offers column, not just
against `canvasWidth`.

**Fixed.** `drawTopBar` now tracks a `rightLimit` (the mute button's left edge, minus a margin)
and skips each remaining section — power, cooling, reputation, the per-trait bars, inventory,
served/peak, in that priority order — once `x` would cross it; skipping leaves `x` unmoved, so
one skip cascades to every lower-priority item after it rather than leaving a gap. Separately,
`getTutorialBannerRect` (touched by the B1 fix above) now centers within the actual game
viewport gap between the offers and workload columns instead of the raw canvas, which also
closes the offers-column overlap: re-tested the worst case (3 stacked offer cards, 820×600) and
the banner no longer reaches the offers column at all. Re-screenshotted both.

### B6 — Install abort refunds cash for an item taken from inventory

`install-progress.ts` refunds `MACHINE_TIERS[task.tierId].cost` to `wallet.money` on two abort
paths (rack gone; every slot taken). But `tryInstallIntoRack` took the machine from
**inventory** via `takeFromInventory`, and `cancelInstallTask` correctly refunds to inventory
per D7. Two of three abort paths convert an owned item into cash.

Currently unreachable — racks can't be demolished and only one install runs at a time, so
neither condition can fire — but it is a latent item-to-money duplication if either
assumption changes. **Fix:** `addToInventory`, matching `cancelInstallTask`.

### B7 — No favicon

`index.html` declares no `<link rel="icon">`, so every load logs a 404 for `/favicon.ico`.
Cosmetic, one line.

---

## 2. Friction — the parts that don't feel good to play

### F1 — The shop round trip is pure tax

The shop door is ~1360px of pathing from the closet spawn at 200 px/s: **~7 s each way, ~14 s
round trip, and the panel closes the moment you walk out of an 80px radius.** So buying one
rack and one machine costs the same 14 s as buying ten. Measured walk in a real session: 25 s
of wall clock including re-clicks.

Nothing happens during that walk. There is no decision, no risk, no scenery — the corridor is
a flat grey strip. It is the single most repeated action in the game and it is dead time.

Worse, it competes directly with the contract clock: offers expire in 15–20 s and deadlines
run 60–85 s, so a shop trip can *cause* a missed contract.

**Options, cheapest first:** (a) let the shop panel stay open once opened until explicitly
closed; (b) a "delivery" mode — buy from anywhere, stock arrives at the door after a delay;
(c) put a terminal/kiosk in the server room; (d) keep the walk but make the shop sell in bulk
so the trip amortises.

### F2 — Half of all early offers are impossible to serve

`STARTING_REPUTATION` is 50. `pickArchetype` filters by `minReputation ≤ 50`, giving
`[web(0), batch(20), render(40)]`, then weights them `1 : 2 : 3` — deliberately "toward the
larger unlocked archetypes". So at a fresh start:

| archetype | weight | probability | fits starting hardware (2× Budget Box: 4 CPU / 8 GB / 250 GB)? |
| --- | --- | --- | --- |
| Web Hosting | 1 | 17% | ✅ |
| Batch Job | 2 | 33% | ❌ (needs 8 CPU, 16 GB) |
| Render Farm | 3 | **50%** | ❌ (needs 6 CPU, 20 GB, **800 GB**) |

**83% of opening offers cannot run on the hardware the game hands you.** In a recorded
first-minute session, every offer that arrived was a Render Farm; the tray filled with four
un-runnable contracts while money ticked *down* from power costs and the player could do
nothing but watch. That is the first minute of the game.

**Fix:** lower `STARTING_REPUTATION` to ~10 so the ladder starts at web/batch, or gate
`minReputation` on demonstrated capacity rather than reputation, or both.

### F3 — Accepting a contract you can't serve is a silent trap

Declining is free (`REPUTATION_ON_DECLINE = 0`) and missing costs **−8**, against **+3** for a
completion. So one miss erases nearly three successes. Yet the Accept button is fully enabled
for a contract with no server that fits, and (per B2) the warning is invisible. There is also
**no way to abandon** an accepted contract once it is doomed — it just sits in the tray
draining toward −8.

Measured: rep 50 → 42 on a single miss. In a 3-minute session, 5 completions and 2 misses
netted **−1 reputation**.

**Fix:** make unservable Accept require a confirm (or disable it), and add a "drop contract"
affordance that costs less than a miss.

### F4 — Brownouts dump work back to the tray with the deadline still running

When capacity is exceeded, `unplaceAllOn` returns every workload on the browned-out server to
the tray, deadline **still ticking**. Measured: dropping capacity 3.0 → 1.0 kW took 4 of 6
servers offline and returned 2 running workloads to the tray instantly.

The intent (a "visible, recoverable setback") is right, but the recovery loop is: notice it,
walk to the rack, open the panel, re-drag each workload. With `BROWNOUT_COOLDOWN_SECONDS = 1.0`
and newest-first selection, a marginal power budget can thrash — repeatedly unplacing work the
player then has to hand-replace, while deadlines burn.

**Fix:** keep the unplacement, but re-place automatically when the same server comes back
online within a grace window; and warn *before* the brownout (the HUD already has the numbers).

### F5 — Idle hardware bleeds money, which punishes building ahead

Power is billed on draw whether or not a machine is doing anything. A Blade Chassis idles at
3.0 kW = **$0.60/s = $36/min**, more than a Web Hosting contract pays in total ($40.50 for 45 s
of work). The built-out facility measured **−$21.00/s with zero contracts running**.

In a tycoon game, buying capacity ahead of demand is the fun part; here it is strictly
punished, and the demand system (B3) will never grow into that capacity anyway.

**Fix:** bill idle machines at a reduced rate (an idle/active power split is realistic *and*
better play), or let the player power down a rack.

### F6 — Offer cards reflow under the cursor

`drawOffersPanel` and `hitTestOfferButtons` both sort by entity id and index positionally. When
offer 0 expires, offers 1 and 2 shift up one slot — so a card you were about to Accept moves
under your cursor and you click a different contract. Offer windows are 15–20 s, so this fires
often.

**Fix:** keep a stable slot per offer for its lifetime, or animate/hold the gap briefly.

**Fixed.** `Offer` now carries its own `slot` (0..MAX_OFFERS-1), assigned once at spawn to the
lowest slot not currently held by a live offer, and both drawing and hit-testing key off
`offer.slot` instead of position in a freshly-sorted array. `getOffersPanelRect` (used by
`pointerInHud` to block clicks on the offers region) also switched from sizing to the live
offer count to always reserving the full `MAX_OFFERS`-slot column, since a lone survivor can
now sit in slot 2 with slots 0–1 empty. Verified: spawned three offers, forced slot 0 to expire,
confirmed the other two kept slots 1 and 2 rather than collapsing to 0 and 1.

### F7 — Success and failure have no visual feedback

`contractCompleted`, `contractMissed` and `brownout` play sounds, and nothing else happens. No
toast, no floating money, no flash. Muted (or on a laptop speaker), a missed contract and a −8
reputation hit are **completely silent** — the row simply vanishes from the panel. The only
visual feedback anywhere in the game is the rejected-drop trait-bar flash.

**Fix:** floating `+$N` on completion and a red banner on a miss are cheap and would carry a
lot of the game's feel.

### F8 — The playfield is mostly black void

The world is 2400×1600. The starting Server Closet is 6×5 cells — 240×200 px — inside a
772×764 viewport. At the opening frame the room occupies roughly **8% of the visible area**;
everything else is `#000`. The corridor is a flat grey band and the outdoors is not drawn at
all.

A built-out Large Room is the opposite problem: 54 identical racks in a uniform grid, each
repeating the same `⚡1.2kW / 🔥0.9kW` label — dense, noisy, and visually monotonous.

**Fix:** draw *something* outdoors (ground texture, parking, sky-side gradient); hide per-rack
draw labels unless the rack is hovered or the facility is small; vary rack appearance by the
tier installed in it.

### F9 — Jargon in the UI

The rack panel header reads `Rack — DISPATCHING`, an internal state-machine name. The player
was never taught the word. `Rack — placing work` (or just the rack's name) says the same thing.

**Fixed.** Header now reads `Rack — PLACING WORK` (and `VIEWING (walk there to place work)` for
the read-only mode), matching the wording the tutorial itself uses ("Dispatch it... drag the
workload... onto an online server").

---

## 3. Proposals, sized

Ordered by value per unit of work. Each needs its own plan file before implementation.

| # | Change | Fixes | Cost | Status |
| --- | --- | --- | --- | --- |
| P1 | Banner out of `pointerInHud`, move banner to bottom | B1 | trivial | **Done** |
| P2 | Offer-card layout: warning above buttons, undimmed | B2 | trivial | **Done** |
| P3 | Active row shows deadline; red when doomed | B4 | small | **Done** |
| P4 | `capacityScale` from facility capacity, not `peak` | B3 | small (grew to medium — see `.plans/compute-scale-fix.md`) | **Done** |
| P5 | `STARTING_REPUTATION` → 10; re-tune the unlock ladder | F2 | small | open |
| P6 | Confirm-on-unservable-accept + drop-contract button | F3 | small | open |
| P7 | Completion/miss visual feedback (float + banner) | F7 | small | open |
| P8 | Shop stays open until dismissed, or remote ordering | F1 | medium | open |
| P9 | Idle vs active power split; rack power switch | F5 | medium | open |
| P10 | Brownout auto-restore within a grace window + pre-warning | F4 | medium | open |
| P11 | Outdoor art pass; rack label decluttering; tier-varied racks | F8 | medium | open |
| — | Stable offer slots (see F6); rack panel label wording (see F9) | F6, F9 | trivial | **Done** |

### The one that mattered most

**P4 was the difference between a game and a demo, and it's now fixed** (see
`.plans/compute-scale-fix.md`). Everything else on this list was polish on a loop that had no
second act: the contracts a player saw in minute 20 were identical to minute 1, and a facility
could out-scale total demand by 100×. With the deadlock gone, the money, the room tiers, and the
machine catalog actually mean something across a session — worth a fresh playtest to confirm it
*feels* right now that it's mathematically possible, not just to re-check the numbers.

Two candidates worth a plan each, now that P4's landed:

- **Milestones/objectives** — already the top entry in `ideas-backlog.md`, and the playtest
  supports it: the opening minutes have no stated goal and (per F2) often no legal move.
- **A money sink with an upward ramp.** Room tiers cap at $4500 and the catalog tops out at
  $900. A competent player passes both within ~3 minutes of steady play (measured: $750 →
  $1877 in 175 s on four servers). Without something to buy, money stops being a score.

---

## Verification notes

Every bug above reproduces from a fresh `npm run dev` at 1280×800 except B5 (needs ≤ ~1100px
wide) and B6 (unreachable at present — read the code path). B1's sliver test needs exact
pixel coordinates; the reproduction is clicking screen `(632, 56)` versus `(632, 40)` with the
player standing in the corridor below the shop.
