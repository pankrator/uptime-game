# Sound and juice: synthesized SFX for key state changes

## Context

The game is currently silent — every state change (rack placed, machine installed, contract
completed or missed, brownout) is instant and mute. Per `.plans/ideas-backlog.md`, a handful
of short, synthesized sounds would do more for how the game *feels* than most mechanics, at
low cost. This plan is scoped to sound only — no screen shake or other visual juice (that's a
separate, later backlog item if wanted).

Per the backlog's own guidance: use WebAudio oscillators for simple tones, not sourced/loaded
assets, to avoid asset management. Keep a mute toggle in the HUD from the first commit, and
initialize the audio context on the landing screen's start button, which already gates entry
on a user gesture (browsers block audio before one).

## Approach

1. **New module: `src/audio/index.ts`.** A single factory, `createAudio()`, returning a small
   interface so every system that wants a sound calls a *named event*, never touches
   `AudioContext` directly:

   ```ts
   export type SoundName =
     | 'rackPlaced'
     | 'machineInstalled'
     | 'contractCompleted'
     | 'contractMissed'
     | 'brownout'
     | 'uiClick';

   export interface Audio {
     play(name: SoundName): void;
     setMuted(muted: boolean): void;
     isMuted(): boolean;
   }

   export function createAudio(): Audio { ... }
   ```

   - Lazily creates one `AudioContext` on first `play()`/`setMuted()` call (not at module load
     — constructing one before a user gesture just throws/warns in most browsers, and
     `createAudio()` itself is called before the gesture in `main.ts`'s module-level setup).
   - Each `SoundName` maps to a tiny internal synth function (oscillator type, frequency
     envelope, gain envelope, duration — all under ~300ms). No asset loading, no `<audio>`
     tags, no network requests.
   - `play()` is a no-op when muted or when `AudioContext` is unavailable/suspended — never
     throws, so callers never need a try/catch.
   - Mute state persisted to `localStorage` (small, per-player convenience, not game state) so
     it survives a reload.
   - This module has no dependency on `World`/ECS — it's a leaf module, matching the "audio
     module kept behind an interface, systems emit named events" framing in the backlog.

2. **Sound design (all short, quiet, non-irritating on repeat — the actual hard part per the
   backlog's own cost note):**
   - `rackPlaced` — a short low "thunk": square/triangle oscillator, quick pitch drop, ~80ms.
   - `machineInstalled` — a soft two-note chime, ~150ms, mid-range sine.
   - `contractCompleted` — a brighter ascending two-note chime, ~200ms.
   - `contractMissed` — a short descending minor interval, quiet, ~200ms — a "miss" cue, not
     alarming (deadline misses are already frequent/expected, not a rare failure state).
   - `brownout` — a brief low buzz (sawtooth, short), distinct from `contractMissed` — it's a
     facility-level event, not a per-workload one.
   - `uiClick` — a very short, quiet tick for offer accept/decline and other button presses.
   All gains kept low (e.g. peak ~0.15) and each envelope explicitly ramped to 0 at the end —
   no clicks/pops from an abrupt stop.

3. **Wire-up at hook points** — each is a single `audio.play(...)` call added to an existing
   system, not new systems:
   - `src/ecs/systems/input.ts` — after a successful `spawnRack(...)` (empty-cell placement,
     around line 373): `rackPlaced`. Also `uiClick` on shop buy-button and offer
     accept/decline hits (input.ts already resolves those clicks; shop.ts's `buy()` return
     value / the accept/decline branches near `hitTestPanel`/`getOfferButtonRect` handling are
     the other click sites — check both `input.ts` and `shop.ts` for where accept/decline are
     actually resolved before adding calls).
   - `src/ecs/systems/install-progress.ts` — after `spawnMachine(...)` succeeds (end of
     `update`, once the machine is actually spawned, not on the earlier "no free slot" refund
     branches): `machineInstalled`.
   - `src/ecs/systems/workload-run.ts` — on the completion branch: `contractCompleted`; on the
     deadline-miss branch: `contractMissed`.
   - `src/ecs/systems/resource.ts` — inside the `shouldBeOnline` false transition
     (`powered.online` flips true→false), once per machine going offline this tick: `brownout`.
     Note this can fire multiple times in one tick if several machines brown out together —
     acceptable, matches multiple things actually happening; no de-dup needed for a sub-300ms
     sound.
   - Each system's factory function gains an `audio: Audio` parameter, threaded through from
     `main.ts` alongside the other shared dependencies (`renderer`, `input`, `camera`) — same
     pattern already used for those, not a new one.

4. **`main.ts` wiring:**
   - `const audio = createAudio();` at module scope (construction is cheap/lazy per point 1).
   - Pass `audio` into whichever system factories need it (`createInputSystem`,
     `createInstallProgressSystem`, `createWorkloadRunSystem`, `createResourceSystem`).
   - No change needed to *when* the context resumes — `AudioContext` auto-resumes on first
     `play()` after the landing click's gesture has already happened by the time any gameplay
     sound fires, since gameplay only starts after `onStart`.

5. **HUD mute toggle.** Add a small icon/rect to the top bar in `src/ecs/systems/hud.ts`
   (`drawTopBar`), right-aligned, showing a speaker icon that reflects `audio.isMuted()`.
   Hit-testing goes in `input.ts`'s click-priority chain — add it as a new highest-priority
   check (before shop/panel/build-mode branches) so it's always clickable regardless of mode,
   mirroring how panel/shop hits are already checked first. Layout rect added to
   `src/ui/layout.ts` alongside the other HUD rect helpers, not inlined.

## Background music (added after the initial SFX pass, revised twice — see below)

`Audio` also exposes `startMusic()`/`stopMusic()`: a generative ambient loop, not a sourced
track. Two revisions since the first version:

- **v1**: a single 3-note pad cycling through an arbitrary chord table — read as
  thin/dissonant.
- **v2**: added a continuous sub-bass drone layer (fixed root, detuned unison oscillators) as
  a harmonic anchor, and restricted the pad to consonant intervals over that root — fixed the
  dissonance, but the drone itself turned out to be the bigger problem: a constant,
  unenveloped low tone (compounded by slow beating between its detuned oscillators) read as
  physically uncomfortable to listen to, not just "not to taste" — reported as literally
  headache-inducing.
- **v3 (current)**: drone removed entirely. Two layers remain:
  - **Pad** — detuned-sine chords cycling every `MUSIC_CHORD_SECONDS` (16s) with a 5s
    crossfade, voiced only in consonant multiples of the root (root/5th/octave, per
    `MUSIC_CHORDS`) — the fix that mattered from v2, kept.
  - **Arpeggio** — a sparse, soft triangle-wave pluck every 1.6s, picked from a fixed
    pentatonic degree list (`MUSIC_ARP_DEGREES`) above the pad, giving a quiet "tech pulse"
    texture without ever landing on a clashing note.

  The pad's own root note in every chord already implies a bass anchor without needing a
  separately held tone — so dropping the drone lost nothing structural, only the discomfort.

Both layers connect into one `musicBus` gain node so `setMuted` fades everything in one call,
and are driven by one lookahead scheduler tick (`tickMusicScheduler`, on a `setInterval`
faster than either layer's period), each scheduling its own next event against
`ctx.currentTime` rather than relying on `setInterval`'s own (drifting) timing.

- `main.ts` calls `audio.startMusic()` once, right after `loop.start()` inside the landing
  screen's start-button callback — the same user-gesture-gated call site SFX already relies
  on, so no separate "click to enable audio" prompt is needed.
- Deliberately excluded from this plan's fan-hum-rises-with-power-draw idea (see Non-goals) —
  this is a flat ambient bed, not state-driven.
- **Lesson for any future revision of this loop**: a held/continuous tone (drone, pad note
  without decay, etc.) is the highest-risk element for listener discomfort in a background
  loop — test it in isolation before combining with other layers, since the discomfort can be
  hard to attribute once several layers are playing together.

## Non-goals

- No screen shake or other visual juice — sound only, per the ask.
- No sourced/loaded audio assets or asset pipeline — oscillator synthesis only, music
  included.
- No per-sound or separate music volume sliders — a single mute toggle only, per the
  backlog's cost framing; it silences music and SFX together.
- No fan-hum-rises-with-power-draw continuous/ambient SFX layered onto machines — the backlog
  mentions it, but that's a per-machine, state-driven sound distinct from the flat ambient
  music bed added here. Deliberately deferred to keep this plan's scope reviewable.

## Testing

- `src/audio/index.ts`'s synth functions are pure enough to unit test for shape (duration,
  gain bounds) if the project's test setup makes that cheap; otherwise this module is small
  enough that manual validation (per CLAUDE.md — no automated browser validation) is
  sufficient. The user will validate audibly.
