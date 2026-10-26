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
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 180, 180), surfaceMat);
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
      vec2 sl = slopeAt(iPose.xy);
      float y = heightAt(iPose.xy) + dot(sl, r) + 0.012 + position.y * iPose.w;
      vWorld = vec3(xz.x, y, xz.y);
      vLocal = position.xz; vLook = iLook;
      gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
    }`;

  function floaterGeometry(base, count) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute("position", base.attributes.position);
    g.setAttribute("iPose", new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("iLook", new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
    g.instanceCount = count;
    return g;
  }

  // a pad: a disc with a notch, flat in xz
  const padBase = new THREE.CircleGeometry(1, 32, 0.2, Math.PI * 2 - 0.4);
  padBase.rotateX(-Math.PI / 2);
  const PADS = 9;
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
  const LOTUS = 3;
  const lotusGeo = new THREE.InstancedBufferGeometry();
  lotusGeo.setAttribute("position", lotusBase.attributes.position);
  lotusGeo.setAttribute("aU", lotusBase.attributes.aU);
  lotusGeo.setAttribute("iPose", new THREE.InstancedBufferAttribute(new Float32Array(LOTUS * 4), 4).setUsage(THREE.DynamicDrawUsage));
  lotusGeo.setAttribute("iLook", new THREE.InstancedBufferAttribute(new Float32Array(LOTUS * 4), 4));
  lotusGeo.instanceCount = LOTUS;
  const lotusMat = new THREE.ShaderMaterial({
    uniforms: common, side: THREE.DoubleSide,
    vertexShader: FLOAT_VERT.replace("varying vec2 vLocal;", "attribute float aU; varying float vU; varying vec2 vLocal;").replace("vLocal = position.xz;", "vLocal = position.xz; vU = aU;"),
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
  const bitBase = new THREE.PlaneGeometry(1, 1);
  bitBase.rotateX(-Math.PI / 2);
  const BITS = 70;
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
  function koiGeometry() {
    const body = new THREE.SphereGeometry(1, 18, 10);
    body.scale(0.5, 0.11, 0.15);
    const b = body.toNonIndexed();
    const pos = Array.from(b.attributes.position.array);
    const nrm = Array.from(b.attributes.normal.array);
    // tail fin and two side fins, thin and flat
    const tri = (pts) => { for (const p of pts) { pos.push(...p); nrm.push(0, 1, 0); } };
    tri([[-0.42, 0, 0], [-0.78, 0, 0.2], [-0.70, 0, 0], [-0.42, 0, 0], [-0.70, 0, 0], [-0.78, 0, -0.2]]);
    tri([[0.18, -0.02, 0.1], [0.02, -0.03, 0.3], [0.05, -0.02, 0.1]]);
    tri([[0.18, -0.02, -0.1], [0.05, -0.02, -0.1], [0.02, -0.03, -0.3]]);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    return g;
  }
  const KOI = 5;
  const koiGeo = koiGeometry();
  koiGeo.setAttribute("iFish", new THREE.InstancedBufferAttribute(new Float32Array(KOI * 4), 4).setUsage(THREE.DynamicDrawUsage)); // x, z, heading, swim phase
  koiGeo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(new Float32Array(KOI * 2), 2));                               // pattern, size
  koiGeo.instanceCount = KOI;
  const koiMat = new THREE.ShaderMaterial({
    uniforms: common, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 iFish; attribute vec2 iSeed;
      varying vec3 vLocal; varying vec2 vSeed; varying vec3 vN; varying vec3 vWorld;
      void main() {
        vec3 p = position;
        // the body bends in a wave that grows toward the tail
        float bend = sin(iFish.w - p.x * 5.5) * 0.11 * pow(max(0.6 - p.x, 0.0), 1.6);
        p.z += bend;
        p *= iSeed.y;
        float c = cos(iFish.z), s = sin(iFish.z);
        vec3 w = vec3(iFish.x + p.x * c - p.z * s, ${KOI_DEPTH.toFixed(2)} + p.y, iFish.y + p.x * s + p.z * c);
        vWorld = w; vLocal = position; vSeed = iSeed;
        vN = normalize(vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c));
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vLocal; varying vec2 vSeed; varying vec3 vN; varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        float spots = texture2D(uNoise, vLocal.xz * vec2(0.55, 0.9) + vSeed.x * 7.0).r;
        vec3 white = vec3(1.0, 0.97, 0.92), orange = vec3(1.0, 0.33, 0.03), black = vec3(0.05, 0.04, 0.04);
        vec3 c = vSeed.x > 0.75 ? mix(orange, vec3(1.0, 0.62, 0.20), spots) : mix(white, orange, smoothstep(0.40, 0.46, spots));
        if (vSeed.x > 0.4 && vSeed.x < 0.6) c = mix(c, black, smoothstep(0.66, 0.70, texture2D(uNoise, vLocal.xz * 3.0 + 2.0).g));
        float lam = max(dot(normalize(vN), uSunDir), 0.0) * 0.6 + 0.4;
        vec3 lit = c * (uAmbient * 1.3 + uSunCol * lam * 1.6);
        float fog = 1.0 - exp(-uFogDensity * 0.4 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const koi = new THREE.Mesh(koiGeo, koiMat);
  koi.frustumCulled = false;
  group.add(koi);

  // ---- the CPU side: where the floaters and fish are ---------------------------
  const rand = (() => { let s = 2024; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const view = { minX: -5, maxX: 5, minZ: -8, maxZ: 6 };
  const floaters = [];
  function makeFloater(kind) {
    const pad = kind === "pad";
    return {
      kind, x: lerp(view.minX, view.maxX, rand()), z: lerp(view.minZ, view.maxZ, rand()),
      vx: 0, vz: 0, rot: rand() * Math.PI * 2, spin: 0,
      size: pad ? 0.38 + rand() * 0.28 : 0.3 + rand() * 0.16,
      look: pad ? [rand(), 0, 0, 0] : [rand() < 0.55 ? 0 : 1, rand(), rand(), 0],
    };
  }
  for (let i = 0; i < PADS; i++) floaters.push(makeFloater("pad"));
  for (let i = 0; i < BITS; i++) floaters.push(makeFloater("bit"));
  const padIndex = floaters.filter((f) => f.kind === "pad");
  const bitIndex = floaters.filter((f) => f.kind === "bit");
  const flowerPads = [0, 3, 6];
  padIndex.forEach((p, i) => { padGeo.attributes.iLook.setXYZW(i, ...p.look); });
  bitIndex.forEach((b, i) => { bitGeo.attributes.iLook.setXYZW(i, ...b.look); });
  padGeo.attributes.iLook.needsUpdate = true; bitGeo.attributes.iLook.needsUpdate = true;

  const fish = Array.from({ length: KOI }, (_, i) => ({
    x: lerp(view.minX, view.maxX, rand()), z: lerp(view.minZ, view.maxZ, rand()),
    a: rand() * Math.PI * 2, speed: 0.35, turn: 0, phase: rand() * 6, flee: 0, fx: 0, fz: 0,
  }));
  const KOI_LOOKS = [0.12, 0.30, 0.52, 0.82, 0.92];      // white and orange, white and orange, with black, orange, orange
  fish.forEach((f, i) => koiGeo.attributes.iSeed.setXY(i, KOI_LOOKS[i % KOI_LOOKS.length], 0.95 + rand() * 0.4));
  koiGeo.attributes.iSeed.needsUpdate = true;

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
      // back toward the part of the pond in view
      if (f.x < view.minX) f.vx += (view.minX - f.x) * 0.6 * dt;
      if (f.x > view.maxX) f.vx -= (f.x - view.maxX) * 0.6 * dt;
      if (f.z < view.minZ) f.vz += (view.minZ - f.z) * 0.6 * dt;
      if (f.z > view.maxZ) f.vz -= (f.z - view.maxZ) * 0.6 * dt;
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
    const pp = padGeo.attributes.iPose, bp = bitGeo.attributes.iPose, lp = lotusGeo.attributes.iPose;
    padIndex.forEach((f, i) => pp.setXYZW(i, f.x, f.z, f.rot, f.size));
    bitIndex.forEach((f, i) => bp.setXYZW(i, f.x, f.z, f.rot, f.size));
    flowerPads.forEach((pi, i) => { const f = padIndex[pi]; lp.setXYZW(i, f.x + 0.05, f.z - 0.04, f.rot, 0.55 + f.size * 0.5); });
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
      f.a = steer(f.a, want, Math.min(1, dt * 2.5));
      f.speed = lerp(f.speed, speed, 1 - Math.exp(-dt * 2));
      f.x += Math.cos(f.a) * f.speed * dt;
      f.z += Math.sin(f.a) * f.speed * dt;
      f.phase += dt * (3.5 + f.speed * 9);
      koiGeo.attributes.iFish.setXYZW(i, f.x, f.z, f.a, f.phase);
    }
    koiGeo.attributes.iFish.needsUpdate = true;
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
    resize() { updateView(); },
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
