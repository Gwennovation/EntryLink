// Audible scan feedback so staff don't have to watch the screen at a loud gate:
// one high beep = admitted, two low buzzes = rejected. Generated with Web Audio (no sound files).
//
// Browsers only allow audio after the user interacts with the page, so the context is created
// (or resumed) on the first tap or click.

let ctx = null;

function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null; // no Web Audio: vibration and the on-screen banner still work
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function tone(freq, start, duration, type) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // Short fade in/out avoids clicks.
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

export function playResult(valid) {
  if (!ctx || ctx.state !== 'running') return;
  if (valid) {
    tone(1320, 0, 0.18, 'sine');
  } else {
    tone(220, 0, 0.16, 'square');
    tone(220, 0.22, 0.16, 'square');
  }
}

export { unlock as unlockSound };
