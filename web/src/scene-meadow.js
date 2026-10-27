// ---- scene: the meadow ---------------------------------------------------------
// A summer meadow: long grass and wildflowers that part round each finger and
// close behind it, butterflies that start up where a finger runs through, rings
// of light from every pluck, pollen, and blades that sway and glint with the music.
const meadowScene = (() => {
  const group = new THREE.Group();

  // Where the grass has been touched. Never cleared: each frame every texel is
  // pulled back toward rest (at least one 8-bit step, so it cannot stall where
  // half floats are missing), then the fingers are stamped on top. So the
  // blades part round a finger and the wake behind it closes over seconds.
  let bendA = target(384), bendB = target(384);
  const bendMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: {
      uPrev: { value: null }, uDecay: { value: 0.02 }, uCount: { value: 0 },
      uTouch: { value: Array.from({ length: MAX_TOUCH }, () => new THREE.Vector4()) },
      uDrag: { value: Array.from({ length: MAX_TOUCH }, () => new THREE.Vector4()) },
      uRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
      uInit: { value: 1 },
    },
    fragmentShader: `
      uniform sampler2D uPrev; uniform float uDecay; uniform int uCount; uniform float uInit;
      uniform vec4 uTouch[${MAX_TOUCH}]; uniform vec4 uDrag[${MAX_TOUCH}]; uniform vec3 uRect;
      varying vec2 vUv;
      void main() {
        vec3 rest = vec3(0.5, 0.5, 0.0);
        vec3 c = mix(texture2D(uPrev, vUv).rgb, rest, uInit);
        vec3 d = c - rest;
        vec3 back = d * uDecay;
        vec3 minStep = sign(d) * min(abs(d), vec3(1.2 / 255.0));
        c -= mix(minStep, back, step(abs(minStep), abs(back)));
        vec2 w = uRect.xy + vUv * uRect.z;
        for (int i = 0; i < ${MAX_TOUCH}; i++) {
          if (i >= uCount) break;
          vec2 o = w - uTouch[i].xy;
          float dist = length(o);
          float r = dist / uTouch[i].z;
          float fall = 1.0 - smoothstep(0.0, 1.0, r);
          if (fall <= 0.0) continue;
          vec2 radial = dist > 1e-3 ? o / dist : vec2(0.0);
          vec2 push = clamp(radial * smoothstep(0.0, 0.4, r) * 0.75 + uDrag[i].xy * 0.7, -1.0, 1.0);
          vec3 stamp = vec3(0.5 + 0.5 * push, uTouch[i].w * fall);
          c = mix(c, stamp, fall * uDrag[i].z);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });

  const COMMON_GLSL = `
    uniform sampler2D uNoise;
    float dryAt(vec2 xz) { return smoothstep(0.5, 0.75, texture2D(uNoise, xz / 64.0).r) * 0.55; }
    float lushAt(vec2 xz) { return texture2D(uNoise, xz / 64.0 + vec2(0.37, 0.11)).g; }
    vec3 grassLow(vec2 xz) { return mix(vec3(0.018, 0.05, 0.010), vec3(0.11, 0.09, 0.03), dryAt(xz)); }
    vec3 grassHigh(vec2 xz) {
      vec3 green = mix(vec3(0.20, 0.40, 0.04), vec3(0.38, 0.56, 0.06), lushAt(xz));
      return mix(green, vec3(0.64, 0.54, 0.18), dryAt(xz));
    }
    vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  `;

  const grassUniforms = Object.assign({
    uNoise: { value: noiseTex },
    uBend: { value: bendA.texture },
    uRipple: { value: rippleRT.texture },
    uRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
    uSpacing: { value: 0.08 }, uWidthScale: { value: 1 }, uFieldMin: { value: new THREE.Vector2() },
    uTime: { value: 0 }, uWindDir: { value: new THREE.Vector2(0.8, -0.6).normalize() },
    uWind: { value: 0.45 }, uGustSpeed: { value: 5.0 },
    uMusic: { value: new THREE.Vector3() },
  }, lightUniforms);

  const grassMat = new THREE.ShaderMaterial({
    uniforms: grassUniforms,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec2 aCell;
      uniform sampler2D uBend; uniform sampler2D uRipple; uniform vec3 uRect;
      uniform float uSpacing, uWidthScale, uTime, uWind, uGustSpeed;
      uniform vec2 uFieldMin, uWindDir; uniform vec3 uMusic;
      varying float vT; varying float vGust; varying vec3 vLow; varying vec3 vHigh;
      varying vec3 vGlow; varying vec3 vN; varying vec3 vWorld; varying float vSparkle;
      ${COMMON_GLSL}
      vec4 hash42(vec2 p) {
        vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
        p4 += dot(p4, p4.wzxy + 33.33);
        return fract((p4.xxyz + p4.yzzw) * p4.zywx);
      }
      void main() {
        vec4 h = hash42(aCell + 17.0);
        vec4 h2 = hash42(aCell * 1.618 + 3.0);
        vec2 root = uFieldMin + (aCell + h.xy) * uSpacing;
        float lush = lushAt(root);
        float L = mix(0.42, 1.0, lush) * (0.7 + 0.6 * h.z);
        float yaw = h.w * 6.2831853;
        vec2 face = vec2(cos(yaw), sin(yaw));
        float yaw2 = h2.x * 6.2831853;
        vec2 droop = vec2(cos(yaw2), sin(yaw2)) * mix(0.12, 0.6, h.z * h.z);

        vec2 wd = uWindDir, wp = vec2(-wd.y, wd.x);
        vec2 q = root - wd * uTime * uGustSpeed;
        float n = texture2D(uNoise, q / 100.0).a * 0.65 + texture2D(uNoise, q / 32.0 + vec2(0.3, 0.7)).a * 0.35;
        float g = clamp(smoothstep(0.45, 0.78, n) + uMusic.x * 0.5, 0.0, 1.0);
        float ph = h2.y * 6.2831853;
        float flutter = sin(uTime * (2.2 + h.z * 1.6) + ph + dot(root, wd) * 1.3);
        float flutter2 = sin(uTime * (3.1 + h.z) + ph * 1.7);
        vec2 v = droop + wd * uWind * (0.25 + 1.25 * g) + wd * flutter * 0.07 * (0.4 + g) + wp * flutter2 * 0.05;

        vec2 buv = (root - uRect.xy) / uRect.z;
        float inside = step(0.0, buv.x) * step(buv.x, 1.0) * step(0.0, buv.y) * step(buv.y, 1.0);
        vec4 b = texture2D(uBend, buv);
        vec2 push = (b.rg - 0.5) * 2.0 * inside;
        float press = clamp(b.b, 0.0, 1.0) * inside;
        vec4 rp = texture2D(uRipple, buv) * inside;
        v = v * (1.0 - 0.6 * min(length(push), 1.0)) + push * 1.5;
        float vl = max(length(v), 1e-4);
        float a = min(vl + press * 0.9 + rp.a * 0.7, 1.5);
        vec2 dir = v / vl;

        float t = position.y, s = position.x;
        vec3 hd = vec3(dir.x, 0.0, dir.y);
        vec3 P1 = hd * sin(a) * L * 0.18 + vec3(0.0, L * 0.55, 0.0);
        vec3 P2 = hd * sin(a) * L + vec3(0.0, cos(a) * L, 0.0);
        vec3 pos = 2.0 * (1.0 - t) * t * P1 + t * t * P2;
        vec3 tng = normalize(2.0 * (1.0 - t) * P1 + 2.0 * t * (P2 - P1) + vec3(0.0, 1e-4, 0.0));
        vec3 side = vec3(face.x, 0.0, face.y);
        float w = uSpacing * 0.75 * uWidthScale * (0.75 + 0.5 * h2.z);
        pos += side * s * w * pow(1.0 - t, 0.6);
        vN = normalize(mix(normalize(cross(side, tng)), vec3(0.0, 1.0, 0.0), 0.6));
        vec3 world = vec3(root.x, -0.02, root.y) + pos;
        vWorld = world;
        vT = t; vGust = g;
        vLow = grassLow(root);
        vHigh = grassHigh(root) * (0.85 + 0.3 * h2.w);
        vGlow = rp.rgb;
        vSparkle = uMusic.z * step(0.93, fract(h.z * 37.0 + uTime * 0.7));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity, uWarm;
      varying float vT; varying float vGust; varying vec3 vLow; varying vec3 vHigh;
      varying vec3 vGlow; varying vec3 vN; varying vec3 vWorld; varying float vSparkle;
      vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main() {
        vec3 col = mix(vLow, vHigh, smoothstep(0.0, 0.85, vT));
        col *= mix(0.35, 1.0, smoothstep(0.0, 0.55, vT));
        col *= 1.0 + vGust * 0.28 * vT;
        col = mix(col, col * vec3(1.15, 1.0, 0.7), uWarm * vT);
        vec3 n = normalize(gl_FrontFacing ? vN : vN);
        float lam = max(dot(n, uSunDir), 0.0) * 0.6 + 0.4;
        vec3 lit = col * (uAmbient + uSunCol * lam * 1.4) + col * uSunCol * 0.3 * vT;
        lit += vGlow * vT * vT * 0.55 + vec3(1.0, 0.95, 0.8) * vSparkle * vT * vT * 0.8;
        float fog = 1.0 - exp(-uFogDensity * length(vWorld - cameraPosition));
        lit = mix(lit, uFogCol, fog);
        gl_FragColor = vec4(pow(tonemap(lit), vec3(1.0 / 2.2)), 1.0);
      }`,
  });

  const groundMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uNoise: { value: noiseTex }, uFieldMin: grassUniforms.uFieldMin, uFieldMax: { value: new THREE.Vector2() } }, lightUniforms),
    vertexShader: "varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity; uniform vec2 uFieldMin, uFieldMax;
      varying vec3 vWorld;
      ${COMMON_GLSL}
      void main() {
        vec2 xz = vWorld.xz;
        float n = texture2D(uNoise, xz / 9.0).b;
        vec3 low = grassLow(xz) * (0.8 + 0.4 * n);
        // past the blades the ground takes the colour of their tips
        vec2 outside = max(uFieldMin - xz, xz - uFieldMax);
        float far = smoothstep(-1.0, 3.0, max(outside.x, outside.y));
        vec3 c = mix(low, grassHigh(xz) * 0.6, far);
        vec3 lit = c * (uAmbient + uSunCol * (max(uSunDir.y, 0.0) * 0.6 + 0.4) * 1.6);
        float fog = 1.0 - exp(-uFogDensity * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // One blade: a strip from root (y 0) to tip (y 1), x -0.5..0.5 across.
  function bladeGeometry(segments) {
    const pos = [], idx = [];
    for (let k = 0; k < segments; k++) { const t = k / segments; pos.push(-0.5, t, 0, 0.5, t, 0); }
    pos.push(0, 1, 0);
    for (let k = 0; k < segments - 1; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const last = (segments - 1) * 2;
    idx.push(last, segments * 2, last + 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  // The field: a grid of cells covering what every view sees, in a shuffled
  // order, so drawing fewer blades thins the whole meadow evenly. Blades widen
  // as they thin so the meadow stays full.
  const MAX_BLADES = 150000;
  let budget = 70000;
  const bladeGeo = bladeGeometry(4);
  const blades = new THREE.Mesh(bladeGeo, grassMat);
  blades.frustumCulled = false;
  group.add(blades);
  let fieldArea = 1;

  function footprint(view, aspect) {
    const cam = new THREE.PerspectiveCamera(view.fov, aspect, 0.1, 100);
    cam.position.set(...view.pos); cam.lookAt(...view.look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const pts = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = new THREE.Vector3(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
      const t = p.y < -0.05 ? -cam.position.y / p.y : 40;
      const hit = cam.position.clone().addScaledVector(p, Math.min(t, 40));
      pts.push([clamp(hit.x, -FIELD_LIMIT, FIELD_LIMIT), clamp(hit.z, -FIELD_LIMIT, FIELD_LIMIT)]);
    }
    return pts;
  }

  function buildField() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    for (const v of VIEWS) for (const [x, z] of footprint(v, aspect)) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    minX -= 1.5; minZ -= 1.5; maxX += 1.5; maxZ += 1.5;
    const w = maxX - minX, d = maxZ - minZ;
    fieldArea = w * d;
    const spacing = Math.sqrt(fieldArea / MAX_BLADES);
    const nx = Math.ceil(w / spacing), nz = Math.ceil(d / spacing);
    const n = nx * nz;
    const cells = new Float32Array(n * 2);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = (j * nx + i) * 2; cells[k] = i; cells[k + 1] = j; }
    let s = 12345;
    for (let k = n - 1; k > 0; k--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const r = s % (k + 1);
      const ax = cells[2 * k], az = cells[2 * k + 1];
      cells[2 * k] = cells[2 * r]; cells[2 * k + 1] = cells[2 * r + 1];
      cells[2 * r] = ax; cells[2 * r + 1] = az;
    }
    bladeGeo.setAttribute("aCell", new THREE.InstancedBufferAttribute(cells, 2));
    grassUniforms.uSpacing.value = spacing;
    grassUniforms.uFieldMin.value.set(minX, minZ);
    groundMat.uniforms.uFieldMax.value.set(maxX, maxZ);
    bladeGeo.maxCells = n;
    setBudget(budget);
  }

  function setBudget(b) {
    budget = clamp(Math.round(b), 15000, Math.min(MAX_BLADES, bladeGeo.maxCells || MAX_BLADES));
    bladeGeo.instanceCount = budget;
    grassUniforms.uWidthScale.value = Math.sqrt(MAX_BLADES / budget) * 0.9;
  }

  // ---- wildflowers ------------------------------------------------------------------
  // A summer meadow's flowers among the grass: daisies, buttercups, cornflowers,
  // poppies, clover and cow parsley, each kind growing in its own drifts, thick
  // in places and sparse in others. Each is a stem and a head; the stem bends in
  // the wind and parts round a finger like the grass, and the head's petals are
  // drawn in the shader, so a flower is thirteen vertices.
  const FLOWERS = 9000;
  function flowerGeometry() {
    const pos = [], part = [], idx = [];
    const S = 4;
    for (let k = 0; k <= S; k++) { const t = k / S; pos.push(-0.5, t, 0, 0.5, t, 0); part.push(0, 0); }
    for (let k = 0; k < S; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const h = pos.length / 3;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(x, 0, z); part.push(1); }
    idx.push(h, h + 2, h + 1, h, h + 3, h + 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
    g.setIndex(idx);
    const seeds = new Float32Array(FLOWERS * 4);
    let s = 987654;
    for (let i = 0; i < seeds.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; seeds[i] = s / 4294967296; }
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = FLOWERS;
    return g;
  }
  const flowerUniforms = Object.assign({}, grassUniforms, { uFieldMax: groundMat.uniforms.uFieldMax });
  const flowerMat = new THREE.ShaderMaterial({
    uniforms: flowerUniforms,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute float aPart; attribute vec4 aSeed;
      uniform sampler2D uBend, uRipple; uniform vec3 uRect;
      uniform float uTime, uWind, uGustSpeed;
      uniform vec2 uFieldMin, uFieldMax, uWindDir;
      varying float vPart, vSpecies; varying vec2 vQuad; varying vec3 vWorld, vGlow; varying float vT;
      ${COMMON_GLSL}
      void main() {
        vec2 root = mix(uFieldMin, uFieldMax, aSeed.xy);
        // drifts: where flowers grow thick, and which kind grows there
        float drift = texture2D(uNoise, root / 21.0 + 0.5).g;
        float density = 0.12 + 0.88 * smoothstep(0.42, 0.66, drift);
        float keep = step(aSeed.z, density);
        float kind = mod(floor(texture2D(uNoise, root / 37.0 + 0.2).a * 14.0) + floor(aSeed.w * 1.7), 6.0);
        vSpecies = kind;
        // 0 daisy, 1 buttercup, 2 cornflower, 3 poppy, 4 clover, 5 cow parsley
        float H = (kind > 4.5 ? 0.85 : kind > 3.5 ? 0.42 : kind > 2.5 ? 0.66 : 0.58) * (0.8 + 0.4 * fract(aSeed.w * 7.3));
        float R = (kind > 4.5 ? 0.11 : kind > 3.5 ? 0.04 : kind > 2.5 ? 0.085 : kind > 1.5 ? 0.06 : kind > 0.5 ? 0.045 : 0.07);

        // the same wind and the same parting as the grass, a little stiffer
        vec2 wd = uWindDir;
        vec2 q = root - wd * uTime * uGustSpeed;
        float n = texture2D(uNoise, q / 100.0).a * 0.65 + texture2D(uNoise, q / 32.0 + vec2(0.3, 0.7)).a * 0.35;
        float g = smoothstep(0.45, 0.78, n);
        float sway = sin(uTime * (1.8 + aSeed.w) + aSeed.x * 40.0);
        vec2 v = wd * uWind * (0.15 + 0.8 * g) + wd * sway * 0.06 + (aSeed.yx - 0.5) * 0.25;
        vec2 buv = (root - uRect.xy) / uRect.z;
        float inside = step(0.0, buv.x) * step(buv.x, 1.0) * step(0.0, buv.y) * step(buv.y, 1.0);
        vec4 b = texture2D(uBend, buv);
        vec2 push = (b.rg - 0.5) * 2.0 * inside;
        v = v * (1.0 - 0.6 * min(length(push), 1.0)) + push * 1.3;
        float vl = max(length(v), 1e-4);
        float a = min(vl, 1.3) * 0.75;
        vec3 hd = vec3(v.x / vl, 0.0, v.y / vl);
        vec3 tip = hd * sin(a) * H + vec3(0.0, cos(a) * H, 0.0);
        vGlow = texture2D(uRipple, buv).rgb * inside;

        vec3 local;
        if (aPart < 0.5) {
          float t = position.y;
          local = hd * sin(a) * H * t * t + vec3(0.0, cos(a) * H * t, 0.0);
          vec3 side = normalize(cross(hd + vec3(0.0001, 0.0, 0.0), vec3(0.0, 1.0, 0.0)));
          local += side * position.x * 0.014;
          vT = t; vQuad = vec2(0.0);
        } else {
          // the head faces up, tipped the way the stem leans
          vec3 nrm = normalize(vec3(hd.x * sin(a) * 0.9, 1.0, hd.z * sin(a) * 0.9) + vec3(aSeed.y - 0.5, 0.0, aSeed.x - 0.5) * 0.3);
          vec3 ta = normalize(cross(nrm, vec3(0.0, 0.0, 1.0)));
          vec3 tb = cross(ta, nrm);
          local = tip + (ta * position.x + tb * position.z) * R + nrm * 0.005;
          vT = 1.0; vQuad = position.xz;
        }
        vPart = aPart;
        vec3 world = vec3(root.x, -0.02, root.y) + local * keep;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);     // a flower not grown here collapses to a point
      }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying float vPart, vSpecies; varying vec2 vQuad; varying vec3 vWorld, vGlow; varying float vT;
      vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main() {
        vec3 col;
        if (vPart < 0.5) {
          col = mix(vec3(0.05, 0.12, 0.02), vec3(0.18, 0.34, 0.06), vT);
        } else {
          vec2 q = vQuad;
          float r = length(q), ang = atan(q.y, q.x);
          float k = vSpecies;
          if (k < 0.5) {            // daisy: a ring of thin white petals round a yellow eye
            float petal = 0.32 + 0.68 * pow(abs(cos(ang * 6.5)), 0.5);
            if (r > petal) discard;
            col = r < 0.3 ? vec3(0.95, 0.72, 0.08) : vec3(0.96, 0.96, 0.92);
          } else if (k < 1.5) {     // buttercup: five round glossy petals
            float petal = 0.45 + 0.55 * pow(abs(cos(ang * 2.5)), 0.4);
            if (r > petal) discard;
            col = mix(vec3(1.0, 0.82, 0.05), vec3(1.0, 0.95, 0.5), smoothstep(0.5, 0.0, r) * 0.6);
          } else if (k < 2.5) {     // cornflower: ragged blue florets, a dark heart
            float petal = 0.55 + 0.45 * pow(abs(cos(ang * 4.0)), 0.25) * (0.75 + 0.25 * step(0.5, fract(ang * 2.55)));
            if (r > petal) discard;
            col = r < 0.25 ? vec3(0.22, 0.1, 0.35) : vec3(0.2, 0.36, 0.95);
          } else if (k < 3.5) {     // poppy: four broad red petals, a black eye
            float petal = 0.62 + 0.38 * abs(cos(ang * 2.0));
            if (r > petal) discard;
            col = r < 0.2 ? vec3(0.04, 0.03, 0.03) : vec3(0.9, 0.07, 0.04) * (0.8 + 0.2 * r);
          } else if (k < 4.5) {     // clover: a pink ball of florets
            float petal = 0.85 + 0.15 * cos(ang * 9.0);
            if (r > petal) discard;
            col = mix(vec3(0.95, 0.65, 0.8), vec3(0.75, 0.3, 0.5), r);
          } else {                  // cow parsley: an umbel of tiny white flowers
            vec2 c = fract(q * 3.5) - 0.5;
            if (r > 1.0 || length(c) > 0.32) discard;
            col = vec3(0.95, 0.95, 0.88);
          }
        }
        float lam = vPart < 0.5 ? 0.6 : max(uSunDir.y, 0.0) * 0.6 + 0.4;
        vec3 lit = col * (uAmbient * 0.9 + uSunCol * lam * 1.2) + vGlow * 0.4 * vT;
        float fog = 1.0 - exp(-uFogDensity * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const flowers = new THREE.Mesh(flowerGeometry(), flowerMat);
  flowers.frustumCulled = false;
  group.add(flowers);

  // ---- butterflies ------------------------------------------------------------------
  // They rest in the grass until a finger comes through, then flutter up from
  // around it: cabbage whites, brimstones, common blues, peacocks, small
  // tortoiseshells and red admirals. They wander a while on erratic paths,
  // wings beating and now and then held up in a glide, then settle on the grass
  // again with their wings slowly opening and closing, until disturbed. Two
  // hinged wings each; the shape and the markings are drawn in the shader.
  const FLIES = 28;
  const fly = Array.from({ length: FLIES }, () => ({
    mode: 0,                    // 0 hidden, 1 flying, 2 landing, 3 resting
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, turn: 0, phase: 0, rate: 7, glide: 0,
    air: 0, rest: 0, cruise: 1.2, kind: 0, scale: 1, fade: 0,
  }));
  const flyGeo = new THREE.InstancedBufferGeometry();
  {
    // a wing reaches from the body (x 0) out to x 1, from tail (z -0.5) to head (z 0.5)
    const pos = [], side = [], idx = [];
    for (const sgn of [1, -1]) {
      const b = pos.length / 3;
      for (const [x, z] of [[0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5]]) { pos.push(x, 0, z); side.push(sgn); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    flyGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    flyGeo.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
    flyGeo.setIndex(idx);
  }
  const aPose = new THREE.InstancedBufferAttribute(new Float32Array(FLIES * 4), 4);   // x, y, z, heading
  const aWing = new THREE.InstancedBufferAttribute(new Float32Array(FLIES * 4), 4);   // flap angle, kind, size, fade
  flyGeo.setAttribute("aPose", aPose);
  flyGeo.setAttribute("aWing", aWing);
  flyGeo.instanceCount = FLIES;
  const flyMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, lightUniforms),
    side: THREE.DoubleSide, transparent: true, depthWrite: true,
    vertexShader: `
      attribute float aSide; attribute vec4 aPose, aWing;
      varying vec2 vUv; varying float vKind, vFade, vUp; varying vec3 vWorld;
      void main() {
        float u = position.x;
        float th = aWing.x;
        vec3 p = vec3(aSide * u * cos(th), u * sin(th), position.z) * aWing.z;
        float c = cos(aPose.w), s = sin(aPose.w);
        p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        vec3 world = aPose.xyz + p;
        vWorld = world; vUv = vec2(u, position.z + 0.5); vKind = aWing.y; vFade = aWing.w;
        vUp = cos(th);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec2 vUv; varying float vKind, vFade, vUp; varying vec3 vWorld;
      vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      float ell(vec2 p, vec2 c, vec2 r, float tilt) {
        vec2 d = p - c; float cs = cos(tilt), sn = sin(tilt);
        d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y) / r;
        return length(d);
      }
      void main() {
        vec2 p = vUv;
        float fore = ell(p, vec2(0.45, 0.66), vec2(0.56, 0.3), 0.5);
        float hind = ell(p, vec2(0.33, 0.3), vec2(0.36, 0.27), -0.3);
        float body = step(p.x, 0.07) * step(0.12, p.y) * step(p.y, 0.92);
        float wing = min(fore, hind);
        if (wing > 1.0 && body < 0.5) discard;
        float edge = smoothstep(0.82, 1.0, wing);
        vec3 col;
        float k = vKind;
        if (k < 0.5) {          // cabbage white: white, black tips
          col = vec3(0.96, 0.96, 0.92);
          col = mix(col, vec3(0.08), step(fore, 1.0) * smoothstep(0.62, 0.7, ell(p, vec2(0.0, 0.5), vec2(1.0, 1.0), 0.0)) * step(0.62, p.y));
        } else if (k < 1.5) {   // brimstone: sulphur yellow, an orange dot
          col = vec3(0.98, 0.9, 0.3);
          col = mix(col, vec3(0.95, 0.5, 0.1), step(ell(p, vec2(0.45, 0.62), vec2(0.05, 0.05), 0.0), 1.0));
        } else if (k < 2.5) {   // common blue: blue, a pale fringe
          col = mix(vec3(0.35, 0.5, 0.98), vec3(0.95), edge);
        } else if (k < 3.5) {   // peacock: rust red with eye spots
          col = vec3(0.6, 0.12, 0.06);
          float e1 = ell(p, vec2(0.7, 0.78), vec2(0.13, 0.11), 0.4), e2 = ell(p, vec2(0.45, 0.22), vec2(0.13, 0.11), 0.0);
          float e = min(e1, e2);
          col = mix(col, vec3(0.95, 0.85, 0.5), step(e, 1.0));
          col = mix(col, vec3(0.2, 0.35, 0.8), step(e, 0.65));
          col = mix(col, vec3(0.05), step(e, 0.35));
        } else if (k < 4.5) {   // small tortoiseshell: orange, black blotches, a blue-studded rim
          col = vec3(0.95, 0.45, 0.08);
          col = mix(col, vec3(0.08), step(fract(p.x * 3.0 + p.y * 1.5), 0.25) * step(0.5, p.y) * step(fore, 0.9));
          col = mix(col, vec3(0.25, 0.4, 0.95), edge * step(0.5, fract(p.y * 12.0)));
        } else {                // red admiral: black, an orange band
          col = vec3(0.07, 0.06, 0.06);
          float band = abs(ell(p, vec2(0.0, 1.0), vec2(0.75, 0.6), 0.0) - 1.0);
          col = mix(col, vec3(0.95, 0.35, 0.08), step(band, 0.1) * step(fore, 1.0));
          col = mix(col, vec3(0.95, 0.35, 0.08), step(0.86, hind) * step(hind, 1.0) * step(fore, hind));
          col = mix(col, vec3(0.95), step(ell(p, vec2(0.72, 0.85), vec2(0.06, 0.05), 0.0), 1.0));
        }
        col = mix(col, col * 0.35, edge * 0.6);
        if (body > 0.5 && wing > 0.98) col = vec3(0.06, 0.05, 0.04);
        float lam = 0.55 + 0.45 * abs(vUp);
        vec3 lit = col * (uAmbient * 0.8 + uSunCol * lam * 1.1);
        float fog = 1.0 - exp(-uFogDensity * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), vFade);
      }`,
  });
  const flyMesh = new THREE.Mesh(flyGeo, flyMat);
  flyMesh.frustumCulled = false;
  flyMesh.renderOrder = 12;
  group.add(flyMesh);

  function takeOff(b, fromX, fromZ) {
    b.mode = 1; b.air = 0;
    b.cruise = 0.9 + Math.random() * 0.8;
    b.rate = 6 + Math.random() * 3;
    const away = Math.atan2(b.x - fromX, b.z - fromZ) + (Math.random() - 0.5) * 1.2;
    b.yaw = away;
    const sp = 0.8 + Math.random() * 0.6;
    b.vx = Math.sin(away) * sp; b.vz = Math.cos(away) * sp; b.vy = 1.0 + Math.random() * 0.8;
    b.rest = 6 + Math.random() * 10;    // seconds in the air before it looks for a place to land
  }
  function spawnFly(x, z) {
    let b = fly.find((f) => f.mode === 0);
    if (!b) {
      // all in use: the resting one farthest from here moves
      let far = -1;
      for (const f of fly) if (f.mode === 3) { const d = Math.hypot(f.x - x, f.z - z); if (d > far) { far = d; b = f; } }
      if (!b) return;
    }
    const a = Math.random() * 6.28, r = 0.2 + Math.random() * 0.6;
    b.x = x + Math.cos(a) * r; b.z = z + Math.sin(a) * r; b.y = GRASS_TOP * 0.7;
    b.kind = Math.floor(Math.random() * 6); b.scale = 0.16 + Math.random() * 0.08;
    b.phase = Math.random() * 6.28; b.fade = b.mode === 0 ? 0 : b.fade;
    takeOff(b, x, z);
  }
  let flySpawn = 0;
  function flyButterflies(dt, touches, time) {
    // fingers through the grass: butterflies start up, and resting ones nearby take off
    for (const t of touches) {
      if (t.speed > 0.7) flySpawn += dt * Math.min(t.speed, 6) * 0.5;
      while (flySpawn >= 1) { flySpawn -= 1; spawnFly(t.x, t.z); }
      for (const b of fly) if (b.mode >= 2 && Math.hypot(b.x - t.x, b.z - t.z) < 1.2) takeOff(b, t.x, t.z);
    }
    const cx = currentLook.x, cz = currentLook.z;
    for (let i = 0; i < FLIES; i++) {
      const b = fly[i];
      if (b.mode === 0) { aWing.setXYZW(i, 0, 0, 0, 0); continue; }
      b.fade = Math.min(1, b.fade + dt * 3);
      let flap;
      if (b.mode === 1 || b.mode === 2) {
        b.air += dt;
        // an erratic path: the heading wanders, and the flight bobs
        b.turn += (Math.random() - 0.5) * 9 * dt - b.turn * 1.5 * dt;
        b.yaw += b.turn * dt;
        const toX = cx - b.x, toZ = cz - b.z, home = Math.hypot(toX, toZ);
        if (home > 7) b.yaw += Math.sign(Math.sin(Math.atan2(toX, toZ) - b.yaw)) * dt * 1.2;   // turn back toward the view
        const sp = b.mode === 2 ? 0.5 : b.cruise;
        b.vx += (Math.sin(b.yaw) * sp - b.vx) * dt * 2;
        b.vz += (Math.cos(b.yaw) * sp - b.vz) * dt * 2;
        const wantY = b.mode === 2 ? GRASS_TOP + 0.03 : 1.0 + 0.5 * Math.sin(b.phase + time * 0.7);
        b.vy += ((wantY - b.y) * 2.5 - b.vy) * dt * 2 + Math.sin(time * b.rate * 6.283 + b.phase) * 0.6 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        // now and then the wings are held up in a short glide
        if (b.glide > 0) b.glide -= dt; else if (Math.random() < dt * 0.25) b.glide = 0.3 + Math.random() * 0.4;
        b.phase += dt * b.rate * 6.283 * (b.glide > 0 ? 0.15 : 1);
        flap = b.glide > 0 ? 1.1 : 0.15 + 1.05 * (0.5 + 0.5 * Math.sin(b.phase));
        if (b.mode === 1 && b.air > b.rest) b.mode = 2;
        if (b.mode === 2 && b.y < GRASS_TOP + 0.08) { b.mode = 3; b.y = GRASS_TOP + 0.03; b.rest = 20 + Math.random() * 30; }
      } else {
        // resting: the wings open and close slowly
        b.phase += dt * 1.2;
        flap = 1.25 - 0.9 * (0.5 + 0.5 * Math.sin(b.phase));
        b.rest -= dt;
        if (b.rest < 0) { b.fade -= dt * 6; if (b.fade <= 0) b.mode = 0; }   // gone back into the grass
      }
      aPose.setXYZW(i, b.x, b.y, b.z, b.yaw);
      aWing.setXYZW(i, flap, b.kind, b.scale, b.fade);
    }
    aPose.needsUpdate = true;
    aWing.needsUpdate = true;
  }

  const bendTouch = bendMat.uniforms.uTouch.value, bendDrag = bendMat.uniforms.uDrag.value;

  // touches: {x, z, radius, press, dx, dz, strength} from the core, one per finger
  function update(dt, touches, time) {
    grassUniforms.uTime.value = time;
    grassUniforms.uMusic.value.copy(music);
    let n = 0;
    for (const t of touches) {
      if (n >= MAX_TOUCH) break;
      bendTouch[n].set(t.x, t.z, t.radius, t.press);
      bendDrag[n].set(t.dx, t.dz, t.strength, 0);
      n++;
    }
    bendMat.uniforms.uCount.value = n;
    bendMat.uniforms.uDecay.value = 1 - Math.exp(-dt / 2.6);
    bendMat.uniforms.uPrev.value = bendA.texture;
    passQuad.material = bendMat;
    renderer.setRenderTarget(bendB);
    renderer.render(passScene, passCam);
    renderer.setRenderTarget(null);
    bendMat.uniforms.uInit.value = 0;
    [bendA, bendB] = [bendB, bendA];
    grassUniforms.uBend.value = bendA.texture;
    flyButterflies(dt, touches, time);
  }

  // keep the frame rate: fewer blades on a struggling phone, more on a strong one
  let tuned = 0;
  function tune(fps) {
    if (tuned >= 6) return;
    if (fps < 42) { setBudget(budget * 0.7); tuned++; }
    else if (fps > 57 && budget < MAX_BLADES) { setBudget(budget * 1.25); tuned++; }
  }

  return {
    id: "meadow", name: "Äng", group,
    chords: [[7, 0], [2, 0], [4, 1], [0, 0]],           // G D Em C: I V vi IV, the classic
    sound: { voice: 1, ring: 3.5, wet: 0.32 },
    touchHeight: GRASS_TOP * 0.8, glowHeight: GRASS_TOP + 0.15,
    resize: buildField, update, tune,
    enter() { bendMat.uniforms.uInit.value = 1; },
    exit() {},
    tap() {},
    pluck(f, col, vel) { burst(f.world, col, vel, "pollen"); },
    stats() { return { blades: budget }; },
  };
})();
