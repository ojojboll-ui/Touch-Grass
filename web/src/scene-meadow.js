// ---- scene: the meadow ---------------------------------------------------------
// Long grass that parts round each finger and closes behind it, rings of light
// from every pluck, pollen, and blades that sway and glint with the music.
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
    float dryAt(vec2 xz) { return smoothstep(0.42, 0.66, texture2D(uNoise, xz / 64.0).r); }
    float lushAt(vec2 xz) { return texture2D(uNoise, xz / 64.0 + vec2(0.37, 0.11)).g; }
    vec3 grassLow(vec2 xz) { return mix(vec3(0.018, 0.05, 0.010), vec3(0.11, 0.09, 0.03), dryAt(xz)); }
    vec3 grassHigh(vec2 xz) {
      vec3 green = mix(vec3(0.20, 0.36, 0.03), vec3(0.36, 0.48, 0.045), lushAt(xz));
      return mix(green, vec3(0.56, 0.44, 0.11), dryAt(xz));
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
