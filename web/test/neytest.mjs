// The ney: in tune once settled, breathy (noise in the mix), and about as loud as the harp.
//     node web/test/neytest.mjs
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
for (const note of [57, 64, 72, 81]) {
  const v = new E.NeyVoice(sr);
  v.start(note, 0.7, 0.8, 1.2, 1);
  const out = new Float32Array(sr * 4);
  for (let i = 0; i < out.length; i++) out[i] = v.process();
  const hz = 440 * Math.pow(2, (note - 69) / 12);
  // pitch: the lag with the best autocorrelation near one period, 0.2-0.4 s in (before vibrato)
  const a = Math.round(sr * 0.2), len = Math.round(sr * 0.2), P = sr / hz;
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(P * 0.9); lag <= Math.ceil(P * 1.1); lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = a; i < a + len; i++) { xy += out[i] * out[i + lag]; xx += out[i] * out[i]; yy += out[i + lag] * out[i + lag]; }
    const r = xy / Math.sqrt(xx * yy + 1e-20);
    if (r > best) { best = r; bestLag = lag; }
  }
  const cents = 1200 * Math.log2(P / bestLag);
  check(out.every(Number.isFinite), `MIDI ${note}: finite`);
  check(Math.abs(cents) < 25, `MIDI ${note}: in tune (${cents.toFixed(0)} cents, lag resolution ~${(1200 * Math.log2((P + 1) / P)).toFixed(0)})`);
  check(best > 0.5 && best < 0.97, `MIDI ${note}: pitched but breathy (periodicity ${best.toFixed(2)})`);
  let tail = 0; for (let i = Math.round(sr * 3.9); i < sr * 4; i++) tail = Math.max(tail, Math.abs(out[i]));
  check(tail < 1e-3, `MIDI ${note}: the breath ends (${tail.toExponential(1)})`);
}
function render(voice) {
  const e = new E.GrassEngine(sr);
  e.setDroneLevel(0); e.setDelay(0, 0, 72); e.setEnsembleMix(0); e.setTone(1); e.setVoice(voice); e.setRing(4);
  E.plate(7, 0).forEach((n, i) => e.pluckNote(n, 0.72, i * 2400));
  const L = new Float32Array(sr * 3), R = new Float32Array(sr * 3);
  const t0 = performance.now();
  for (let i = 0; i < L.length; i += 128) e.render(L, R, 128, i);
  const ms = performance.now() - t0;
  let s = 0; for (const x of L) s += x * x;
  return { rms: Math.sqrt(s / L.length), speed: 3000 / ms, finite: L.every(Number.isFinite) };
}
const harp = render(1), ney = render(5);
check(ney.finite, "a strum on the ney stays finite");
const db = 20 * Math.log10(ney.rms / harp.rms);
check(Math.abs(db) < 4, `ney strum within 4 dB of the harp (${db.toFixed(1)} dB)`);
check(ney.speed > 10, `ney strum renders ${ney.speed.toFixed(0)}x faster than real time`);
process.exit(failures ? 1 : 0);
