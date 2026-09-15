# Ideas backlog: small additions, sized and sequenced

> **Not a plan — a holding file.** Each entry is an idea with enough detail to judge cost and
> value, and a note on what it depends on. Promote one to its own `.plans/<name>.md` when it
> is next up. Entries here are deliberately under-specified; do not implement directly from
> this file without writing the plan first.
>
> Ordered roughly by value-per-unit-of-work within each section.

---

## Ready to build (no dependencies)

### Milestones and objectives

**Why:** the first five minutes are the weakest part of the experience. A new player is
dropped on a floor with money and no stated goal. A short objective list ("place your first
rack", "serve 5 contracts", "reach 10kW capacity") teaches the loop by directing it, and each
completion is a small reward.

**Shape:** `Objectives { completed: Set<string>; active: string[] }` on the facility; a
`MilestoneDef` table with a predicate evaluated per tick; a HUD corner list. Cash rewards on
completion double as an early-game cushion.

**Cost:** small. One component, one system, one HUD region. The only care needed is that
predicates stay cheap — evaluate on a timer (once a second), not every tick.

**Note:** this is probably the highest value-per-hour item in the whole backlog, and it is
independent of everything else. Consider it before any of the big mechanical plans.

### Sound and juice

**Why:** the game is silent and every state change is instant. Fan hum that rises with power
draw, a chime on contract completion, a thunk on rack placement, a klaxon on brownout, and a
brief screen shake on failure would do more for how the game *feels* than most mechanics.

**Shape:** a small `src/audio/index.ts` module — load, play, set gain — kept behind an
interface so systems emit named events rather than touching an audio context. Use WebAudio
oscillators for simple tones to avoid asset management entirely at first.

**Cost:** small-to-medium. The module is easy; sourcing or synthesizing sounds that are not
irritating on the hundredth repeat is the real work. Keep everything short and quiet, and put
a mute toggle in the HUD from the first commit.

**Watch:** browsers block audio before a user gesture. The landing screen in
[main.ts](src/main.ts) is a natural place to initialize the audio context, since it already
gates entry on a click.

### Statistics view

**Why:** `DemandClock` already tracks `elapsedSeconds`, `contractsServed`, and
`peakComputeServed`, and none of it is shown beyond the HUD. A history graph (income, power
draw, temperature after thermal ships) makes the player's decisions legible over time and is
the natural place for a "how am I doing" answer.

**Shape:** a ring buffer of samples (one per simulated second, a few hundred entries) on the
facility, plus a canvas-drawn line graph in a panel toggled by a key. All drawing goes through
the existing renderer — no DOM charts, per CLAUDE.md.

**Cost:** medium, mostly in the drawing. The sampling is trivial.

**Depends on:** more valuable after `.plans/power-billing.md`, when there is a net-income curve
worth plotting.

---

## Needs a dependency first

### Hired staff (technicians)

**Why:** the classic tycoon transition from *doing* to *managing*. It is also the correct
answer if `.plans/hardware-failure.md` proves too demanding of player attention — better than
a repair queue, because hiring is a decision with a cost.

**Shape:** an NPC entity with `Position`, `Speed`, `PathFollow`, and a `Technician` component
holding a current assignment. A system finds the nearest unclaimed maintenance job and walks
the technician to it, reusing the entire `MaintenanceTask` flow. **Almost all the machinery
already exists** — pathfinding, arrival detection, timed work.

**Cost:** medium. The hard part is not movement, it is job assignment: avoiding two
technicians claiming one job, and handling a job that disappears mid-walk (the machine was
decommissioned). Model assignment as a claim on the task, cleared if the task vanishes.

**Depends on:** `.plans/hardware-failure.md` — without repairs there is nothing to hire for.

**Balance:** a per-second wage, so staff are a fixed cost against variable income — the same
shape as power billing, and a genuine "do I need another one yet" decision.

### Network as a fourth trait

**Why:** listed as first-feature #5 in CLAUDE.md and still unbuilt. `traits.ts` was
deliberately written so a fourth trait is a one-line addition — the comments in
[traits.ts](src/ecs/traits.ts) and `.plans/workload-dispatch.md:124` both say so explicitly.

**Shape:** add `bandwidthMbps` to `Traits`, `TRAIT_KEYS`, `TRAIT_LABELS`, `TRAIT_UNITS`, every
`MACHINE_TIERS` entry, and every archetype's `demands`. Then a `Switch` buildable providing
bandwidth to racks within range — structurally the same as a CRAC unit.

**Cost:** the trait itself is genuinely one line plus data. The *switch placement* half is a
second spatial system.

**Depends on:** worth doing **after** `.plans/thermal-and-cooling.md`, because the radius/
coverage pattern will already exist and can be shared rather than invented twice. Building
network placement first means building that pattern twice.

**Honest assessment:** a fourth trait adds arithmetic but not a new *kind* of decision — it is
one more number in the same fit-check. The switch placement is where the interest is. If you
only want one, build the switch.

### Save and load

**Why:** sessions currently end when the tab closes. Once a facility takes 20+ minutes to
build, losing it is a real cost.

**Shape:** serialize every component store to JSON; restore by repopulating the stores and
re-deriving caches. The derived-cache discipline helps enormously here — `RackLoad`,
`ServerCapacity`, and `Utilization` need not be saved at all, since they are recomputed the
next tick.

**Cost:** medium, and it grows with every plan built. `world.ts` would need an
entity-id-preserving restore, since components reference ids (`InstalledIn.rackId`,
`PlacedOn.serverId`).

**Depends on:** nothing technically, but **do it after the mechanical plans land**, not before
— every new component is another field to serialize, and a save format written now will be
rewritten three times.

**Watch:** `Temperature` and `Condition` are integrated state (not caches) and **must** be
saved. They are the exceptions to "derived caches need not be persisted", and the reason each
carries a loud comment.

---

## Considered and deliberately not planned

### Multi-server workloads

Splitting one workload across several servers. **Deferred with reasoning in
`.plans/contract-variety.md` D5** — it breaks the one-workload-one-server invariant that
`dispatch.ts`, `capacity.ts`, and the entire drag interaction are built on. It is a data-model
migration comparable in size to `workload-dispatch.md` itself, and recurrence delivers most of
the same "committed capacity" feeling for far less.

### Rack-to-rack heat conduction

**Rejected in `.plans/thermal-and-cooling.md` D3.** It doubles the model's complexity, couples
the whole floor into one system that is hard to debug, and adds no player decision that
cooling-radius placement does not already create.

### Continuous speed slider

**Rejected in `.plans/time-controls.md` D7.** A fixed ladder of `[0, 1, 2, 4]` is testable and
self-explanatory; 3.7x is neither.

### A general modal stack

The rack panel and shop panel are two explicit ordered branches in the click chain.
`.plans/facility-shop-inventory.md` already flags this: with two it is clearer than an
abstraction; a **third** full-screen modal is the trigger to reconsider. The research tab
(plan 12) deliberately reuses the shop panel rather than adding a third.

### Incidents and outages as a separate layer

CLAUDE.md describes incident handling as "an intentional later layer, added once this core
loop exists". Note that `.plans/thermal-and-cooling.md` and `.plans/hardware-failure.md`
together deliver most of what an incident layer would — overheating events and hardware
failure are exactly the listed examples. Re-read that section after both ship; there may be
little left worth building separately.
