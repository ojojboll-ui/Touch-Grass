// Touch Grass's sound engine for the web: a line-by-line port of gdext/src
// (GrassEngine.h and the Chordtroller headers it plays: PluckVoice,
// VoiceSpec, the Omnichord plate from ChordRing, Ensemble, TempoDelay and a
// JunoVoice for the drone). Keep the two in step; test/enginetest.mjs renders
// the same score through both and compares them.
//
// Everything lives inside one self-contained factory so the page can run it
// in an AudioWorklet (from a blob made of this function's own source) or, if
// the browser refuses that, on the main thread.

function TouchGrassEngine() {
  "use strict";
  const PI = 3.14159265358979;
  const TAU = 2 * PI;

  // ---- VoiceSpec ------------------------------------------------------------
  const PULSE = 0, SAW = 1, SINE = 2;
  const VOICES = [
    { name: "OMNI",     wave: PULSE, pw: 0.35, filterMultiple: 7.0,  decayScale: 1.00, attack: 0.0020, detune: 3.0 },
    { name: "HARPA",    wave: SAW,   pw: 0.0,  filterMultiple: 5.0,  decayScale: 1.15, attack: 0.0030, detune: 2.0 },
    { name: "VIBRAFON", wave: SINE,  pw: 0.0,  filterMultiple: 12.0, decayScale: 1.60, attack: 0.0040, detune: 1.5 },
    { name: "GITARR",   wave: PULSE, pw: 0.20, filterMultiple: 9.0,  decayScale: 0.70, attack: 0.0015, detune: 4.0 },
    // not a pluck: each string is a short bow stroke on Chordtroller's bowed string
    { name: "CELLO", bowed: true, decayScale: 1.0 },
    // not a pluck either: each string is a breath into a reed flute
    { name: "NEY", blown: true, decayScale: 1.0 },
    // Chordtroller's Juno voice played as a keyboard: each string a key held a while
    { name: "JUNO", synth: true, decayScale: 1.0 },
  ];

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  function polyBlep(t, dt) {
    if (dt <= 0) return 0;
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }

  // ---- PluckVoice -------------------------------------------------------------
  class PluckVoice {
    constructor(sr) { this.sr = sr; this.reset(); }
    reset() {
      this.active = false; this.attacking = false; this.env = 0; this.lowpass = 0;
      this.phase1 = 0; this.phase2 = 0.37; this.inc1 = 0; this.inc2 = 0;
      this.target = 1; this.attackStep = 0.01; this.decayCoef = 0.999; this.filterG = 0.5;
      this.spec = null; this.stringIdx = -1; this.stamp = 0;
    }
    // bright 0..1 is this note's own colour: 1 the voice as designed, lower
    // closes its lowpass (about three octaves down at 0). Each note keeps it,
    // so one finger playing softly never dulls another's strum.
    start(freq, velocity, decayCoef, spec, stringIndex, stamp, bright = 1) {
      const wasActive = this.active;
      this.spec = spec;
      const spread = Math.pow(2, spec.detune / 1200);
      this.inc1 = freq / spread / this.sr;
      this.inc2 = freq * spread / this.sr;
      if (!wasActive) { this.phase1 = 0; this.phase2 = 0.37; this.lowpass = 0; }
      // a darker note is boosted back to the same loudness: brightness is colour, not volume
      this.target = clamp(velocity, 0, 1) * Math.pow(2, (1 - clamp(bright, 0, 1)) * 0.95);
      this.attackStep = this.target / Math.max(1, this.sr * spec.attack);
      this.attacking = true;
      this.decayCoef = decayCoef;
      const cutoff = clamp(clamp(freq * spec.filterMultiple, 800, 14000) * Math.pow(2, (clamp(bright, 0, 1) - 1) * 3.2), 250, 16000);
      this.filterG = 1 - Math.exp(-2 * PI * cutoff / this.sr);
      this.stringIdx = stringIndex;
      this.stamp = stamp;
      this.active = true;
    }
    stopQuickly() {
      if (!this.active) return;
      this.attacking = false;
      this.decayCoef = Math.pow(0.001, 1 / Math.max(1, this.sr * 0.005));
    }
    osc(phase, inc) {
      const s = this.spec;
      if (s.wave === SINE) return Math.sin(TAU * phase);
      if (s.wave === SAW) return (2 * phase - 1) - polyBlep(phase, inc);
      let v = phase < s.pw ? 1 : -1;
      v += polyBlep(phase, inc);
      let falling = phase + (1 - s.pw);
      if (falling >= 1) falling -= 1;
      return v - polyBlep(falling, inc);
    }
    process() {
      if (this.attacking) {
        this.env += this.attackStep;
        if (this.env >= this.target) { this.env = this.target; this.attacking = false; }
      } else {
        this.env *= this.decayCoef;
        if (this.env < 1e-4) { this.active = false; this.env = 0; return 0; }
      }
      const raw = (this.osc(this.phase1, this.inc1) + this.osc(this.phase2, this.inc2)) * 0.5;
      this.phase1 += this.inc1; if (this.phase1 >= 1) this.phase1 -= 1;
      this.phase2 += this.inc2; if (this.phase2 >= 1) this.phase2 -= 1;
      const g = clamp(this.filterG * (0.35 + 0.65 * this.env), 0.0005, 0.99);
      this.lowpass += g * (raw - this.lowpass);
      return this.lowpass * this.env;
    }
  }

  // ---- The Omnichord plate (ChordRing.h StringSet) ----------------------------
  // quality: 0 major, 1 minor, 2 dominant 7, 3 major 7, 4 minor 7
  const THIRD = [4, 3, 4, 4, 3];
  const COLOUR = [7, 7, 10, 11, 10];

  function plate(root, quality) {
    const pc = ((root % 12) + 12) % 12;
    const q = clamp(quality | 0, 0, 4);
    const base = pc <= 5 ? 48 + pc : 36 + pc;
    const colourOffset = (base + COLOUR[q] - 12) >= 42 ? COLOUR[q] - 12 : COLOUR[q];
    const out = [];
    for (let o = 0; o < 4; o++) {
      const r = base + 12 * o;
      out.push(r, r + THIRD[q], r + colourOffset);
    }
    out.push(base + 48);
    return out;
  }

  // ---- Ensemble ---------------------------------------------------------------
  class Ensemble {
    constructor(sr) {
      this.sr = sr;
      this.buf = new Float32Array(Math.floor(sr * 0.05) + 4);
      this.w = 0; this.phase = 0; this.rate = 0.45; this.mix = 0.5;
      this.lpL = 0; this.lpR = 0;
      this.lpc = 1 - Math.exp(-2 * PI * 7000 / sr);
    }
    tri(p) { p -= Math.floor(p); return 1 - Math.abs(2 * p - 1); }
    tap(ms) {
      const size = this.buf.length;
      let pos = this.w - ms * 0.001 * this.sr;
      while (pos < 0) pos += size;
      const a = pos | 0, b = (a + 1) % size, f = pos - a;
      return this.buf[a] * (1 - f) + this.buf[b] * f;
    }
    process(x, out) {
      this.buf[this.w] = x;
      this.phase += this.rate / this.sr;
      if (this.phase >= 1) this.phase -= 1;
      const wl = this.tap(1.2 + this.tri(this.phase) * 4.8);
      const wr = this.tap(1.2 + this.tri(this.phase + 0.5) * 4.8);
      this.lpL += this.lpc * (wl - this.lpL);
      this.lpR += this.lpc * (wr - this.lpR);
      out[0] = x * (1 - this.mix) + this.lpL * this.mix;
      out[1] = x * (1 - this.mix) + this.lpR * this.mix;
      if (++this.w >= this.buf.length) this.w = 0;
    }
  }

  // ---- TempoDelay: ping-pong, dotted eighth, darker each time round ------------
  class TempoDelay {
    constructor(sr) {
      this.sr = sr;
      this.L = new Float32Array(Math.floor(sr * 2.5) + 4);
      this.R = new Float32Array(this.L.length);
      this.w = 0; this.lowL = 0; this.lowR = 0; this.send = 0; this.fb = 0.3;
      this.target = 11025; this.current = 11025;
    }
    setTiming(bpm, division) {
      const beats = [0.5, 0.75, 1.0][clamp(division, 0, 2)];
      const sec = 60 / Math.max(40, bpm) * beats;
      this.target = Math.min(sec * this.sr, this.L.length - 4);
    }
    setAmount(send, fb) { this.send = clamp(send, 0, 1); this.fb = clamp(fb, 0, 0.85); }
    read(line, d) {
      let pos = this.w - d;
      while (pos < 0) pos += line.length;
      const a = pos | 0, b = (a + 1) % line.length, f = pos - a;
      return line[a] * (1 - f) + line[b] * f;
    }
    process(io) {
      this.current += (this.target - this.current) * 0.0005;
      const wl = this.read(this.L, this.current), wr = this.read(this.R, this.current);
      this.lowL += 0.35 * (wl - this.lowL);
      this.lowR += 0.35 * (wr - this.lowR);
      const input = (io[0] + io[1]) * 0.5 * this.send;
      this.L[this.w] = input + this.lowR * this.fb;
      this.R[this.w] = this.lowL * this.fb;
      if (++this.w >= this.L.length) this.w = 0;
      io[0] += wl; io[1] += wr;
    }
  }

  // ---- JunoVoice (PAD patch) for the drone ------------------------------------
  const PAD = { saw: 0.80, pulse: 0.45, sub: 0.30, noise: 0.0, pw: 0.50, pwm: 0.35, lfoRate: 0.45,
                env: 0.22, key: 0.30, hpf: 0.05, A: 0.55, D: 1.20, S: 0.80, R: 1.40, level: 0.55 };
  const IDLE = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4;

  function softClip(x) { x = clamp(x, -3, 3); return x * (27 + x * x) / (27 + 9 * x * x); }

  // The clouds' patch: a soft brass after Chordtroller's BRASS. Saw-heavy, the
  // swell slower than a horn's bite, the filter low and opening only a little
  // with the envelope, so it is round rather than bright; the release is set
  // from the ring time
  const CLOUD = { saw: 0.90, pulse: 0.15, sub: 0.30, noise: 0.0, pw: 0.50, pwm: 0.10, lfoRate: 0.5,
                  env: 0.30, key: 0.30, hpf: 0.05, A: 0.09, D: 0.80, S: 0.70, R: 1.00, level: 0.60 };

  class JunoVoice {
    constructor(sr, patch = PAD) {
      this.sr = sr; this.p = patch;
      const coef = (s) => Math.pow(0.001, 1 / Math.max(1, sr * s));
      this.attackStep = 1 / Math.max(1, sr * patch.A);
      this.decayCoef = coef(patch.D); this.releaseCoef = coef(patch.R);
      this.hpfCoef = 1 - Math.exp(-2 * PI * (20 * Math.pow(2, patch.hpf * 5.3)) / sr);
      this.active = false; this.gateOn = false; this.env = 0; this.stage = IDLE;
      this.s1 = this.s2 = this.s3 = this.s4 = 0; this.hpLow = 0;
      this.phase = 0; this.subPhase = 0; this.inc = 0; this.note = -1; this.vel = 1; this.stamp = 0;
      this.G = 0.5; this.g = 1; this.tick = 0;   // filter coefficients, refreshed every 16 samples
    }
    noteOn(note, vel, order) {
      if (!this.active) { this.phase = 0; this.subPhase = 0; }
      this.note = note; this.vel = vel;
      this.inc = 440 * Math.pow(2, (note - 69) / 12) / this.sr;
      this.stage = ATTACK; this.active = true; this.gateOn = true; this.stamp = order;
    }
    noteOff() { if (!this.gateOn) return; this.gateOn = false; this.stage = RELEASE; }
    setRelease(seconds) { this.releaseCoef = Math.pow(0.001, 1 / Math.max(1, this.sr * seconds)); }
    advance() {
      const p = this.p;
      switch (this.stage) {
        case ATTACK: this.env += this.attackStep; if (this.env >= 1) { this.env = 1; this.stage = DECAY; } break;
        case DECAY: this.env = p.S + (this.env - p.S) * this.decayCoef; if (Math.abs(this.env - p.S) < 1e-3) this.stage = SUSTAIN; break;
        case SUSTAIN: this.env = p.S; if (this.env <= 1e-4) { this.active = false; this.stage = IDLE; } break;
        case RELEASE: this.env *= this.releaseCoef; if (this.env < 1e-4) { this.env = 0; this.active = false; this.stage = IDLE; } break;
      }
    }
    process(lfo, cutoff, resonance, envScale) {
      this.advance();
      if (!this.active) return 0;
      const p = this.p, dt = this.inc;
      const width = clamp(p.pw + lfo * p.pwm * 0.4, 0.05, 0.95);
      const saw = (2 * this.phase - 1) - polyBlep(this.phase, dt);
      let pulse = this.phase < width ? 1 : -1;
      pulse += polyBlep(this.phase, dt);
      let f = this.phase + 1 - width; if (f >= 1) f -= 1;
      pulse -= polyBlep(f, dt);
      let sub = this.subPhase < 0.5 ? 1 : -1;
      sub += polyBlep(this.subPhase, dt * 0.5);
      let s2 = this.subPhase + 0.5; if (s2 >= 1) s2 -= 1;
      sub -= polyBlep(s2, dt * 0.5);
      const mixTotal = Math.max(1, p.saw + p.pulse + p.sub + p.noise);
      let x = (saw * p.saw + pulse * p.pulse + sub * p.sub) / mixTotal;
      this.phase += dt; if (this.phase >= 1) this.phase -= 1;
      this.subPhase += dt * 0.5; if (this.subPhase >= 1) this.subPhase -= 1;
      this.hpLow += this.hpfCoef * (x - this.hpLow);
      x -= this.hpLow;
      const position = clamp(cutoff + p.env * this.env * envScale + p.key * (this.note - 60) / 120, 0, 1);
      // the pad's cutoff moves slowly (its envelope is seconds long), so the
      // tan and pow are only worked out every 16 samples: on a phone they were
      // most of the cost
      if ((this.tick++ & 15) === 0) {
        const hz = Math.min(20 * Math.pow(2, position * 10), 0.45 * this.sr);
        this.g = Math.tan(PI * hz / this.sr);
        this.G = this.g / (1 + this.g);
      }
      const g = this.g, G = this.G;
      const k = clamp(resonance, 0, 1) * 3.85;
      const S = (G * G * G * this.s1 + G * G * this.s2 + G * this.s3 + this.s4) / (1 + g);
      const u = softClip((x - k * S) / (1 + k * G * G * G * G));
      let v = (u - this.s1) * G; const y1 = v + this.s1; this.s1 = y1 + v;
      v = (y1 - this.s2) * G; const y2 = v + this.s2; this.s2 = y2 + v;
      v = (y2 - this.s3) * G; const y3 = v + this.s3; this.s3 = y3 + v;
      v = (y3 - this.s4) * G; const y4 = v + this.s4; this.s4 = y4 + v;
      return y4 * (1 + k * 0.5) * this.env * this.vel * p.level;
    }
  }

  // ---- the cello: Chordtroller's bowed string (dsp/BowedString.h, StringEngine.h) ----
  // A digital waveguide with the bow as a friction junction (Smith and Woodhouse's
  // hyperbolic friction, solved exactly as a quadratic, hysteresis kept). Ported
  // line by line; what differs is only the playing: here every plucked string is
  // a short stroke, the bow set down, drawn for a while, lifted, and the string
  // left to ring. The lessons that made it play clean carry over: loss as a fixed
  // share per period, the loop's lowpass at a multiple of the pitch, force from
  // the speed the bow is asked for, every stroke leaning in from a third of the
  // limit, and the string run at twice the sample rate.

  class FractionalDelay {
    constructor(maxDelay) {
      let size = 16;
      while (size < maxDelay + 8) size <<= 1;
      this.buf = new Float32Array(size); this.mask = size - 1; this.w = 0;
    }
    clear() { this.buf.fill(0); }
    push(x) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
    // four-point Lagrange, so a moving read point does not wobble the partials
    read(delay) {
      delay = clamp(delay, 2, this.mask - 4);
      const whole = delay | 0, f = delay - whole, b = this.buf, m = this.mask, w = this.w;
      const ym1 = b[(w - (whole - 1)) & m], y0 = b[(w - whole) & m], y1 = b[(w - whole - 1) & m], y2 = b[(w - whole - 2) & m];
      const fm1 = f + 1, f1 = f - 1, f2 = f - 2;
      return ym1 * (-f * f1 * f2 / 6) + y0 * (fm1 * f1 * f2 * 0.5) + y1 * (-fm1 * f * f2 * 0.5) + y2 * (fm1 * f * f1 / 6);
    }
  }

  const MU_S = 0.8, MU_D = 0.3, MU_SPAN = 0.5, SLIP_KNEE = 0.08;
  class BowedString {
    constructor(sr) {
      this.sr = sr;
      const longest = ((sr / 20) | 0) + 8;
      this.toFinger = new FractionalDelay(longest);
      this.toBridge = new FractionalDelay(longest);
      this.fingerLength = 100; this.bridgeLength = 10; this.betaNow = 0.1;
      this.loopGain = 0.99; this.pole = 0.2; this.lowpassDelay = 0;
      this.reset();
    }
    reset() { this.toFinger.clear(); this.toBridge.clear(); this.lp = 0; this.sticking = false; }
    // loss as log10 of the gain per round trip; the loop lowpass's delay is taken
    // off the finger side so the string is not flat
    setLosses(hz, logLoss, lowpassHz) {
      hz = Math.max(hz, 20);
      this.loopGain = Math.pow(10, -logLoss);
      this.pole = Math.exp(-2 * PI * Math.min(lowpassHz, 0.45 * this.sr) / this.sr);
      const w = 2 * PI * hz / this.sr;
      this.lowpassDelay = Math.atan2(this.pole * Math.sin(w), 1 - this.pole * Math.cos(w)) / w;
    }
    setTuning(hz, bowPosition) {
      const period = this.sr / clamp(hz, 20, this.sr / 12);
      this.bridgeLength = clamp(bowPosition * period, 2.5, period * 0.4);
      this.fingerLength = Math.max(2.5, period - this.bridgeLength - this.lowpassDelay);
      this.betaNow = this.bridgeLength / period;
    }
    process(bowVelocity, bowForce, restDamping) {
      const atBridge = this.toBridge.read(this.bridgeLength);
      const fromFinger = -this.toFinger.read(this.fingerLength);
      this.lp = (1 - this.pole) * atBridge + this.pole * this.lp;
      const fromBridge = -this.loopGain * this.lp;
      const incoming = fromFinger + fromBridge;
      const added = this.friction(bowVelocity, bowForce, incoming) - restDamping * incoming;
      this.toFinger.push(fromBridge + added);
      this.toBridge.push(fromFinger + added);
      return atBridge;
    }
    friction(vb, k, vh) {
      if (k <= 0) { this.sticking = false; return 0; }
      const want = vb - vh, a = Math.abs(want), sgn = want >= 0 ? 1 : -1;
      const canStick = a <= k * MU_S;
      if (this.sticking && canStick) return want;
      const b = SLIP_KNEE - a + k * MU_D, c = SLIP_KNEE * (k * MU_S - a), disc = b * b - 4 * c;
      if (disc >= 0) {
        const x = 0.5 * (-b + Math.sqrt(disc));
        if (x > 0) { this.sticking = false; return sgn * (a - x); }
      }
      this.sticking = true;          // no slipping solution left: the hair has caught the string
      return want;
    }
  }

  // The cello's body: Chordtroller's violin plate modes scaled to a cello.
  class StringBody {
    constructor(sr) {
      this.sr = sr;
      const MODES = [[275, 14, 0.90, 0], [405, 18, 0.30, 0], [460, 22, 1.10, 0], [540, 22, 1.00, 0], [700, 16, 0.45, 0],
                     [860, 16, 0.40, 0], [1050, 14, 0.45, 0], [1320, 12, 0.40, 0], [1650, 10, 0.40, 1], [2100, 6, 0.60, 1],
                     [2650, 6, 0.70, 1], [3300, 6, 0.45, 1], [4600, 4, 0.22, 1]];
      const low = 0.42, high = 0.62;                 // CELLO: plate modes and the bridge hill
      this.modes = MODES.map(([hz, q, gain, hill]) => {
        hz = Math.min(hz * (hill ? high : low), 0.45 * sr);
        const w = 2 * PI * hz / sr, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
        return { b0: alpha / a0, b2: -alpha / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - alpha) / a0, gain, z1: 0, z2: 0 };
      });
      const w = 2 * PI * (190 * low) / sr, alpha = Math.sin(w) / (2 * 0.7071), cw = Math.cos(w), a0 = 1 + alpha;
      this.hp = { b0: (1 + cw) * 0.5 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) * 0.5 / a0, a1: -2 * cw / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
      this.lp = 0;
      this.lpc = 1 - Math.exp(-2 * PI * Math.min(7500 * high, 0.45 * sr) / sr);
    }
    process(x) {
      const h = this.hp;
      const direct = h.b0 * x + h.b1 * h.x1 + h.b2 * h.x2 - h.a1 * h.y1 - h.a2 * h.y2;
      h.x2 = h.x1; h.x1 = x; h.y2 = h.y1; h.y1 = direct;
      let sum = direct * 0.35;
      for (const m of this.modes) {
        const y = m.b0 * x + m.z1;
        m.z1 = -m.a1 * y + m.z2;
        m.z2 = m.b2 * x - m.a2 * y;
        sum += y * m.gain;
      }
      this.lp += (sum - this.lp) * this.lpc;
      return this.lp;
    }
  }

  const OVERSAMPLE = 2;
  class CelloVoice {
    constructor(sr) { this.sr = sr; this.string = new BowedString(sr * OVERSAMPLE); this.active = false; this.note = -1; this.stamp = 0; }
    start(note, velocity, bright, holdSeconds, stamp) {
      while (note > 79) note -= 12;              // above the cello's reach: an octave down
      const hz = 440 * Math.pow(2, (note - 69) / 12);
      if (!this.active || this.note !== note) this.string.reset();
      this.note = note; this.stamp = stamp; this.active = true;
      const loss = 0.003 * Math.max(1, 200 / hz);              // below 200 Hz the loss per period grows
      this.string.setLosses(hz, loss, Math.min(hz * (8 + 6 * clamp(bright, 0, 1)), 5000));
      this.string.setTuning(hz, 0.1);
      this.vbTarget = 0.07 + 0.15 * clamp(velocity, 0, 1);      // metres a second
      this.vb = this.vb || 0;
      this.bowCoef = 1 - Math.exp(-hz / (6 * this.sr));         // up to speed over about six periods
      this.settle = 0;
      this.settleCoef = 1 - Math.exp(-hz / (30 * this.sr));     // leans in over thirty periods
      this.holdLeft = Math.round(holdSeconds * this.sr);
      this.bowing = true;
      this.level = 0.02;
    }
    process() {
      if (this.bowing && --this.holdLeft <= 0) this.bowing = false;
      this.vb += ((this.bowing ? this.vbTarget : 0) - this.vb) * this.bowCoef;
      this.settle += (1 - this.settle) * this.settleCoef;
      // force from the speed asked for, not the speed reached; from 0.35 to 0.55 of Schelleng's limit
      const k = this.bowing ? (0.35 + 0.2 * this.settle) * this.vbTarget / (this.string.betaNow * MU_SPAN) : 0;
      let out = 0;
      for (let i = 0; i < OVERSAMPLE; i++) out += this.string.process(this.vb, k, 0);
      out *= 1 / OVERSAMPLE;
      this.level = Math.max(Math.abs(out), this.level * 0.9997);
      if (!this.bowing && this.level < 2e-4) this.active = false;
      return out;
    }
  }

  class CelloSection {
    constructor(sr, voices) {
      this.voices = Array.from({ length: voices }, () => new CelloVoice(sr));
      this.body = new StringBody(sr);
      this.dcIn = 0; this.dcOut = 0; this.dcCoef = 1 - 2 * PI * 12 / sr;
    }
    start(note, velocity, bright, hold, stamp) {
      let v = this.voices.find((x) => x.active && x.note === note) || this.voices.find((x) => !x.active);
      if (!v) { v = this.voices[0]; for (const x of this.voices) if (x.stamp < v.stamp) v = x; }
      v.start(note, velocity, bright, hold, stamp);
    }
    allOff() { for (const v of this.voices) { v.bowing = false; v.active = false; v.string.reset(); } }
    process() {
      let sum = 0, any = false;
      for (const v of this.voices) if (v.active) { sum += v.process(); any = true; }
      const y = this.body.process(sum);
      // the loop carries a little DC after a stroke
      this.dcOut = y - this.dcIn + this.dcCoef * this.dcOut; this.dcIn = y;
      return any || Math.abs(this.dcOut) > 1e-6 ? this.dcOut : 0;
    }
  }

  // Juno voices played from the strings: each note is a key held for a while
  // (a third of the ring time), then let go to the release (the rest of it).
  // How hard and how deep a finger plays opens the filter a little.
  class JunoSection {
    constructor(sr, voices) {
      this.sr = sr;
      this.voices = Array.from({ length: voices }, () => new JunoVoice(sr, CLOUD));
      this.hold = new Float32Array(voices); this.cut = new Float32Array(voices);
      this.lfoPhase = 0;
    }
    start(note, velocity, bright, holdSeconds, releaseSeconds, stamp) {
      while (note < 48) note += 12;
      while (note > 91) note -= 12;
      const vs = this.voices;
      let k = vs.findIndex((v) => v.active && v.note === note);
      if (k < 0) k = vs.findIndex((v) => !v.active);
      if (k < 0) { k = 0; for (let i = 1; i < vs.length; i++) if (vs[i].stamp < vs[k].stamp) k = i; }
      vs[k].setRelease(releaseSeconds);
      vs[k].noteOn(note, 0.55 + 0.45 * clamp(velocity, 0, 1), stamp);
      this.hold[k] = holdSeconds * this.sr;
      this.cut[k] = 0.20 + 0.12 * clamp(bright, 0, 1);
    }
    allOff() { for (const v of this.voices) v.noteOff(); }
    process() {
      this.lfoPhase += CLOUD.lfoRate / this.sr; if (this.lfoPhase >= 1) this.lfoPhase -= 1;
      const lfo = Math.sin(2 * PI * this.lfoPhase);
      let s = 0;
      for (let k = 0; k < this.voices.length; k++) {
        const v = this.voices[k];
        if (!v.active) continue;
        if (v.gateOn && --this.hold[k] <= 0) v.noteOff();
        s += v.process(lfo, this.cut[k], 0.08, 1);
      }
      return s;
    }
  }

  // ---- the ney: a blown reed flute ------------------------------------------------
  // No free ney recordings exist with more than a note or two, so it is made:
  // a soft fundamental with a few weak overtones, breath noise tuned to the same
  // pitch by two resonant bandpasses, and a wide airy hiss over it all, which is
  // most of what makes a ney a ney. Each note is a breath: it swells in over a
  // tenth of a second while the pitch rises into tune from a little below, a
  // vibrato grows once the note has settled, and it fades when the breath ends.
  class Bandpass {
    set(sr, hz, q) {
      const w = 2 * PI * Math.min(hz, 0.45 * sr) / sr, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
      this.b0 = alpha / a0; this.b2 = -alpha / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - alpha) / a0;
      this.z1 = this.z1 || 0; this.z2 = this.z2 || 0;
    }
    process(x) { const y = this.b0 * x + this.z1; this.z1 = -this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  }

  class NeyVoice {
    constructor(sr) {
      this.sr = sr; this.active = false; this.note = -1; this.stamp = 0;
      this.bp1 = new Bandpass(); this.bp2 = new Bandpass(); this.hissLp = 0; this.hissHp = 0;
      this.rng = 0x1234567 + Math.floor(Math.random() * 1e6);
      this.phase = 0;
    }
    noise() { this.rng ^= this.rng << 13; this.rng ^= this.rng >>> 17; this.rng ^= this.rng << 5; return ((this.rng >>> 0) / 4294967296) * 2 - 1; }
    start(note, velocity, bright, holdSeconds, stamp) {
      while (note < 55) note += 12;                // a ney's reach: from about G3
      while (note > 88) note -= 12;
      this.note = note; this.stamp = stamp; this.active = true;
      this.hz = 440 * Math.pow(2, (note - 69) / 12);
      this.bp1.set(this.sr, this.hz, 9);
      this.bp2.set(this.sr, this.hz * 2, 7);
      this.amp = 0.5 + 0.5 * clamp(velocity, 0, 1);
      this.breathy = 0.62 + 0.2 * (1 - clamp(bright, 0, 1));       // a soft touch is a little breathier
      this.t = 0; this.hold = holdSeconds; this.env = this.env || 0;
      this.attack = 1 - Math.exp(-1 / (0.09 * this.sr));
      this.release = 1 - Math.exp(-1 / (0.32 * this.sr));
      this.vibPhase = Math.random();
    }
    process() {
      const t = (this.t += 1 / this.sr);
      const blowing = t < this.hold;
      this.env += ((blowing ? 1 : 0) - this.env) * (blowing ? this.attack : this.release);
      if (!blowing && this.env < 1e-4) { this.active = false; this.env = 0; return 0; }
      // into tune from a third of a semitone below, and a vibrato that grows after half a second
      const scoop = -0.35 * Math.exp(-t / 0.08);
      this.vibPhase += 5.1 / this.sr;
      const vib = 0.12 * clamp((t - 0.45) / 0.6, 0, 1) * Math.sin(2 * PI * this.vibPhase);
      const hz = this.hz * Math.pow(2, (scoop + vib) / 12);
      this.phase += hz / this.sr; if (this.phase >= 1) this.phase -= 1;
      const a = 2 * PI * this.phase;
      const tone = Math.sin(a) + 0.22 * Math.sin(2 * a) + 0.08 * Math.sin(3 * a);
      const n = this.noise();
      const pitched = this.bp1.process(n) * 1.6 + this.bp2.process(n) * 0.7;
      // the airy hiss: noise band-limited to roughly 1.5 to 7 kHz
      this.hissLp += 0.45 * (n - this.hissLp);
      this.hissHp += 0.12 * (this.hissLp - this.hissHp);
      const hiss = this.hissLp - this.hissHp;
      const flutter = 1 + 0.06 * Math.sin(2 * PI * this.vibPhase * 0.7 + 1.3);   // the breath is never quite steady
      // the tone carries the note; the breath stays under it, except for the
      // puff of air as each note is blown into, gone in a tenth of a second.
      // The hiss is kept low: it sits where the ear is keenest, so a little
      // of it sounds like a lot
      const puff = 0.5 * Math.exp(-t / 0.1);
      const breath = (pitched * 0.5 + hiss * 0.15) * (this.breathy + puff);
      return (tone * 0.62 + breath) * this.env * this.amp * flutter;
    }
  }

  class NeySection {
    constructor(sr, voices) { this.voices = Array.from({ length: voices }, () => new NeyVoice(sr)); }
    start(note, velocity, bright, hold, stamp) {
      let v = this.voices.find((x) => x.active && x.note === note) || this.voices.find((x) => !x.active);
      if (!v) { v = this.voices[0]; for (const x of this.voices) if (x.stamp < v.stamp) v = x; }
      v.start(note, velocity, bright, hold, stamp);
    }
    allOff() { for (const v of this.voices) { v.active = false; v.env = 0; } }
    process() { let s = 0; for (const v of this.voices) if (v.active) s += v.process(); return s; }
  }

  // ---- GrassEngine --------------------------------------------------------------
  const STRING_GAIN = 0.38, DRONE_GAIN = 1.1;

  class GrassEngine {
    constructor(sr, pluckVoices = 48) {
      this.sr = sr;
      this.cello = new CelloSection(sr, pluckVoices >= 48 ? 8 : 6);
      this.celloGain = 0.46;
      this.ney = new NeySection(sr, 10);
      this.neyGain = 0.4;
      this.juno = new JunoSection(sr, 12);
      this.junoGain = 1.7;
      this.plucks = Array.from({ length: pluckVoices }, () => new PluckVoice(sr));
      this.drone = Array.from({ length: 8 }, () => new JunoVoice(sr));
      this.ensemble = new Ensemble(sr);
      this.delay = new TempoDelay(sr);
      this.delay.setTiming(72, 1);
      this.delay.setAmount(0.22, 0.38);
      this.pending = [];
      this.voiceIndex = 1; this.ringSeconds = 3.5; this.decayCoef = 0.9999;
      this.stamp = 0; this.droneStamp = 0;
      this.droneTarget = 0.35; this.droneLevel = 0; this.droneCutoff = 0.42; this.anyDrone = false; this.lfoPhase = 0;
      this.masterTarget = 0.8; this.master = 0.8;
      this.toneTarget = 0.75; this.tone = 0.75; this.toneState = 0;
      this.toneTick = 0; this.toneG = 0.5;
      this.chord = null; this.strings = plate(0, 0);
      this.frame = [0, 0];
      this.updateDecay();
    }
    setChord(root, quality) {
      const key = (((root % 12) + 12) % 12) * 8 + (quality | 0);
      const changed = this.chord !== key;
      this.chord = key;
      this.strings = plate(root, quality);
      if (changed) this.restrikeDrone(root, quality);
    }
    pluck(index, velocity, delaySamples) {
      if (index < 0 || index >= this.strings.length) return;
      this.pluckNote(this.strings[index], velocity, delaySamples);
    }
    pluckNote(note, velocity, delaySamples, bright = 1) {
      if (this.pending.length >= 128) return;
      this.pending.push({ note, vel: clamp(velocity, 0, 1), left: Math.max(0, delaySamples | 0), bright });
    }
    setVoice(i) { const n = VOICES.length; this.voiceIndex = ((i % n) + n) % n; this.updateDecay(); }
    setRing(s) { this.ringSeconds = clamp(s, 0.2, 30); this.updateDecay(); }
    setDroneLevel(v) { this.droneTarget = clamp(v, 0, 1); }
    setDroneBrightness(v) { this.droneCutoff = clamp(v, 0, 1); }
    setDelay(send, fb, bpm) { this.delay.setAmount(send, fb); this.delay.setTiming(bpm, 1); }
    setEnsembleMix(m) { this.ensemble.mix = clamp(m, 0, 1); }
    setMaster(g) { this.masterTarget = clamp(g, 0, 2); }
    setTone(t) { this.toneTarget = clamp(t, 0, 1); }
    allOff() { this.pending.length = 0; this.cello.allOff(); this.ney.allOff(); this.juno.allOff(); for (const v of this.plucks) v.stopQuickly(); for (const v of this.drone) v.noteOff(); this.chord = null; }
    activePlucks() { let n = 0; for (const v of this.plucks) if (v.active) n++; return n; }

    updateDecay() {
      const len = this.ringSeconds * VOICES[this.voiceIndex].decayScale;
      this.decayCoef = Math.pow(0.001, 1 / Math.max(1, this.sr * len));
      for (const v of this.plucks) if (v.active) v.decayCoef = this.decayCoef;
    }
    startNote(note, vel, bright = 1) {
      if (note < 0 || note > 127) return;
      if (VOICES[this.voiceIndex].synth) {
        const hold = clamp(this.ringSeconds * 0.3, 0.25, 3);
        this.juno.start(note, vel, bright, hold, clamp(this.ringSeconds * 0.5, 0.4, 8), ++this.stamp);
        return;
      }
      if (VOICES[this.voiceIndex].blown) {
        // a breath as long as a third of the ring time asks
        this.ney.start(note, vel, bright, clamp(this.ringSeconds * 0.3, 0.3, 3), ++this.stamp);
        return;
      }
      if (VOICES[this.voiceIndex].bowed) {
        // a bow stroke as long as a third of the ring time asks, then the string rings
        this.cello.start(note, vel, bright, clamp(this.ringSeconds * 0.3, 0.25, 3), ++this.stamp);
        return;
      }
      const freq = 440 * Math.pow(2, (note - 69) / 12);
      this.allocate(note).start(freq, vel, this.decayCoef, VOICES[this.voiceIndex], note, ++this.stamp, bright);
    }
    allocate(note) {
      for (const v of this.plucks) if (v.active && v.stringIdx === note) return v;
      for (const v of this.plucks) if (!v.active) return v;
      let oldest = this.plucks[0];
      for (const v of this.plucks) if (v.stamp < oldest.stamp) oldest = v;
      return oldest;
    }
    restrikeDrone(root, quality) {
      for (const v of this.drone) v.noteOff();
      const pc = ((root % 12) + 12) % 12, q = clamp(quality | 0, 0, 4);
      const base = pc <= 5 ? 48 + pc : 36 + pc;
      const notes = [base, base + COLOUR[q], base + 12 + THIRD[q], base + 12];
      const vel = [0.75, 0.6, 0.55, 0.45];
      for (let k = 0; k < 4; k++) this.freeDrone().noteOn(notes[k], vel[k], ++this.droneStamp);
      this.anyDrone = true;
    }
    freeDrone() {
      for (const v of this.drone) if (!v.active) return v;
      let o = null;
      for (const v of this.drone) if (!v.gateOn && (o === null || v.stamp < o.stamp)) o = v;
      if (o) return o;
      o = this.drone[0];
      for (const v of this.drone) if (v.stamp < o.stamp) o = v;
      return o;
    }
    firePending() {
      const p = this.pending;
      for (let k = 0; k < p.length;) {
        if (p[k].left-- > 0) { k++; continue; }
        this.startNote(p[k].note, p[k].vel, p[k].bright);
        p[k] = p[p.length - 1];
        p.pop();
      }
    }
    render(L, R, n, offset = 0) {
      const fr = this.frame;
      for (let i = 0; i < n; i++) {
        if (this.pending.length) this.firePending();
        let strings = 0;
        for (const v of this.plucks) if (v.active) strings += v.process();
        strings += this.cello.process() * this.celloGain;
        strings += this.ney.process() * this.neyGain;
        strings += this.juno.process() * this.junoGain;

        this.tone += (this.toneTarget - this.tone) * 0.002;
        if ((this.toneTick++ & 15) === 0) {
          const fc = Math.min(900 * Math.pow(2, this.tone * 4.2), 0.45 * this.sr);
          const g = Math.tan(3.14159265 * fc / this.sr);
          this.toneG = g / (1 + g);
        }
        const v = (strings - this.toneState) * this.toneG;
        const lp = v + this.toneState;
        this.toneState = lp + v;
        strings = lp;

        this.droneLevel += (this.droneTarget - this.droneLevel) * 0.0005;
        this.master += (this.masterTarget - this.master) * 0.001;

        let pad = 0;
        if (this.droneLevel > 1e-4 || this.anyDrone) {
          this.lfoPhase += PAD.lfoRate / this.sr;
          if (this.lfoPhase >= 1) this.lfoPhase -= 1;
          const lfo = Math.sin(2 * 3.14159265358979 * this.lfoPhase);
          this.anyDrone = false;
          for (const d of this.drone) {
            if (d.active) { this.anyDrone = true; pad += d.process(lfo, this.droneCutoff, 0.12, 1); }
          }
        }
        const mono = strings * STRING_GAIN + pad * this.droneLevel * DRONE_GAIN;
        this.ensemble.process(mono, fr);
        this.delay.process(fr);
        L[offset + i] = softClip(fr[0] * this.master);
        R[offset + i] = softClip(fr[1] * this.master);
      }
    }
    // commands from the page, the same set the Godot extension takes
    command(c) {
      switch (c.t) {
        case "pluckNote": this.pluckNote(c.note, c.vel, Math.round((c.delay || 0) * this.sr), c.bright == null ? 1 : c.bright); break;
        case "pluck": this.pluck(c.index, c.vel, Math.round((c.delay || 0) * this.sr)); break;
        case "chord": this.setChord(c.root, c.quality); break;
        case "tone": this.setTone(c.v); break;
        case "drone": this.setDroneLevel(c.v); break;
        case "droneBright": this.setDroneBrightness(c.v); break;
        case "master": this.setMaster(c.v); break;
        case "voice": this.setVoice(c.v); break;
        case "ring": this.setRing(c.v); break;
        case "alloff": this.allOff(); break;
      }
    }
  }

  return { GrassEngine, plate, VOICES, CelloVoice, NeyVoice };
}

// The AudioWorklet side: a processor that owns one engine and takes commands
// over its port. Turned into a blob by the page together with the factory.
function TouchGrassProcessor(E) {
  class P extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const voices = (options && options.processorOptions && options.processorOptions.voices) || 48;
      this.engine = new E.GrassEngine(sampleRate, voices);
      this.port.onmessage = (e) => {
        const m = e.data;
        if (Array.isArray(m)) for (const c of m) this.engine.command(c);
        else this.engine.command(m);
      };
    }
    process(inputs, outputs) {
      const out = outputs[0];
      const L = out[0], R = out[1] || out[0];
      this.engine.render(L, R, L.length);
      return true;
    }
  }
  registerProcessor("grass-engine", P);
}

if (typeof module !== "undefined") module.exports = { TouchGrassEngine };
