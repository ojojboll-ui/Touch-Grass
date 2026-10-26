// ---- scene: the pond -------------------------------------------------------------
// A still pond seen from above. A sweep leaves a wake, a tap drops a ring and a
// splash, every plucked string sends a ring of its plate's colour across the
// surface. Lily pads and fallen leaves and petals ride the waves and drift from
// the fingers; koi glide over a sandy bottom netted with sunlight, flee from
// taps and come close to a finger that rests on the water.
//
// The waves are a real wave equation on the GPU (height and previous height in
// one half-float texture, a few substeps a frame), so rings spread, cross,
// reflect softly and die away on their own. Where half floats cannot be drawn
// into, the pond keeps its light and its coloured rings but has no waves.
const waterScene = (() => {
  const group = new THREE.Group();
  const SIZE = 36, RES = 320, DX = SIZE / RES;
  const RECT = new THREE.Vector3(-SIZE / 2, -SIZE / 2, SIZE);
  const BOTTOM = -1.1, KOI_DEPTH = -0.32;
  const MAX_IMP = 14;
  const simOK = floatTargets;

  const TONEMAP = "vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }";
  const SIM_GLSL = `
    uniform sampler2D uSim; uniform vec3 uSimRect; uniform float uSimOn;
    vec2 simUv(vec2 xz) { return (xz - uSimRect.xy) / uSimRect.z; }
    float simInside(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
    float heightAt(vec2 xz) { vec2 uv = simUv(xz); return texture2D(uSim, uv).r * simInside(uv) * uSimOn; }
    vec2 slopeAt(vec2 xz) {
      float e = ${DX.toFixed(5)};
      return vec2(heightAt(xz + vec2(e, 0.0)) - heightAt(xz - vec2(e, 0.0)),
                  heightAt(xz + vec2(0.0, e)) - heightAt(xz - vec2(0.0, e))) / (2.0 * e);
    }
  `;

  // ---- the wave simulation ----
  function simTarget() {
    return new THREE.WebGLRenderTarget(RES, RES, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
    });
  }
  let simA = simOK ? simTarget() : null, simB = simOK ? simTarget() : null;
  const impulses = Array.from({ length: MAX_IMP }, () => new THREE.Vector4());
  const simMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: {
      uPrev: { value: null }, uTexel: { value: new THREE.Vector2(1 / RES, 1 / RES) },
      uK: { value: 0.045 }, uDamp: { value: 0.9965 }, uInit: { value: 1 },
      uCount: { value: 0 }, uImp: { value: impulses }, uRect: { value: RECT },
    },
    fragmentShader: `
      uniform sampler2D uPrev; uniform vec2 uTexel; uniform float uK, uDamp, uInit;
      uniform int uCount; uniform vec4 uImp[${MAX_IMP}]; uniform vec3 uRect;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uPrev, vUv);
        float h = c.r, hp = c.g;
        float lap = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r + texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r
                  + texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r + texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r - 4.0 * h;
        float hn = (2.0 * h - hp + uK * lap) * uDamp;
        // the rim swallows waves instead of throwing them back
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        hn *= mix(0.92, 1.0, smoothstep(0.0, 0.07, edge));
        vec2 w = uRect.xy + vUv * uRect.z;
        for (int i = 0; i < ${MAX_IMP}; i++) {
          if (i >= uCount) break;
          float d = length(w - uImp[i].xy) / uImp[i].z;
          if (d < 1.0) hn += uImp[i].w * (0.5 + 0.5 * cos(d * 3.14159265));
        }
        hn = clamp(hn, -0.6, 0.6);
        gl_FragColor = mix(vec4(hn, h, 0.0, 1.0), vec4(0.0), uInit);
      }`,
  });
  const queued = [];          // one-shot impulses from taps and plucks
  function impulse(x, z, radius, amount) { if (queued.length < MAX_IMP) queued.push([x, z, radius, amount]); }

  const simUniforms = {
    uSim: { value: simA ? simA.texture : null },
    uSimRect: { value: RECT },
    uSimOn: { value: simOK ? 1 : 0 },
  };
  const common = Object.assign({
    uNoise: { value: noiseTex }, uTime: { value: 0 }, uMusic: { value: new THREE.Vector3() },
  }, lightUniforms, simUniforms);

  // ---- the bottom: sand and pebbles under a net of moving light ----
  const bottomMat = new THREE.ShaderMaterial({
    uniforms: common,
    vertexShader: "varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `
      uniform sampler2D uNoise; uniform float uTime;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vWorld;
      ${SIM_GLSL}
      ${TONEMAP}
      void main() {
        // the waves bend the view of the bottom, as refraction does
        vec2 p = vWorld.xz + slopeAt(vWorld.xz) * 1.4;
        float n = texture2D(uNoise, p / 9.0).b;
        vec3 sand = mix(vec3(0.30, 0.27, 0.19), vec3(0.44, 0.39, 0.28), n);
        float stones = smoothstep(0.62, 0.70, texture2D(uNoise, p / 5.0 + vec2(0.31, 0.77)).r);
        sand = mix(sand, vec3(0.22, 0.22, 0.20) * (0.8 + 0.4 * n), stones);
        float weed = smoothstep(0.58, 0.75, texture2D(uNoise, p / 23.0 + vec2(0.6, 0.2)).g);
        sand = mix(sand, vec3(0.10, 0.20, 0.07), weed * 0.7);
        // caustics: where two drifting noise fields meet, a thin line of light;
        // and where the waves focus the sun, a brighter patch
        vec2 q = p / 6.0;
        float c1 = texture2D(uNoise, q * 0.9 + uTime * vec2(0.010, 0.006)).b;
        float c2 = texture2D(uNoise, q * 1.13 - uTime * vec2(0.008, 0.011) + 0.5).b;
        float caus = (1.0 - smoothstep(0.0, 0.04, abs(c1 - c2))) * smoothstep(0.35, 0.75, texture2D(uNoise, p / 31.0 + uTime * 0.004).g);
        vec2 uv = simUv(vWorld.xz);
        float h = heightAt(vWorld.xz);
        float lapH = heightAt(vWorld.xz + vec2(0.25, 0.0)) + heightAt(vWorld.xz - vec2(0.25, 0.0))
                   + heightAt(vWorld.xz + vec2(0.0, 0.25)) + heightAt(vWorld.xz - vec2(0.0, 0.25)) - 4.0 * h;
        caus = caus * 0.55 + max(-lapH, 0.0) * 9.0;
        vec3 lit = sand * (uAmbient * 0.8 + uSunCol * (0.55 + 0.9 * caus) * max(uSunDir.y, 0.15));
        lit = mix(lit, vec3(0.02, 0.10, 0.10) * (uAmbient + uSunCol * 0.4), 0.48);
        float fog = 1.0 - exp(-uFogDensity * 0.4 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), bottomMat);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = BOTTOM;
  group.add(bottom);

  // ---- the surface: sky in the ripples, clear where you look straight down ----
  const surfaceMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uRipple: { value: rippleRT.texture }, uRippleRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) } }, common),
    transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 vWorld;
      ${SIM_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += heightAt(w.xz);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform sampler2D uRipple; uniform vec3 uRippleRect;
      uniform float uTime; uniform vec3 uMusic;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vWorld;
      ${SIM_GLSL}
      ${TONEMAP}
      float ambient(vec2 xz) {
        return texture2D(uNoise, xz / 7.0 + uTime * vec2(0.012, 0.007)).b * 0.6
             + texture2D(uNoise, xz / 2.3 - uTime * vec2(0.020, 0.013)).b * 0.4;
      }
      void main() {
        vec2 xz = vWorld.xz;
        vec2 s = slopeAt(xz);
        float crest = smoothstep(0.015, 0.12, length(s));     // where the simulated waves stand up
        s *= 0.7;                                              // gentler mirrors on steep waves
        // a breath of wind always moves the surface a little, more with the drone
        float e = 0.08, a0 = ambient(xz);
        vec2 amb = vec2(ambient(xz + vec2(e, 0.0)) - a0, ambient(xz + vec2(0.0, e)) - a0) / e;
        s += amb * (0.022 + uMusic.x * 0.04);
        vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n);
        vec3 zenith = uAmbient * vec3(0.55, 0.85, 1.5);
        vec3 sky = mix(uFogCol, zenith, smoothstep(0.0, 0.7, R.y));
        float spec = pow(max(dot(R, uSunDir), 0.0), 420.0);
        vec3 body = vec3(0.008, 0.055, 0.06) * (uAmbient + uSunCol * 0.3);
        vec3 col = mix(body, sky, fres) + uSunCol * spec * 1.6;
        // rings of colour from the plucked strings, and glints for the high notes
        vec2 ruv = (xz - uRippleRect.xy) / uRippleRect.z;
        vec3 glow = texture2D(uRipple, ruv).rgb * simInside(ruv);
        // the plucked strings' colours tint only the wave crests: a sweep plucks a
        // dozen strings, and their rings laid flat over the pond became a pale mat
        col += glow * crest * 0.35;
        float glint = step(0.986, texture2D(uNoise, xz / 1.7 + uTime * vec2(0.05, -0.03)).b) * uMusic.z;
        col += uSunCol * glint * 0.6;
        float alpha = clamp(0.33 + fres * 1.1 + spec * 0.6, 0.0, 1.0);
        float fog = 1.0 - exp(-uFogDensity * 0.4 * length(vWorld - cameraPosition));
        col = mix(col, uFogCol, fog);
        alpha = mix(alpha, 1.0, fog);
        gl_FragColor = vec4(pow(tonemap(col), vec3(1.0 / 2.2)), alpha);
      }`,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 240, 240), surfaceMat);
  surface.rotation.x = -Math.PI / 2;
  surface.renderOrder = 2;
  group.add(surface);
  // the rest of the pond, beyond the simulated part, flat
  const farMat = surfaceMat.clone();
  farMat.uniforms = surfaceMat.uniforms;
  const far = new THREE.Mesh(new THREE.RingGeometry(SIZE * 0.5 * Math.SQRT2, 160, 4, 1, Math.PI / 4), farMat);
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.002;
  far.renderOrder = 2;
  group.add(far);

  // ---- floating things: lily pads, leaves and petals -----------------------
  // Positions live on the CPU (they are pushed by fingers and kicked by rings);
  // the shaders lift them onto the waves and tilt them with the slope.
  const FLOAT_VERT = `
    attribute vec4 iPose;      // x, z, rotation, size
    attribute vec4 iLook;      // kind-specific
    varying vec2 vLocal; varying vec4 vLook; varying vec3 vWorld;
    ${SIM_GLSL}
    void main() {
      vec2 c = vec2(cos(iPose.z), sin(iPose.z));
      vec2 lp = position.xz * iPose.w;
      vec2 r = vec2(lp.x * c.x - lp.y * c.y, lp.x * c.y + lp.y * c.x);
      vec2 xz = iPose.xy + r;
      // each vertex rides the water right under it, a little above, so the pad
      // bends over a passing wave and the water never laps over it; iLook.w lifts
      // leaves into layers, and onto a pad when they drift over one
      float y = heightAt(xz) + 0.025 + iLook.w + position.y * iPose.w;
      vWorld = vec3(xz.x, y, xz.y);
      vLocal = position.xz; vLook = iLook;
      gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
    }`;

  function floaterGeometry(base, count) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.attributes.position);
    g.setAttribute("iPose", new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iLook", new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = count;
    return g;
  }

  // a pad: a disc with a notch, flat in xz
  // a pad: a disc with a notch, as a polar grid fine enough to bend with the waves.
  // (Quaternius' CC0 lily pad on Poly Pizza is a flat 36-triangle disc: too coarse
  // to ride a wave, and the same shape, so the pad is built here.)
  function padGeometry() {
    const RINGS = 6, SEG = 40, start = 0.2, span = Math.PI * 2 - 0.4;
    const pos = [0, 0, 0], idx = [];
    for (let r = 1; r <= RINGS; r++) {
      const rad = r / RINGS;
      for (let k = 0; k <= SEG; k++) {
        const a = start + span * k / SEG;
        pos.push(Math.cos(a) * rad, 0.03 * rad * rad, Math.sin(a) * rad);   // the rim turns up a touch
      }
    }
    const at = (r, k) => 1 + (r - 1) * (SEG + 1) + k;
    for (let k = 0; k < SEG; k++) idx.push(0, at(1, k + 1), at(1, k));
    for (let r = 1; r < RINGS; r++) for (let k = 0; k < SEG; k++)
      idx.push(at(r, k), at(r, k + 1), at(r + 1, k + 1), at(r, k), at(r + 1, k + 1), at(r + 1, k));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }
  const padBase = padGeometry();
  const PADS = 20;
  const padGeo = floaterGeometry(padBase, PADS);
  const padMat = new THREE.ShaderMaterial({
    uniforms: common, side: THREE.DoubleSide,
    vertexShader: FLOAT_VERT,
    fragmentShader: `
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec2 vLocal; varying vec4 vLook; varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        float r = length(vLocal);
        float ang = atan(vLocal.y, vLocal.x);
        vec3 c = mix(vec3(0.09, 0.20, 0.06), vec3(0.17, 0.33, 0.09), smoothstep(0.0, 0.9, r)) * (0.85 + 0.3 * vLook.x);
        c *= 1.0 - 0.18 * smoothstep(0.75, 0.98, abs(sin(ang * 9.0))) * smoothstep(0.1, 0.4, r);   // veins
        c = mix(c, vec3(0.30, 0.20, 0.06), smoothstep(0.9, 1.0, r) * 0.6);                        // a browned rim
        vec3 lit = c * (uAmbient + uSunCol * (0.6 + 0.4 * max(uSunDir.y, 0.0)));
        lit += uSunCol * 0.08 * (1.0 - r);                                                        // the waxy sheen
        float fog = 1.0 - exp(-uFogDensity * 0.4 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const pads = new THREE.Mesh(padGeo, padMat);
  pads.frustumCulled = false;
  group.add(pads);

  // a lotus flower: two rings of petals cupped upward, on some of the pads
  function lotusGeometry() {
    const pos = [], col = [];
    const ring = (count, tilt, len, width, turn) => {
      for (let i = 0; i < count; i++) {
        const yaw = (i / count) * Math.PI * 2 + turn;
        const pts = [];
        for (let k = 0; k <= 6; k++) {
          const u = k / 6, w = Math.sin(Math.PI * Math.pow(u, 0.8)) * width;
          pts.push([u * len, w], [u * len, -w]);
        }
        const place = (u, v) => {
          const x = u * Math.cos(tilt), y = u * Math.sin(tilt);
          return [x * Math.cos(yaw) - v * Math.sin(yaw), y, x * Math.sin(yaw) + v * Math.cos(yaw)];
        };
        for (let k = 0; k < 6; k++) {
          const a = pts[k * 2], b = pts[k * 2 + 1], c2 = pts[k * 2 + 2], d = pts[k * 2 + 3];
          for (const p of [a, b, c2, b, d, c2]) { pos.push(...place(p[0], p[1])); col.push(p[0] / len); }
        }
      }
    };
    ring(8, 0.55, 0.42, 0.13, 0);
    ring(6, 1.05, 0.34, 0.11, 0.4);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(col, 1));
    return g;
  }
  const lotusBase = lotusGeometry();
  const LOTUS = 6;
  const lotusGeo = new THREE.InstancedBufferGeometry();
  lotusGeo.setAttribute("position", lotusBase.attributes.position);
  lotusGeo.setAttribute("aU", lotusBase.attributes.aU);
  lotusGeo.setAttribute("iPose", new THREE.InstancedBufferAttribute(new Float32Array(LOTUS * 4), 4).setUsage(THREE.DynamicDrawUsage));
  lotusGeo.setAttribute("iLook", new THREE.InstancedBufferAttribute(new Float32Array(LOTUS * 4), 4));
  lotusGeo.instanceCount = LOTUS;
  const lotusMat = new THREE.ShaderMaterial({
    uniforms: common, side: THREE.DoubleSide,
    vertexShader: FLOAT_VERT.replace("varying vec2 vLocal;", "attribute float aU; varying float vU; varying vec2 vLocal;").replace("vLocal = position.xz;", "vLocal = position.xz; vU = aU;").replace("float y = heightAt(xz) + 0.025", "float y = heightAt(iPose.xy) + 0.05"),
    fragmentShader: `
      uniform vec3 uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying float vU; varying vec2 vLocal; varying vec4 vLook; varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        vec3 c = mix(vec3(1.0, 0.96, 0.92), vec3(0.98, 0.52, 0.70), smoothstep(0.35, 1.0, vU));
        vec3 lit = c * (uAmbient + uSunCol * 0.8) + uSunCol * 0.15 * vU;
        float fog = 1.0 - exp(-uFogDensity * 0.4 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const lotus = new THREE.Mesh(lotusGeo, lotusMat);
  lotus.frustumCulled = false;
  group.add(lotus);

  // leaves and petals: a quad each, its shape cut out in the shader
  const bitBase = new THREE.PlaneGeometry(1, 1, 3, 3);
  bitBase.rotateX(-Math.PI / 2);
  const BITS = 150;
  const bitGeo = floaterGeometry(bitBase, BITS);
  const bitMat = new THREE.ShaderMaterial({
    uniforms: common, side: THREE.DoubleSide,
    vertexShader: FLOAT_VERT,
    fragmentShader: `
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec2 vLocal; varying vec4 vLook; varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        float u = vLocal.x + 0.5;               // along the leaf or petal, 0..1
        float v = vLocal.y;
        vec3 c;
        if (vLook.x < 0.5) {
          // a leaf: pointed at both ends, a darker vein down the middle, autumn colours
          float hw = 0.42 * pow(sin(3.14159 * u), 0.9);
          if (abs(v) > hw) discard;
          vec3 a = mix(vec3(0.85, 0.62, 0.10), vec3(0.80, 0.25, 0.06), vLook.y);
          c = mix(a, vec3(0.42, 0.25, 0.08), vLook.z * 0.6);
          c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.03, abs(v)));
        } else {
          // a petal: a rounded teardrop, white into pink
          float hw = 0.38 * pow(sin(3.14159 * pow(u, 0.6)), 1.2);
          if (abs(v) > hw) discard;
          c = mix(vec3(1.0, 0.95, 0.93), vec3(0.97, 0.55, 0.72), u * (0.5 + 0.5 * vLook.y));
        }
        vec3 lit = c * (uAmbient + uSunCol * (0.55 + 0.45 * max(uSunDir.y, 0.0)));
        float fog = 1.0 - exp(-uFogDensity * 0.4 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const bits = new THREE.Mesh(bitGeo, bitMat);
  bits.frustumCulled = false;
  group.add(bits);

  // ---- koi --------------------------------------------------------------------
  // Each fish is a chain of spine joints that follow the head along the path it
  // swims (follow-the-leader), so the whole body curves through a turn as a real
  // spine does. On top of that a swimming wave runs from head to tail, barely at
  // the head and widest at the tail, and the pectoral fins paddle. The mesh is
  // laid out in spine coordinates (s along the body from the snout, 0, to the tail
  // tip, 1; side; up) and placed on the CPU every frame: a few thousand vertices.
  const KOI = 5, JOINTS = 12;
  const KOI_LOOKS = ["kohaku", "kohaku", "showa", "ogon", "tancho"];

  // half-width of the body at s (0 snout .. 0.8 tail root), as a koi: a blunt
  // rounded head, a long deep body, a slim tail root
  function koiWidth(sx) {
    const t = clamp(sx / 0.8, 0, 1);
    return 0.115 * Math.pow(Math.sin(Math.PI * 0.5 * Math.min(t / 0.24, 1)), 0.55) * (1 - 0.82 * smooth(0.42, 1.0, t));
  }

  function koiRest() {
    const S = [], SIDE = [], UP = [], FLAP = [], PART = [], idx = [];
    const vert = (sv, side, up, flap, part) => { S.push(sv); SIDE.push(side); UP.push(up); FLAP.push(flap); PART.push(part); return S.length - 1; };
    // the body: rings round the spine
    const RINGS = 30, AROUND = 16;
    const tip = vert(0, 0, 0.01, 0, 0);
    let prev = null;
    for (let r = 1; r <= RINGS; r++) {
      const sv = 0.8 * r / RINGS, w = koiWidth(sv), h = w * 1.2;
      const ring = [];
      for (let k = 0; k < AROUND; k++) {
        const a = (k / AROUND) * Math.PI * 2;
        const up = Math.sin(a) * h * (Math.sin(a) < 0 ? 0.82 : 1.0);
        ring.push(vert(sv, Math.cos(a) * w, up, 0, 0));
      }
      for (let k = 0; k < AROUND; k++) {
        const k2 = (k + 1) % AROUND;
        if (!prev) idx.push(tip, ring[k2], ring[k]);
        else idx.push(prev[k], prev[k2], ring[k2], prev[k], ring[k2], ring[k]);
      }
      prev = ring;
    }
    // the tail fin: a forked fan spreading sideways, thin and flexible
    const K = 8, U = 6, fan = [];
    for (let k = 0; k <= K; k++) {
      const row = [];
      for (let u = -U; u <= U; u++) {
        const uu = u / U, kk = k / K;
        const sv = 0.78 + 0.22 * kk * (1 - 0.42 * (1 - Math.abs(uu)));     // the middle is shorter: the fork
        const half = 0.018 + 0.15 * Math.pow(kk, 0.8);
        row.push(vert(sv, uu * half, 0.004, 0, 1));
      }
      if (fan.length) {
        const a = fan[fan.length - 1];
        for (let u = 0; u < row.length - 1; u++) idx.push(a[u], a[u + 1], row[u + 1], a[u], row[u + 1], row[u]);
      }
      fan.push(row);
    }
    // the pectoral fins: out to each side behind the head, paddling
    for (const side of [1, -1]) {
      // a small rounded paddle: a fan from the root out to a soft edge
      const w = koiWidth(0.24) * 0.85;
      const root = vert(0.235, side * w, -0.03, 0, 1);
      const edge = [];
      for (let k = 0; k <= 6; k++) {
        const a = -0.5 + (k / 6) * 1.6;                       // from forward-out round to back
        edge.push(vert(0.235 + 0.075 * Math.sin(a) + 0.03, side * (w + 0.075 * Math.cos(a) + 0.01), -0.04, 1, 1));
      }
      for (let k = 0; k < 6; k++) idx.push(root, edge[k], edge[k + 1]);
    }
    // the dorsal fin: a low ridge along the back
    for (let k = 0; k < 8; k++) {
      const s0 = 0.28 + 0.34 * k / 8, s1 = 0.28 + 0.34 * (k + 1) / 8;
      const h0 = koiWidth(s0) * 1.2, h1 = koiWidth(s1) * 1.2;
      const bell = (sv) => 0.05 * Math.sin(Math.PI * (sv - 0.28) / 0.34);
      const a = vert(s0, 0, h0, 0, 2), b = vert(s1, 0, h1, 0, 2);
      const c = vert(s1, 0, h1 + bell(s1), 0, 2), d = vert(s0, 0, h0 + bell(s0), 0, 2);
      idx.push(a, b, c, a, c, d);
    }
    return { S, SIDE, UP, FLAP, PART, idx, count: S.length };
  }
  const REST = koiRest();

  // the coat: a koi's pattern from its variety, laid on the rest pose
  function koiColours(look, seed) {
    const col = new Float32Array(REST.count * 3);
    const white = [1.0, 0.97, 0.92], red = [0.95, 0.20, 0.03], gold = [1.0, 0.60, 0.10], black = [0.05, 0.04, 0.04];
    const noise = (x, y) => {
      const v = (a, b) => { const h = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453; return h - Math.floor(h); };
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
      return lerp(lerp(v(xi, yi), v(xi + 1, yi), u), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), u), w);
    };
    for (let i = 0; i < REST.count; i++) {
      const sv = REST.S[i], side = REST.SIDE[i], up = REST.UP[i], part = REST.PART[i];
      const n = noise(sv * 7, side * 9 + up * 4) * 0.7 + noise(sv * 15, side * 20) * 0.3;
      let c = white;
      if (look === "ogon") c = mix3(gold, [1.0, 0.78, 0.35], n);
      else if (look === "tancho") c = (sv > 0.05 && sv < 0.17 && up > 0) ? red : white;
      else {
        c = n > 0.45 ? red : white;
        if (look === "showa" && noise(sv * 11 + 5, side * 13) > 0.6) c = black;
      }
      if (part > 0) c = mix3(c, [1.0, 0.95, 0.88], part === 1 ? 0.55 : 0.3);   // fins are paler, nearly clear
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    return col;
  }
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  const koiMat = new THREE.ShaderMaterial({
    uniforms: common, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 color;
      varying vec3 vColor; varying vec3 vN; varying vec3 vWorld;
      void main() {
        vColor = color; vN = normal; vWorld = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vColor; varying vec3 vN; varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float lam = max(dot(n, uSunDir), 0.0) * 0.6 + 0.4;
        vec3 lit = vColor * (uAmbient * 1.3 + uSunCol * lam * 1.6);
        float fog = 1.0 - exp(-uFogDensity * 0.4 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const koiMeshes = [];
  for (let i = 0; i < KOI; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(REST.count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(koiColours(KOI_LOOKS[i % KOI_LOOKS.length], i * 3.7 + 1), 3));
    g.setIndex(REST.idx);
    const m = new THREE.Mesh(g, koiMat);
    m.frustumCulled = false;
    group.add(m);
    koiMeshes.push(m);
  }

  // ---- the CPU side: where the floaters and fish are ---------------------------
  const rand = (() => { let s = 2024; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const view = { minX: -5, maxX: 5, minZ: -8, maxZ: 6 };   // what the camera sees now (the koi stay in it)
  const area = { minX: -8, maxX: 8, minZ: -12, maxZ: 6 };  // what any view sees (the floaters spread over it)
  const floaters = [];
  function makeFloater(kind) {
    const pad = kind === "pad";
    return {
      kind, x: lerp(area.minX, area.maxX, rand()), z: lerp(area.minZ, area.maxZ, rand()),
      vx: 0, vz: 0, rot: rand() * Math.PI * 2, spin: 0,
      size: pad ? 0.38 + rand() * 0.28 : 0.3 + rand() * 0.16,
      look: pad ? [rand(), 0, 0, 0] : [rand() < 0.55 ? 0 : 1, rand(), rand(), 0],
    };
  }
  for (let i = 0; i < PADS; i++) floaters.push(makeFloater("pad"));
  for (let i = 0; i < BITS; i++) floaters.push(makeFloater("bit"));
  const padIndex = floaters.filter((f) => f.kind === "pad");
  const bitIndex = floaters.filter((f) => f.kind === "bit");
  const flowerPads = [0, 3, 6, 9, 12, 15];
  padIndex.forEach((p, i) => { padGeo.attributes.iLook.setXYZW(i, ...p.look); });
  bitIndex.forEach((b, i) => { bitGeo.attributes.iLook.setXYZW(i, ...b.look); });
  padGeo.attributes.iLook.needsUpdate = true; bitGeo.attributes.iLook.needsUpdate = true;

  const fish = Array.from({ length: KOI }, (_, i) => {
    const f = {
      x: lerp(view.minX, view.maxX, rand()), z: lerp(view.minZ, view.maxZ, rand()),
      a: rand() * Math.PI * 2, speed: 0.35, turn: 0, phase: rand() * 6, flee: 0, fx: 0, fz: 0,
      length: 0.95 + rand() * 0.4, joints: [],
    };
    for (let j = 0; j < JOINTS; j++) {
      const back = (j / (JOINTS - 1)) * f.length;
      f.joints.push([f.x - Math.cos(f.a) * back, f.z - Math.sin(f.a) * back]);
    }
    return f;
  });

  // the part of the pond the camera sees, where floaters and fish are kept
  function updateView() {
    const pts = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const d = new THREE.Vector3(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      const t = d.y < -0.05 ? -camera.position.y / d.y : 30;
      const p = camera.position.clone().addScaledVector(d, Math.min(t, 30));
      pts.push(p);
    }
    view.minX = clamp(Math.min(...pts.map((p) => p.x)), -14, 0) + 0.6;
    view.maxX = clamp(Math.max(...pts.map((p) => p.x)), 0, 14) - 0.6;
    view.minZ = clamp(Math.min(...pts.map((p) => p.z)), -14, 0) + 0.6;
    view.maxZ = clamp(Math.max(...pts.map((p) => p.z)), 0, 14) - 0.6;
  }

  function updateArea() {
    // before layout the window can be 0 wide: an aspect of 0 makes every corner NaN
    let aspect = window.innerWidth / Math.max(1, window.innerHeight);
    if (!(aspect > 0.2)) aspect = 0.6;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const v of VIEWS) {
      const cam = new THREE.PerspectiveCamera(v.fov, aspect, 0.1, 100);
      cam.position.set(...v.pos); cam.lookAt(...v.look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const d = new THREE.Vector3(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
        const t = d.y < -0.05 ? -cam.position.y / d.y : 30;
        const q = cam.position.clone().addScaledVector(d, Math.min(t, 30));
        minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
      }
    }
    area.minX = clamp(minX, -16, 0) + 0.5; area.maxX = clamp(maxX, 0, 16) - 0.5;
    area.minZ = clamp(minZ, -16, 0) + 0.5; area.maxZ = clamp(maxZ, 0, 16) - 0.5;
    for (const f of floaters) if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) {
      f.x = lerp(area.minX, area.maxX, rand()); f.z = lerp(area.minZ, area.maxZ, rand()); f.vx = f.vz = 0;
    }
  }
  updateArea();
  for (const f of floaters) { f.x = lerp(area.minX, area.maxX, rand()); f.z = lerp(area.minZ, area.maxZ, rand()); }

  const kicks = [];         // rings from taps and plucks, pushing floaters and scaring fish
  function stepFloaters(dt, touches, time) {
    for (const f of floaters) {
      const pad = f.kind === "pad";
      const reach = pad ? f.size + 0.55 : 0.6;
      for (const t of touches) {
        const dx = f.x - t.x, dz = f.z - t.z, d = Math.hypot(dx, dz);
        if (d < reach && d > 1e-4) {
          const push = (reach - d) / reach;
          f.vx += (dx / d) * push * 5 * dt + t.dx * push * 3 * dt;
          f.vz += (dz / d) * push * 5 * dt + t.dz * push * 3 * dt;
          f.spin += (dx * t.dz - dz * t.dx) * push * 2 * dt;
        }
      }
      for (const k of kicks) {
        const dx = f.x - k.x, dz = f.z - k.z, d = Math.hypot(dx, dz);
        if (d < 2.5 && d > 1e-4) { const s = k.amount * (1 - d / 2.5) / (pad ? 2.5 : 1); f.vx += (dx / d) * s; f.vz += (dz / d) * s; }
      }
      // a slow drift, as if the pond breathed
      f.vx += Math.sin(f.z * 0.25 + time * 0.07) * 0.012 * dt;
      f.vz += Math.cos(f.x * 0.21 + time * 0.05) * 0.012 * dt;
      // back toward the part of the pond the views see
      if (f.x < area.minX) f.vx += (area.minX - f.x) * 0.6 * dt;
      if (f.x > area.maxX) f.vx -= (f.x - area.maxX) * 0.6 * dt;
      if (f.z < area.minZ) f.vz += (area.minZ - f.z) * 0.6 * dt;
      if (f.z > area.maxZ) f.vz -= (f.z - area.maxZ) * 0.6 * dt;
      const damp = Math.exp(-dt * (pad ? 0.9 : 1.3));
      f.vx *= damp; f.vz *= damp; f.spin *= Math.exp(-dt * 1.5);
      f.x += f.vx * dt; f.z += f.vz * dt; f.rot += f.spin * dt;
    }
    // pads do not overlap
    for (let i = 0; i < padIndex.length; i++) for (let j = i + 1; j < padIndex.length; j++) {
      const a = padIndex[i], b = padIndex[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.size + b.size;
      if (d < min && d > 1e-4) {
        const p = (min - d) * 0.5, nx = dx / d, nz = dz / d;
        a.x -= nx * p; a.z -= nz * p; b.x += nx * p; b.z += nz * p;
      }
    }
    // leaves and petals nudge each other apart, and each lies at its own height
    // so two that do touch never flicker through each other
    for (let i = 0; i < bitIndex.length; i++) {
      const a = bitIndex[i];
      for (let j = i + 1; j < bitIndex.length; j++) {
        const b = bitIndex[j], dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, min = (a.size + b.size) * 0.4;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2), push = (min - d) * 0.25, nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        }
      }
      let onPad = 0;
      for (const pad of padIndex) if (Math.hypot(a.x - pad.x, a.z - pad.z) < pad.size * 0.95) onPad = 1;
      a.lift = lerp(a.lift || 0, 0.006 + 0.005 * (i % 7) + onPad * 0.035, 0.2);
      bitGeo.attributes.iLook.setW(i, a.lift);
    }
    bitGeo.attributes.iLook.needsUpdate = true;
    const pp = padGeo.attributes.iPose, bp = bitGeo.attributes.iPose, lp = lotusGeo.attributes.iPose;
    padIndex.forEach((f, i) => pp.setXYZW(i, f.x, f.z, f.rot, f.size));
    bitIndex.forEach((f, i) => bp.setXYZW(i, f.x, f.z, f.rot, f.size));
    flowerPads.forEach((pi, i) => { const f = padIndex[pi]; lp.setXYZW(i, f.x + 0.05, f.z - 0.04, f.rot, 0.55 + f.size * 0.5); lotusGeo.attributes.iLook.setW(i, 0.01); });
    lotusGeo.attributes.iLook.needsUpdate = true;
    pp.needsUpdate = true; bp.needsUpdate = true; lp.needsUpdate = true;
  }

  function stepFish(dt, touches, time) {
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      // wander
      f.turn += (Math.sin(time * 0.37 + i * 2.1) * 0.6 + (rand() - 0.5) * 0.8) * dt;
      f.turn *= Math.exp(-dt * 1.2);
      let want = f.a + f.turn;
      let speed = 0.32;
      // curious: a finger resting on the water draws them in, slowly
      for (const t of touches) {
        const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz);
        if (t.depth > 0.5 && d < 4.5 && d > 0.7) { want = steer(f.a, Math.atan2(dz, dx), 0.5 * dt * 3); speed = 0.25; }
      }
      // a ring nearby: flee
      for (const k of kicks) {
        const dx = f.x - k.x, dz = f.z - k.z, d = Math.hypot(dx, dz);
        if (d < 2.8) { f.flee = 1; f.fx = dx; f.fz = dz; }
      }
      if (f.flee > 0.02) { want = steer(f.a, Math.atan2(f.fz, f.fx), 6 * dt); speed = 0.32 + 1.6 * f.flee; f.flee *= Math.exp(-dt * 1.4); }
      // stay in view
      const cx = (view.minX + view.maxX) / 2, cz = (view.minZ + view.maxZ) / 2;
      if (f.x < view.minX + 0.5 || f.x > view.maxX - 0.5 || f.z < view.minZ + 0.5 || f.z > view.maxZ - 0.5)
        want = steer(want, Math.atan2(cz - f.z, cx - f.x), 1.5 * dt);
      // keep apart
      for (let j = 0; j < fish.length; j++) if (j !== i) {
        const o = fish[j], dx = f.x - o.x, dz = f.z - o.z, d = Math.hypot(dx, dz);
        if (d < 0.8 && d > 1e-4) want = steer(want, Math.atan2(dz, dx), 0.8 * dt);
      }
      // a koi turns no tighter than about half its length: cap the turn rate by speed
      const maxTurn = (0.5 + f.speed * 1.4) * dt;
      let dA = steer(f.a, want, Math.min(1, dt * 2.5)) - f.a;
      f.a += clamp(dA, -maxTurn, maxTurn);
      f.speed = lerp(f.speed, speed, 1 - Math.exp(-dt * 2));
      f.x += Math.cos(f.a) * f.speed * dt;
      f.z += Math.sin(f.a) * f.speed * dt;
      f.phase += dt * (3.0 + f.speed * 8);
      followSpine(f);
      placeKoi(koiMeshes[i], f, time);
    }
  }

  // follow-the-leader: each joint keeps its distance from the one ahead of it,
  // along the line between them, so the body lies on the path the head took
  function followSpine(f) {
    const seg = f.length / (JOINTS - 1), J = f.joints;
    J[0][0] = f.x; J[0][1] = f.z;
    for (let j = 1; j < JOINTS; j++) {
      const dx = J[j][0] - J[j - 1][0], dz = J[j][1] - J[j - 1][1], d = Math.hypot(dx, dz) || 1e-6;
      J[j][0] = J[j - 1][0] + (dx / d) * seg;
      J[j][1] = J[j - 1][1] + (dz / d) * seg;
    }
  }

  // the rest pose laid onto the spine, with the swimming wave and paddling fins
  const spineP = new Float32Array(2), spineT = new Float32Array(2);
  function spineAt(f, sv) {
    const J = f.joints, x = clamp(sv, 0, 1) * (JOINTS - 1);
    const i = Math.min(Math.floor(x), JOINTS - 2), t = x - i;
    spineP[0] = lerp(J[i][0], J[i + 1][0], t); spineP[1] = lerp(J[i][1], J[i + 1][1], t);
    // the direction toward the head, eased between neighbouring segments
    const tan = (k) => { const a = J[Math.max(k, 0)], b = J[Math.min(k + 1, JOINTS - 1)]; const dx = a[0] - b[0], dz = a[1] - b[1], d = Math.hypot(dx, dz) || 1e-6; return [dx / d, dz / d]; };
    const t0 = tan(i - (t < 0.5 ? 1 : 0)), t1 = tan(i + (t < 0.5 ? 0 : 1));
    const w = t < 0.5 ? t + 0.5 : t - 0.5;
    let tx = lerp(t0[0], t1[0], w), tz = lerp(t0[1], t1[1], w);
    const d = Math.hypot(tx, tz) || 1e-6;
    spineT[0] = tx / d; spineT[1] = tz / d;
  }
  function placeKoi(mesh, f, time) {
    const pos = mesh.geometry.attributes.position.array;
    const swim = 0.04 + 0.09 * clamp(f.speed / 1.2, 0, 1);
    const scale = f.length / 0.95;
    for (let v = 0; v < REST.count; v++) {
      const sv = REST.S[v];
      spineAt(f, sv);
      const nx = -spineT[1], nz = spineT[0];                       // to the fish's left
      // the swimming wave: one wavelength along the body, growing toward the tail
      let side = REST.SIDE[v] * scale + swim * (0.12 + 0.88 * sv * sv) * Math.sin(f.phase - sv * 6.3);
      if (REST.FLAP[v] > 0) side += Math.sign(REST.SIDE[v]) * 0.03 * Math.sin(f.phase * 0.6 + 1.0);
      pos[v * 3] = spineP[0] + nx * side;
      pos[v * 3 + 1] = KOI_DEPTH + REST.UP[v] * scale;
      pos[v * 3 + 2] = spineP[1] + nz * side;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
  // turn heading a toward target by a share of the way, the short way round
  function steer(a, target, amount) {
    let d = target - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * clamp(amount, 0, 1);
  }

  // ---- the frame ----------------------------------------------------------------
  let substepCarry = 0;
  function update(dt, touches, time) {
    common.uTime.value = time;
    common.uMusic.value.copy(music);
    updateView();
    if (simOK) {
      // the waves run at a fixed 120 steps a second whatever the frame rate
      substepCarry += dt * 120;
      const steps = Math.min(4, Math.floor(substepCarry));
      substepCarry -= steps;
      for (let s = 0; s < steps; s++) {
        let n = 0;
        if (s === 0) for (const q of queued) { if (n < MAX_IMP) impulses[n++].set(...q); }
        // a moving finger pushes the water ahead of it: the wake
        for (const t of touches) {
          if (n >= MAX_IMP) break;
          const sp = Math.min(t.speed, 6);
          if (sp > 0.05) impulses[n++].set(t.x, t.z, 0.3 * (1 + t.depth * 0.5), -0.0005 * sp * (1 + t.depth));
        }
        simMat.uniforms.uCount.value = n;
        simMat.uniforms.uPrev.value = simA.texture;
        passQuad.material = simMat;
        renderer.setRenderTarget(simB);
        renderer.render(passScene, passCam);
        simMat.uniforms.uInit.value = 0;
        [simA, simB] = [simB, simA];
      }
      renderer.setRenderTarget(null);
      simUniforms.uSim.value = simA.texture;
    }
    queued.length = 0;
    stepFloaters(dt, touches, time);
    stepFish(dt, touches, time);
    kicks.length = 0;
  }

  return {
    id: "water", name: "Vatten", group,
    sound: { voice: 2, ring: 6, wet: 0.48 },
    touchHeight: 0.0, glowHeight: 0.06,
    resize() { updateView(); updateArea(); },
    update,
    tune() {},
    enter() { if (simOK) simMat.uniforms.uInit.value = 1; updateView(); },
    exit() {},
    tap(f) {
      impulse(f.world.x, f.world.z, 0.42, -0.22);
      kicks.push({ x: f.world.x, z: f.world.z, amount: 1.6 });
      burst(f.world, [0.75, 0.9, 1.0], 0.5, "splash");
    },
    pluck(f, col, vel) {
      impulse(f.world.x, f.world.z, 0.28, -0.025 * vel);
      kicks.push({ x: f.world.x, z: f.world.z, amount: 0.25 });
    },
    stats() { return { waves: simOK }; },
  };
})();
