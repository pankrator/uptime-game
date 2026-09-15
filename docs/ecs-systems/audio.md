# audio

`src/audio/index.ts` — `createAudio()`, not itself an ECS system (no `update`, no `World`
dependency) but a shared dependency threaded through several systems, documented here since
its usage pattern is part of the update-order contract.

## Purpose

Short, synthesized SFX (WebAudio oscillators, no loaded assets) for key state changes, a
generative ambient music bed, and a persisted mute toggle covering both. Systems never touch
`AudioContext` directly — they call `audio.play(name)` with one of the `SoundName` union
values, or `startMusic()`/`stopMusic()`.

## Interface

```ts
interface Audio {
  play(name: SoundName): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  startMusic(): void;
  stopMusic(): void;
}
```

`play()` is always safe to call — it's a no-op when muted or when `AudioContext` is
unavailable, never throws. `AudioContext` is constructed lazily on first use (not at
`createAudio()` call time), since `main.ts` constructs the instance before the landing
screen's start-button click — the user gesture browsers require before audio can play.

## Music

`startMusic()` begins a generative ambient loop, two layers combined on one `musicBus` gain
node (which `setMuted` fades as a whole, separate from one-shot SFX):

- **Pad** (`schedulePadChord`) — detuned-sine chords voiced only in consonant multiples of the
  root (`MUSIC_ROOT_HZ`, 55 Hz / A1; `MUSIC_CHORDS` — root/5th/octave, no seconds or
  tritones), cycling every `MUSIC_CHORD_SECONDS` with a `MUSIC_CHORD_FADE_SECONDS` crossfade
  so chords blend rather than cut.
- **Arpeggio** (`scheduleArpNote`) — a short, soft triangle-wave pluck every
  `MUSIC_ARP_STEP_SECONDS`, picked from a fixed pentatonic degree list (`MUSIC_ARP_DEGREES`)
  above the pad — the quiet "tech pulse" texture, never a clashing note against whatever chord
  happens to be playing.

Both layers share one lookahead scheduler (`tickMusicScheduler`, on a `setInterval` faster
than either layer's own period) that queues each layer's next event against
`context.currentTime` rather than relying on `setInterval`'s own (drifting) timing.

`stopMusic()` stops the scheduler and fades `musicBus` out, letting already-scheduled pad/arp
notes ring out naturally before disconnecting the bus.

`main.ts` calls `startMusic()` once, immediately after `loop.start()` inside the landing
screen's start callback — the same user-gesture call site every other sound relies on.

**Revision history** (see `.plans/sound-and-juice.md` for the full account):
1. A single pad layer over an arbitrary 3-note chord table — read as thin/dissonant.
2. Added a continuous sub-bass drone (fixed root, detuned unison oscillators) as a harmonic
   anchor, and restricted the pad to consonant intervals over it — fixed the dissonance, but
   the drone itself was reported as physically uncomfortable to listen to (a constant,
   unenveloped low tone, worsened by beating between its detuned oscillators) — not just a
   taste issue.
3. **Current**: drone removed entirely. The pad's own root note in every chord already
   implies a bass anchor, so nothing structural was lost — only the discomfort. A held/
   continuous tone is the highest-risk element for listener discomfort in a loop like this;
   test any future addition of one in isolation before layering it back in.

## Call sites

- `input.ts` — `rackPlaced` after a successful empty-cell placement; `uiClick` on offer
  accept/decline and shop buy-button hits; the mute button itself (drawn by `hud.ts`,
  hit-tested here at the top of the click chain, before even offer buttons, so it's never
  swallowed by a modal or build mode) toggles `setMuted`.
- `install-progress.ts` — `machineInstalled` once a machine actually spawns (not on the
  refund branches).
- `workload-run.ts` — `contractCompleted` / `contractMissed` on those two resolutions.
- `resource.ts` — `brownout` on each machine's online→offline transition (may fire more than
  once per tick if several machines brown out together — acceptable for a sub-300ms sound).
- `hud.ts` — draws the mute button (`getMuteButtonRect`, `ui/layout.ts`) reflecting
  `audio.isMuted()`. Presentation only; the click is handled in `input.ts`.

## Notes

- One `Audio` instance is created once in `main.ts` and passed into every system factory
  that needs it — same pattern as `renderer`/`camera`/`input`.
- Mute state persists to `localStorage` (a per-viewer convenience, not game state) and covers
  music and SFX together — no separate music volume control.
- No per-machine, state-driven ambience (e.g. fan hum tied to power draw) yet — the music bed
  is flat/generative, not reactive to facility state. Deliberately deferred, see
  `.plans/sound-and-juice.md`'s Non-goals.
