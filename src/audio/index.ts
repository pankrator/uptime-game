// Small WebAudio-based SFX module. Systems call play(name) with a named event — never touch
// AudioContext/oscillators directly — so gameplay code stays decoupled from how a sound is
// synthesized. Oscillator synthesis only (no loaded assets), per .plans/sound-and-juice.md.
const MUTE_STORAGE_KEY = 'dcmgr.audio.muted';

export type SoundName =
  | 'rackPlaced'
  | 'machineInstalled'
  | 'contractCompleted'
  | 'contractMissed'
  | 'brownout'
  | 'uiClick'
  | 'machineFailed'
  | 'machineRepaired'
  | 'machineDecommissioned';

export interface Audio {
  play(name: SoundName): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  startMusic(): void;
  stopMusic(): void;
}

interface Tone {
  type: OscillatorType;
  // Frequency envelope: [startHz, endHz] over the tone's duration.
  freq: [number, number];
  duration: number;
  gain: number;
  delay?: number; // start offset within the sound, for multi-note chimes
}

// Background music: a generative ambient loop — not a sourced/loaded track (see
// .plans/sound-and-juice.md's oscillator-only approach). Two layers:
//   - a slow filtered pad cycling through consonant chords (root + 5th + octave voicings
//     only — no seconds/tritones, which is what made an earlier version sound dissonant)
//   - a sparse, soft arpeggio plucking notes from the current chord on a slightly irregular
//     schedule, for a quiet "tech pulse" texture without becoming a busy melody
// A continuous sub-bass drone layer was tried and removed — a constant, unenveloped low tone
// (plus the slow beating between its detuned unison oscillators) reads as physically
// uncomfortable over time rather than just "not to taste". The pad's own root note in every
// chord already implies the bass anchor without holding a tone open indefinitely.
// All in the key of A (55 Hz root) — a comfortably low, unobtrusive key for a background bed.
const MUSIC_ROOT_HZ = 55; // A1
const MUSIC_CHORDS = [
  [1, 1.5, 2], // root, 5th, octave
  [1, 1.5, 2.5], // root, 5th, octave+major third (adds a little color, still consonant)
  [0.75, 1, 1.5], // borrowed root a 4th down, own 5th above that
  [1, 1.5, 2], // back to the anchor voicing before repeating
];
const MUSIC_CHORD_SECONDS = 16;
const MUSIC_CHORD_FADE_SECONDS = 5;
const MUSIC_PAD_PEAK_GAIN = 0.045;
const MUSIC_ARP_GAIN = 0.05;
// Scale degrees (as multiples of the root) the arpeggio picks from — major pentatonic one and
// two octaves up, so it always sits above the pad and never lands on a dissonant note against
// whichever chord is currently playing.
const MUSIC_ARP_DEGREES = [2, 2.5, 3, 4, 4.5, 4, 3, 2.5];
const MUSIC_ARP_STEP_SECONDS = 1.6;

const SOUND_TONES: Record<SoundName, Tone[]> = {
  rackPlaced: [{ type: 'triangle', freq: [180, 90], duration: 0.08, gain: 0.18 }],
  machineInstalled: [
    { type: 'sine', freq: [440, 440], duration: 0.09, gain: 0.12 },
    { type: 'sine', freq: [660, 660], duration: 0.1, gain: 0.12, delay: 0.08 },
  ],
  contractCompleted: [
    { type: 'sine', freq: [523, 523], duration: 0.09, gain: 0.14 },
    { type: 'sine', freq: [784, 784], duration: 0.14, gain: 0.14, delay: 0.09 },
  ],
  contractMissed: [
    { type: 'sine', freq: [392, 349], duration: 0.09, gain: 0.1 },
    { type: 'sine', freq: [311, 277], duration: 0.14, gain: 0.1, delay: 0.09 },
  ],
  brownout: [{ type: 'sawtooth', freq: [110, 70], duration: 0.18, gain: 0.12 }],
  uiClick: [{ type: 'square', freq: [880, 880], duration: 0.03, gain: 0.08 }],
  // A harsher, lower buzz than brownout — a failure is a dead machine, not a recoverable dip.
  machineFailed: [
    { type: 'sawtooth', freq: [140, 55], duration: 0.22, gain: 0.14 },
    { type: 'square', freq: [90, 40], duration: 0.16, gain: 0.09, delay: 0.05 },
  ],
  machineRepaired: [
    { type: 'sine', freq: [330, 330], duration: 0.09, gain: 0.12 },
    { type: 'sine', freq: [523, 523], duration: 0.12, gain: 0.12, delay: 0.08 },
  ],
  machineDecommissioned: [{ type: 'triangle', freq: [200, 80], duration: 0.14, gain: 0.14 }],
};

function readStoredMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore — private mode / disabled storage. Mute state just won't persist across reloads.
  }
}

export function createAudio(): Audio {
  let ctx: AudioContext | null = null;
  let muted = readStoredMuted();

  // Music scheduling state. musicBus is the single node setMuted fades — pad and arp both
  // connect into it, so one fade covers the whole loop. Each layer is driven by its own
  // lookahead scheduler tick, queuing ahead of `ctx.currentTime` so neither drifts against
  // `setInterval`'s own imprecision.
  let musicBus: GainNode | null = null;
  let musicTimer: ReturnType<typeof setInterval> | null = null;
  let musicChordIndex = 0;
  let nextChordAt = 0;
  let nextArpAt = 0;
  let arpStepIndex = 0;
  let musicRunning = false;

  function ensureContext(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  }

  function playTone(context: AudioContext, tone: Tone, startAt: number): void {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.freq[0], startAt);
    oscillator.frequency.linearRampToValueAtTime(tone.freq[1], startAt + tone.duration);

    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(tone.gain, startAt + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, startAt + tone.duration);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.01);
  }

  // Schedules one pad chord: each note as a detuned-pair sine through a lowpass filter, gain
  // ramped up then down over MUSIC_CHORD_SECONDS so consecutive chords crossfade rather than
  // cut. Chord intervals are consonant multiples of the root (see MUSIC_CHORDS), so nothing in
  // the voicing can clash against itself as chords change.
  function schedulePadChord(context: AudioContext, bus: GainNode, startAt: number): void {
    const chord = MUSIC_CHORDS[musicChordIndex % MUSIC_CHORDS.length];
    musicChordIndex += 1;

    for (const multiple of chord) {
      const baseHz = MUSIC_ROOT_HZ * multiple;
      for (const detune of [-3, 3]) {
        const oscillator = context.createOscillator();
        const noteGain = context.createGain();
        const filter = context.createBiquadFilter();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(baseHz, startAt);
        oscillator.detune.setValueAtTime(detune, startAt);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, startAt);

        noteGain.gain.setValueAtTime(0, startAt);
        noteGain.gain.linearRampToValueAtTime(MUSIC_PAD_PEAK_GAIN, startAt + MUSIC_CHORD_FADE_SECONDS);
        noteGain.gain.setValueAtTime(MUSIC_PAD_PEAK_GAIN, startAt + MUSIC_CHORD_SECONDS - MUSIC_CHORD_FADE_SECONDS);
        noteGain.gain.linearRampToValueAtTime(0, startAt + MUSIC_CHORD_SECONDS);

        oscillator.connect(filter);
        filter.connect(noteGain);
        noteGain.connect(bus);
        oscillator.start(startAt);
        oscillator.stop(startAt + MUSIC_CHORD_SECONDS + 0.1);
      }
    }
  }

  // Schedules one arpeggio pluck: a single short, soft triangle note with a quick decay — the
  // "tech pulse" texture. Notes are picked from MUSIC_ARP_DEGREES, which only contains
  // consonant degrees above the pad, so it can never land on a clashing note regardless of
  // which pad chord happens to be playing underneath it at the time.
  function scheduleArpNote(context: AudioContext, bus: GainNode, startAt: number): void {
    const degree = MUSIC_ARP_DEGREES[arpStepIndex % MUSIC_ARP_DEGREES.length];
    arpStepIndex += 1;

    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    const filter = context.createBiquadFilter();
    const duration = 0.5;

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(MUSIC_ROOT_HZ * degree, startAt);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, startAt);

    noteGain.gain.setValueAtTime(0, startAt);
    noteGain.gain.linearRampToValueAtTime(MUSIC_ARP_GAIN, startAt + 0.03);
    noteGain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

    oscillator.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(bus);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.05);
  }

  // Lookahead scheduler for the pad and arp: ticks faster than either layer's own period so it
  // always has time to queue the next event before the current one ends, scheduling against
  // `ctx.currentTime` rather than `setInterval`'s own (drifting) timing.
  function tickMusicScheduler(): void {
    if (!musicRunning || !ctx || !musicBus) return;
    while (nextChordAt < ctx.currentTime + MUSIC_CHORD_SECONDS) {
      schedulePadChord(ctx, musicBus, nextChordAt);
      nextChordAt += MUSIC_CHORD_SECONDS;
    }
    while (nextArpAt < ctx.currentTime + MUSIC_ARP_STEP_SECONDS) {
      scheduleArpNote(ctx, musicBus, nextArpAt);
      nextArpAt += MUSIC_ARP_STEP_SECONDS;
    }
  }

  return {
    play(name) {
      if (muted) return;
      const context = ensureContext();
      if (!context) return;
      if (context.state === 'suspended') void context.resume();

      for (const tone of SOUND_TONES[name]) {
        playTone(context, tone, context.currentTime + (tone.delay ?? 0));
      }
    },
    setMuted(value) {
      muted = value;
      writeStoredMuted(muted);
      if (musicBus && ctx) {
        musicBus.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.2);
      }
    },
    isMuted() {
      return muted;
    },
    startMusic() {
      if (musicRunning) return;
      const context = ensureContext();
      if (!context) return;
      if (context.state === 'suspended') void context.resume();

      // musicBus carries the combined mix at unity gain — each layer (pad/arp) sets its own
      // absolute level, so this node only needs to express mute on/off, not an overall mix
      // level. Keeps setMuted a single, simple fade regardless of how many layers exist.
      musicBus = context.createGain();
      musicBus.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
      musicBus.connect(context.destination);

      musicChordIndex = 0;
      arpStepIndex = 0;
      nextChordAt = context.currentTime;
      // Offset the arpeggio's start so its first pluck doesn't land right on top of the first
      // chord's attack.
      nextArpAt = context.currentTime + MUSIC_ARP_STEP_SECONDS;
      musicRunning = true;
      tickMusicScheduler();
      musicTimer = setInterval(tickMusicScheduler, (MUSIC_ARP_STEP_SECONDS / 2) * 1000);
    },
    stopMusic() {
      musicRunning = false;
      if (musicTimer !== null) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
      if (musicBus && ctx) {
        // Let already-scheduled pad/arp notes ring out naturally rather than clicking off —
        // fade the bus, then disconnect once nothing is left playing into it.
        const bus = musicBus;
        const context = ctx;
        bus.gain.setTargetAtTime(0, context.currentTime, 0.2);
        setTimeout(() => bus.disconnect(), MUSIC_CHORD_SECONDS * 1000);
      }
      musicBus = null;
    },
  };
}
