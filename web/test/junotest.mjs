// The Juno voice played from the strings: finite, lets go, about as loud as the harp.
//     node web/test/junotest.mjs
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
const JUNO = E.VOICES.findIndex((v) => v.synth);
check(JUNO >= 0, `the Juno is voice ${JUNO}`);
function render(voice, seconds = 3, ring = 4) {
  const e = new E.GrassEngine(sr);
  e.setDroneLevel(0); e.setDelay(0, 0, 72); e.setEnsembleMix(0); e.setTone(1); e.setVoice(voice); e.setRing(ring);
  E.plate(7, 0).forEach((n, i) => e.pluckNote(n, 0.72, i * 2400));
  const L = new Float32Array(sr * seconds), R = new Float32Array(sr * seconds);
  const t0 = performance.now();
  for (let i = 0; i < L.length; i += 128) e.render(L, R, 128, i);
  const ms = performance.now() - t0;
  let s = 0; for (let i = 0; i < sr * 3; i++) s += L[i] * L[i];
  return { L, rms: Math.sqrt(s / (sr * 3)), speed: seconds * 1000 / ms, finite: L.every(Number.isFinite) };
}
const harp = render(1), juno = render(JUNO);
check(juno.finite, "a strum on the Juno stays finite");
const db = 20 * Math.log10(juno.rms / harp.rms);
check(Math.abs(db) < 4, `Juno strum within 4 dB of the harp (${db.toFixed(1)} dB)`);
check(juno.speed > 10, `Juno strum renders ${juno.speed.toFixed(0)}x faster than real time`);
const long = render(JUNO, 12, 4);
let tail = 0; for (let i = sr * 11; i < sr * 12; i++) tail = Math.max(tail, Math.abs(long.L[i]));
check(tail < 1e-3, `the keys let go and the sound ends (${tail.toExponential(1)})`);
process.exit(failures ? 1 : 0);
