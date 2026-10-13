// Original, quiet UI cues. Audio is created only after a user gesture.
// Frequency, ending frequency, duration, gain, delay (seconds).
const cues = {
  move: [[420, 340, .035, .025, 0]],
  open: [[440, 660, .075, .024, 0]],
  close: [[600, 400, .075, .024, 0]],
  copy: [[660, 660, .055, .022, 0], [880, 880, .075, .018, .045]],
  toggle: [[360, 480, .05, .028, 0]],
  drop: [[280, 180, .065, .035, 0]],
  boundary: [[190, 130, .08, .03, 0]],
};

export function createSoundPlayer(enabled) {
  let context, generation = 0, lastPlayed = -Infinity, lastCue;
  const voices = new Set();

  async function unlock() {
    try {
      if (!context || context.state === 'closed') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        context = new AudioContext();
      }
      if (context.state !== 'running') await context.resume();
      return context.state === 'running';
    } catch { return false; }
  }

  function stop() {
    generation++;
    if (!context) return;
    const now = context.currentTime;
    for (const { oscillator, gain } of voices) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, .003);
      oscillator.stop(now + .012);
    }
    voices.clear();
  }

  async function play(name) {
    if (!cues[name] || document.hidden || !enabled()) return false;
    const requested = performance.now(), current = generation;
    if (!await unlock() || current !== generation || document.hidden || !enabled()) return false;
    // Never replay a delayed gesture or pile up sounds during key repeats.
    const now = performance.now();
    if (now - requested > 250 || (name === lastCue && now - lastPlayed < 90)) return false;
    stop(); lastPlayed = now; lastCue = name;
    for (const [frequency, endFrequency, duration, volume, delay] of cues[name]) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const start = context.currentTime + delay;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      gain.gain.linearRampToValueAtTime(0, start + duration + .008);
      oscillator.connect(gain); gain.connect(context.destination);
      const voice = { oscillator, gain }; voices.add(voice);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); voices.delete(voice); };
      oscillator.start(start); oscillator.stop(start + duration + .01);
    }
    return true;
  }

  return { play, stop, unlock };
}
