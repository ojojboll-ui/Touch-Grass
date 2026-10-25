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
    start(freq, velocity, decayCoef, spec, stringIndex, stamp) {
      const wasActive = this.active;
      this.spec = spec;
      const spread = Math.pow(2, spec.detune / 1200);
      this.inc1 = freq / spread / this.sr;
      this.inc2 = freq * spread / this.sr;
      if (!wasActive) { this.phase1 = 0; this.phase2 = 0.37; this.lowpass = 0; }
      this.target = clamp(velocity, 0, 1);
      this.attackStep = this.target / Math.max(1, this.sr * spec.attack);
      this.attacking = true;
      this.decayCoef = decayCoef;
      const cutoff = clamp(freq * spec.filterMultiple, 800, 14000);
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

  class JunoVoice {
    constructor(sr) {
      this.sr = sr; this.p = PAD;
      const coef = (s) => Math.pow(0.001, 1 / Math.max(1, sr * s));
      this.attackStep = 1 / Math.max(1, sr * PAD.A);
      this.decayCoef = coef(PAD.D); this.releaseCoef = coef(PAD.R);
      this.hpfCoef = 1 - Math.exp(-2 * PI * (20 * Math.pow(2, PAD.hpf * 5.3)) / sr);
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

  // ---- GrassEngine --------------------------------------------------------------
  const STRING_GAIN = 0.38, DRONE_GAIN = 1.1;

  class GrassEngine {
    constructor(sr, pluckVoices = 48) {
      this.sr = sr;
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
    pluckNote(note, velocity, delaySamples) {
      if (this.pending.length >= 128) return;
      this.pending.push({ note, vel: clamp(velocity, 0, 1), left: Math.max(0, delaySamples | 0) });
    }
    setVoice(i) { this.voiceIndex = ((i % 4) + 4) % 4; this.updateDecay(); }
    setRing(s) { this.ringSeconds = clamp(s, 0.2, 30); this.updateDecay(); }
    setDroneLevel(v) { this.droneTarget = clamp(v, 0, 1); }
    setDroneBrightness(v) { this.droneCutoff = clamp(v, 0, 1); }
    setDelay(send, fb, bpm) { this.delay.setAmount(send, fb); this.delay.setTiming(bpm, 1); }
    setEnsembleMix(m) { this.ensemble.mix = clamp(m, 0, 1); }
    setMaster(g) { this.masterTarget = clamp(g, 0, 2); }
    setTone(t) { this.toneTarget = clamp(t, 0, 1); }
    allOff() { this.pending.length = 0; for (const v of this.plucks) v.stopQuickly(); for (const v of this.drone) v.noteOff(); }
    activePlucks() { let n = 0; for (const v of this.plucks) if (v.active) n++; return n; }

    updateDecay() {
      const len = this.ringSeconds * VOICES[this.voiceIndex].decayScale;
      this.decayCoef = Math.pow(0.001, 1 / Math.max(1, this.sr * len));
      for (const v of this.plucks) if (v.active) v.decayCoef = this.decayCoef;
    }
    startNote(note, vel) {
      if (note < 0 || note > 127) return;
      const freq = 440 * Math.pow(2, (note - 69) / 12);
      this.allocate(note).start(freq, vel, this.decayCoef, VOICES[this.voiceIndex], note, ++this.stamp);
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
        this.startNote(p[k].note, p[k].vel);
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
        case "pluckNote": this.pluckNote(c.note, c.vel, Math.round((c.delay || 0) * this.sr)); break;
        case "pluck": this.pluck(c.index, c.vel, Math.round((c.delay || 0) * this.sr)); break;
        case "chord": this.setChord(c.root, c.quality); break;
        case "tone": this.setTone(c.v); break;
        case "drone": this.setDroneLevel(c.v); break;
        case "master": this.setMaster(c.v); break;
        case "voice": this.setVoice(c.v); break;
        case "ring": this.setRing(c.v); break;
        case "alloff": this.allOff(); break;
      }
    }
  }

  return { GrassEngine, plate, VOICES };
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
