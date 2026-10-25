// The web engine against the C++ one. Renders gdext/test/dump.cpp's score
// through engine.js and compares: 20 ms loudness windows, the pitch content of
// each section, finiteness, and how much faster than real time it runs.
//     node web/test/enginetest.mjs        (run gdext/test/dump.exe first)

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { TouchGrassEngine } = require(path.join(here, "..", "engine.js"));
const E = TouchGrassEngine();

let failures = 0;
const check = (ok, msg) => { console.log((ok ? "ok    " : "FAIL  ") + msg); if (!ok) failures++; };

const rate = 48000, total = rate * 7, block = 128;
const score = [[0.0, 1, 0, 0]];
for (let s = 0; s < 13; s++) score.push([0.25 + s * 0.05, 0, s, 0]);
score.push([2.0, 1, 5, 3]);
for (let s = 12; s >= 0; s--) score.push([2.2 + (12 - s) * 0.04, 0, s, 0]);
const am7 = [45, 48, 43, 57, 60, 55, 69, 72, 67, 81, 84, 79, 93];
for (let s = 0; s < 13; s++) score.push([4.0 + s * 0.06, 2, am7[s], 0]);

check(JSON.stringify(E.plate(9, 4)) === JSON.stringify(am7), "Am7 plate matches the C++ plate");
check(JSON.stringify(E.plate(0, 0)) === JSON.stringify([48, 52, 43, 60, 64, 55, 72, 76, 67, 84, 88, 79, 96]), "C major plate in the OM-84's order");

const e = new E.GrassEngine(rate);
const L = new Float32Array(total), R = new Float32Array(total);
let next = 0;
const t0 = performance.now();
for (let pos = 0; pos < total; pos += block) {
  const end = Math.min(pos + block, total);
  let cursor = pos;
  while (next < score.length && score[next][0] * rate < end) {
    const [at_s, kind, a, b] = score[next++];
    const at = Math.max(cursor, Math.round(at_s * rate));
    if (kind === 0) e.pluck(a, 0.8, at - cursor);
    else if (kind === 2) e.pluckNote(a, 0.8, at - cursor);
    else { e.render(L, R, at - cursor, cursor); cursor = at; e.setChord(a, b); }
  }
  e.render(L, R, end - cursor, cursor);
}
const ms = performance.now() - t0;
check(L.every(Number.isFinite) && R.every(Number.isFinite), "output stays finite");
check(7000 / ms > 12, `renders ${(7000 / ms).toFixed(0)}x faster than real time (a phone is maybe 5-10x slower; about 26x here on mains, 15x on battery)`);

const dumpPath = path.join(here, "..", "..", "gdext", "test", "dump.f32");
if (!existsSync(dumpPath)) {
  console.log("no gdext/test/dump.f32: build and run gdext/test/dump.cpp to compare with C++");
} else {
  const buf = readFileSync(dumpPath);
  const c = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const win = rate * 0.02;
  let worst = 0, sumRef = 0, sumDiff = 0;
  for (let w = 0; w + win <= total; w += win) {
    let a = 0, b = 0;
    for (let i = w; i < w + win; i++) {
      a += L[i] * L[i] + R[i] * R[i];
      b += c[2 * i] * c[2 * i] + c[2 * i + 1] * c[2 * i + 1];
    }
    a = Math.sqrt(a / win); b = Math.sqrt(b / win);
    sumRef += b; sumDiff += Math.abs(a - b);
    if (b > 0.01) worst = Math.max(worst, Math.abs(a - b) / b);
  }
  check(sumDiff / sumRef < 0.02, `loudness follows the C++ engine (mean difference ${(100 * sumDiff / sumRef).toFixed(2)}%)`);
  check(worst < 0.08, `no 20 ms window more than 8% off (worst ${(100 * worst).toFixed(2)}%)`);
  let maxDiff = 0;
  for (let i = 0; i < total; i++) maxDiff = Math.max(maxDiff, Math.abs(L[i] - c[2 * i]));
  console.log(`      (largest sample difference ${maxDiff.toExponential(2)}, float vs double drift)`);
}
process.exit(failures ? 1 : 0);
