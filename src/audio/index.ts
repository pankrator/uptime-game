// Small WebAudio-based SFX module. Systems call play(name) with a named event — never touch
// AudioContext/oscillators directly — so gameplay code stays decoupled from how a sound is
// synthesized. SFX are oscillator synthesis, per .plans/sound-and-juice.md; background music is
// a loaded track (see MUSIC_TRACK_URL below) rather than generated.
const MUTE_STORAGE_KEY = 'dcmgr.audio.muted';
const MUSIC_TRACK_URL = `${import.meta.env.BASE_URL}audio/The_Quiet_Logic.mp3`;
const MUSIC_VOLUME = 0.35;

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
  let musicElement: HTMLAudioElement | null = null;

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
      if (musicElement) {
        musicElement.muted = muted;
      }
    },
    isMuted() {
      return muted;
    },
    startMusic() {
      if (musicElement) return;
      musicElement = new window.Audio(MUSIC_TRACK_URL);
      musicElement.loop = true;
      musicElement.volume = MUSIC_VOLUME;
      musicElement.muted = muted;
      void musicElement.play().catch(() => {
        // Autoplay can be blocked until the next user gesture; play() is retried by whatever
        // triggers startMusic() again (e.g. the caller can hook a click listener). Nothing to
        // recover here — the element stays ready and unmuted state is already set.
      });
    },
    stopMusic() {
      if (!musicElement) return;
      musicElement.pause();
      musicElement.currentTime = 0;
      musicElement = null;
    },
  };
}
