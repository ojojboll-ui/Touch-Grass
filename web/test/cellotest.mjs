// The cello voice: does the bow set up clean Helmholtz motion (one slip per
// period once the stroke has settled), is the tone periodic, is it about as
// loud as the plucked voices, and is it fast enough for a phone?
//     node web/test/cellotest.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { TouchGrassEngine } = require(path.join(here, "..", "engine.js"));
const E = TouchGrassEngine();
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "ok    " : "FAIL  ") + msg); if (!ok) failures++; };
const sr = 48000;

// one voice, one note: count slips (stick -> slip) per period in the held part
for (const note of [43, 55, 67, 76]) {
  const v = new E.CelloVoice(sr);
  v.start(note, 0.7, 0.8, 1.5, 1);
  const hz = 440 * Math.pow(2, (note - 69) / 12);
  const out = new Float32Array(sr * 2);
  // a slip counts only if it lasts at least a fiftieth of a period: shorter
  // ones are numerical chatter (Chordtroller's measuring rule)
  const minSlip = Math.max(1, Math.round(sr / hz / 50));
  let slips = 0, wasSticking = true, counted = 0, slipStart = -1;
  for (let i = 0; i < out.length; i++) {
    out[i] = v.process();
    if (i > sr * 0.5 && i < sr * 1.4) {
      const st = v.string.sticking;
      if (wasSticking && !st) slipStart = i;
      if (!wasSticking && st && slipStart >= 0 && i - slipStart >= minSlip) slips++;
      wasSticking = st; counted++;
    }
  }
  const periods = counted / sr * hz * 1;          // output-rate periods counted (the string runs at 2x, stick state sampled at 1x)
  const perPeriod = slips / periods;
  // periodicity: normalised autocorrelation at one period, in the held part
  const P = Math.round(sr / hz), a = Math.round(sr * 0.8);
  let xy = 0, xx = 0, yy = 0;
  for (let i = a; i < a + sr * 0.4; i++) { xy += out[i] * out[i + P]; xx += out[i] * out[i]; yy += out[i + P] * out[i + P]; }
  const r = xy / Math.sqrt(xx * yy + 1e-20);
  let tail = 0; for (let i = Math.round(sr * 1.9); i < sr * 2; i++) tail = Math.max(tail, Math.abs(out[i]));
  check(out.every(Number.isFinite), `MIDI ${note}: finite`);
  check(perPeriod > 0.85 && perPeriod < 1.2, `MIDI ${note}: ${perPeriod.toFixed(2)} slips per period while bowed (Helmholtz is one)`);
  check(r > 0.9, `MIDI ${note}: periodic while bowed (r = ${r.toFixed(3)})`);
  check(tail > 1e-4, `MIDI ${note}: still ringing after the bow lifts (${tail.toExponential(1)})`);
}

// loudness against the harp, through the whole engine, and speed
function render(voice) {
  const e = new E.GrassEngine(sr);
  e.setDroneLevel(0); e.setDelay(0, 0, 72); e.setEnsembleMix(0); e.setTone(1);
  e.setVoice(voice); e.setRing(4);
  const plate = E.plate(7, 0);
  plate.forEach((n, i) => e.pluckNote(n, 0.72, i * 2400));
  const L = new Float32Array(sr * 3), R = new Float32Array(sr * 3);
  const t0 = performance.now();
  for (let i = 0; i < L.length; i += 128) e.render(L, R, 128, i);
  const ms = performance.now() - t0;
  let s = 0; for (const x of L) s += x * x;
  return { rms: Math.sqrt(s / L.length), speed: 3000 / ms, finite: L.every(Number.isFinite) };
}
const harp = render(1), cello = render(4);
check(cello.finite, "a strum on the cello stays finite");
const db = 20 * Math.log10(cello.rms / harp.rms);
check(Math.abs(db) < 4, `cello strum within 4 dB of the harp (${db.toFixed(1)} dB)`);
check(cello.speed > 10, `cello strum renders ${cello.speed.toFixed(0)}x faster than real time (harp ${harp.speed.toFixed(0)}x)`);
process.exit(failures ? 1 : 0);
