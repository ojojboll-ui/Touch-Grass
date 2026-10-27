// ---- scene: clouds ----------------------------------------------------------------
// Lying on your back under a sky of cumulus. Where a finger lands decides what it
// does: on open sky it draws new cloud along its path; on a cloud it pulls the
// cloud along with it, and the cloud thins out as it is stretched; a poke into a
// cloud opens a hole, and a finger left resting there keeps widening it, the
// cloud pushed aside into a ring. The clouds drift on the wind and slowly boil,
// the plucked strings' rings glow in them, and behind them the sky follows the
// clock: the sun crossing by day, the moon and the stars at night.
//
// How it is drawn: a density field (half float, wrapping, so the clouds that
// drift off one side come back on the other) holds what fingers have made. A
// second pass turns density into a cloud shape: how tall the cloud stands above
// its flat base, with noise for the billows. Each pixel then marches its view
// ray up through that shape, lighting each step by how much cloud lies between
// it and the sun: thick bases go grey, thin edges glow, brightest toward the
// sun. (Stacked slices were tried first; seen at a slant they stepped like
// terraces.) The field is never advected by the wind; it is drawn at an offset
// instead, so drifting costs nothing and blurs nothing.
const cloudScene = (() => {
  const group = new THREE.Group();
  // the field is a tile that repeats across the sky. It must be wide enough
  // that a stroke painted far off toward the horizon does not turn up again in
  // a nearer copy: with 144 m, the copy of a stroke up to about 108 m away
  // falls behind the camera, and the one beyond it is lost in the haze. 144 is
  // three times the 48 m the noise scales below were chosen for, so their
  // multipliers are whole numbers and still wrap with it
  const SIZE = 144, RES = 512, SHAPE_RES = 1024, PAINT_REACH = 0.75 * SIZE;
  const TOP = 3.6, MARCH_STEPS = 16;        // the cloud layer's depth, and the steps a ray takes through it
  const MAX_EDIT = 10;
  const WIND = new THREE.Vector2(0.8, 0.6), DRIFT = 0.22;   // metres a second
  const TONEMAP = "vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }";
  // seen from the ground, eleven metres under the cloud base
  const VIEWS_BELOW = [
    { name: "Rakt upp",  pos: [0.0, -11.0, 0.6], look: [0, 0, -1.0], fov: 55 },
    { name: "Snett upp", pos: [0.0, -11.0, 6.0], look: [0, 0, -6.0], fov: 58 },
    { name: "Horisont",  pos: [0.0, -11.0, 10.0], look: [0, -1, -12], fov: 62 },
  ];

  function wrapTarget(res, float) {
    return new THREE.WebGLRenderTarget(res, res, {
      type: float && floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
  }
  let fieldA = wrapTarget(RES, true), fieldB = wrapTarget(RES, true);
  const shapeRT = wrapTarget(SHAPE_RES, false);
  // 8-bit fields store density / 1.5
  const DEC = floatTargets ? "v" : "(v * 1.5)";
  const ENC = floatTargets ? "d" : "(d / 1.5)";

  // ---- the field: what fingers have made ----
  const segs = Array.from({ length: MAX_EDIT }, () => new THREE.Vector4());     // from x, z, to x, z (field metres)
  const shapes = Array.from({ length: MAX_EDIT }, () => new THREE.Vector4());   // radius, kind (0 draw, 1 stretch, 2 hole), amount, push
  const fieldMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: {
      uPrev: { value: null }, uNoise: { value: noiseTex }, uInit: { value: 1 }, uClear: { value: 0 }, uSize: { value: SIZE },
      uCount: { value: 0 }, uSeg: { value: segs }, uShape: { value: shapes },
    },
    fragmentShader: `
      uniform sampler2D uPrev, uNoise; uniform float uInit, uClear, uSize; uniform int uCount;
      uniform vec4 uSeg[${MAX_EDIT}]; uniform vec4 uShape[${MAX_EDIT}];
      varying vec2 vUv;
      float dens(vec2 uv) { float v = texture2D(uPrev, uv).r; return ${DEC}; }
      vec2 wrapped(vec2 d) { return d - uSize * floor(d / uSize + 0.5); }
      void main() {
        vec2 w = vUv * uSize;
        // stretching: what is near a dragging finger goes with it, thinning as
        // it goes; a hole: the cloud pushed outward from the finger, thinned in
        // the middle, so it piles into a rim around the opening
        vec2 disp = vec2(0.0); float thin = 1.0;
        for (int i = 0; i < ${MAX_EDIT}; i++) {
          if (i >= uCount) break;
          vec4 s = uShape[i];
          vec2 d = wrapped(w - uSeg[i].zw);
          if (abs(s.y - 1.0) < 0.5) {
            vec2 v = wrapped(uSeg[i].zw - uSeg[i].xy);
            float k = exp(-dot(d, d) / (s.x * s.x));
            disp += v * k; thin *= 1.0 - s.z * k;
          } else if (s.y > 1.5) {
            float q = length(d) / s.x;
            disp += d / max(length(d), 1e-4) * s.w * s.x * q * exp(-q * q) * 2.33;
            thin *= 1.0 - s.z * (1.0 - smoothstep(0.3, 0.8, q));
          }
        }
        float d = dens(vUv - disp / uSize) * thin;
        if (uInit > 0.5) {
          // the first sky: big soft heaps of cumulus over about a third of it
          float a = texture2D(uNoise, vUv * 3.0).a, b = texture2D(uNoise, vUv * 6.0).b;
          d = smoothstep(0.46, 0.6, a + 0.3 * (b - 0.5));
        }
        d *= 1.0 - uClear;
        for (int i = 0; i < ${MAX_EDIT}; i++) {
          if (i >= uCount) break;
          vec4 s = uShape[i];
          if (s.y < 0.5) {
            // drawing on open sky: cloud laid along the stroke
            vec2 pa = wrapped(w - uSeg[i].xy), ab = wrapped(uSeg[i].zw - uSeg[i].xy);
            float t = clamp(dot(pa, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
            float q = length(pa - ab * t) / s.x;
            d = max(d, min(d + s.z * exp(-q * q * 2.0), 1.3));
          }
        }
        gl_FragColor = vec4(${ENC}, 0.0, 0.0, 1.0);
      }`,
  });

  // ---- the shape: how tall each cloud stands above its flat base ----
  const shapeMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: { uField: { value: fieldA.texture }, uNoise: { value: noiseTex }, uTime: { value: 0 } },
    fragmentShader: `
      uniform sampler2D uField, uNoise; uniform float uTime;
      varying vec2 vUv;
      void main() {
        float v = texture2D(uField, vUv).r;
        float d = ${DEC};
        // the billows boil slowly: noise drifting two ways (whole-number scales,
        // so it wraps with the field); mostly broad, little fine, so the tops
        // round over instead of standing in points
        vec2 drift = vec2(uTime * 0.0021, uTime * 0.0013);
        float n = texture2D(uNoise, vUv * 9.0 + drift).b * 0.62 + texture2D(uNoise, vUv * 21.0 - drift * 1.7).b * 0.3
                + texture2D(uNoise, vUv * 51.0 + drift * 2.3).b * 0.08;
        // each heap rounds over like a quarter circle: steep at its edge, flat
        // on top, never a point. How tall a heap stands comes from a broad
        // noise of its own, so some tower and some stay low. g keeps how far
        // into the cloud this is, so stretched cloud can stay sheer
        float x = max(0.0, d * (0.5 + 1.0 * n) - 0.1);
        float s = clamp(x / 0.45, 0.0, 1.0);
        float tower = 1.2 + 1.7 * texture2D(uNoise, vUv * 12.0 + drift * 0.5).b;
        gl_FragColor = vec4(tower * sqrt(s * (2.0 - s)) / 3.0, s, 0.0, 1.0);
      }`,
  });

  // ---- the sky behind: gradient, sun, moon, stars ----
  const trueSun = new THREE.Vector3(), moon = new THREE.Vector3();
  const skyMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uTrueSun: { value: trueSun }, uMoon: { value: moon }, uNoise: { value: noiseTex }, uTime: { value: 0 } }, lightUniforms),
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uTrueSun, uMoon, uSunCol, uFogCol; uniform float uTime;
      uniform sampler2D uNoise;
      varying vec3 vDir;
      ${TONEMAP}
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
      float stars(vec3 d, float cells, float keep) {
        vec2 g = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * cells / 3.14159;
        vec2 c = floor(g), f = fract(g) - 0.5;
        float h = hash12(c);
        if (h < keep) return 0.0;
        float r = length(f - (hash22(c + 4.1) - 0.5) * 0.6);
        float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + 4.0 * h) + h * 40.0);
        return smoothstep(0.1, 0.0, r) * (h - keep) / (1.0 - keep) * twinkle;
      }
      void main() {
        vec3 d = normalize(vDir);
        float day = smoothstep(-0.12, 0.22, uTrueSun.y);
        vec3 zen = mix(vec3(0.010, 0.016, 0.040), vec3(0.16, 0.34, 0.72), day);
        vec3 sky = mix(uFogCol, zen, pow(clamp(d.y, 0.0, 1.0), 0.55));
        // below the horizon, the land: dark under a band of haze
        vec3 land = uFogCol * 0.3 + vec3(0.02, 0.03, 0.015);
        sky = mix(sky, land, smoothstep(0.0, -0.06, d.y));
        // the sun: a glow round it, wide and warm when it is low, and its disc
        float cs = dot(d, uTrueSun);
        float above = smoothstep(-0.02, 0.01, d.y);
        sky += uSunCol * (pow(max(cs, 0.0), 8.0) * 0.3 + pow(max(cs, 0.0), 90.0) * 0.8) * (1.2 - 0.6 * day) * above;
        sky += vec3(1.0, 0.92, 0.78) * 7.0 * smoothstep(0.99955, 0.9997, cs) * above;
        // the moon: a mottled disc and a faint halo, brightest at night
        float night = 1.0 - day;
        float cm = dot(d, uMoon);
        float disc = smoothstep(0.99935, 0.9995, cm) * above;
        vec3 mside = d - uMoon * cm;
        float mare = texture2D(uNoise, mside.xy * 18.0 + mside.z * 9.0 + 0.3).g;
        vec3 moonCol = vec3(0.92, 0.92, 0.86) * (0.7 + 0.5 * smoothstep(0.4, 0.6, mare)) * (0.35 + 1.4 * night);
        sky = mix(sky, moonCol, disc * (0.45 + 0.55 * night));
        sky += vec3(0.6, 0.65, 0.8) * pow(max(cm, 0.0), 300.0) * 0.25 * night * above;
        // the stars, coming out as the sun goes down
        float st = stars(d, 70.0, 0.965) * 1.6 + stars(d, 160.0, 0.975) * 0.7;
        sky += vec3(0.9, 0.93, 1.0) * st * smoothstep(0.35, 0.95, night) * smoothstep(-0.02, 0.12, d.y) * (1.0 - disc);
        gl_FragColor = vec4(pow(tonemap(sky), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // ---- the volume: rays marched up through the shape ----
  // One sheet under the cloud base; each pixel follows its view ray up through
  // the layer in a fixed number of steps (offset a little per pixel, so the
  // steps blur into a volume), gathering light where the ray is inside a cloud,
  // until the cloud is opaque or the ray leaves the top.
  const offset = new THREE.Vector2();
  const marchUniforms = Object.assign({
    uShapeTex: { value: shapeRT.texture }, uOffset: { value: offset }, uSize: { value: SIZE },
    uRipple: { value: rippleRT.texture }, uRippleRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
    uMusic: { value: new THREE.Vector3() }, uTrueSun: { value: trueSun },
  }, lightUniforms);
  const marchMat = new THREE.ShaderMaterial({
    uniforms: marchUniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D uShapeTex, uRipple; uniform vec2 uOffset; uniform float uSize;
      uniform vec3 uRippleRect, uMusic, uTrueSun;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        vec3 rd = normalize(vWorld - cameraPosition);
        if (rd.y < 0.02) discard;
        vec2 toward = uSunDir.xz / max(length(uSunDir.xz), 1e-3);
        float rise = uSunDir.y / max(length(uSunDir.xz), 0.05);
        float t0 = max(-cameraPosition.y / rd.y, 0.0);
        float t1 = (${TOP.toFixed(2)} - cameraPosition.y) / rd.y;
        float dt = (t1 - t0) / ${MARCH_STEPS}.0;
        // interleaved gradient noise: each pixel starts its steps a little
        // further along, in a fine even pattern rather than clumpy grain
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        // light scattered forward: a cloud's edges blaze when you look toward the sun
        float silver = 1.0 + 2.5 * pow(max(dot(rd, uSunDir), 0.0), 6.0);
        vec3 col = vec3(0.0);
        float trans = 1.0, hitT = t1;
        for (int i = 0; i < ${MARCH_STEPS}; i++) {
          float t = t0 + (float(i) + jitter) * dt;
          vec3 p = cameraPosition + rd * t;
          vec4 sh = texture2D(uShapeTex, (p.xz - uOffset) / uSize);
          float h = sh.r * 3.0;
          float inside = h - p.y;
          if (inside > 0.0) {
            // a thick cloud fills up within a metre; a thin one stays sheer
            float a = 1.0 - exp(-2.4 * dt * smoothstep(0.0, 0.5, inside) * (0.2 + 0.8 * sh.g));
            // how much cloud lies between here and the sun: straight up to the
            // top, slanted by the sun's height, and one look toward it for the
            // cloud beside
            float hs = texture2D(uShapeTex, (p.xz + toward * 0.8 - uOffset) / uSize).r * 3.0;
            float thick = inside / max(uSunDir.y, 0.3) + max(0.0, hs - (p.y + 0.8 * rise));
            float sunVis = exp(-0.9 * thick);
            float up = clamp(p.y / max(h, 0.01), 0.0, 1.0);
            vec3 lit = uSunCol * sunVis * silver * 1.1 + uAmbient * (0.3 + 0.5 * up) + uSunCol * 0.04;
            if (trans > 0.99) hitT = t;
            col += trans * a * lit;
            trans *= 1.0 - a;
            if (trans < 0.02) break;
          }
        }
        // the farthest clouds, too far to march finely, fade into the horizon's haze
        trans = mix(trans, 1.0, smoothstep(90.0, 200.0, t0));
        if (trans > 0.995) discard;
        float alpha = 1.0 - trans;
        col /= alpha;
        vec3 hit = cameraPosition + rd * hitT;
        vec3 ring = texture2D(uRipple, (hit.xz - uRippleRect.xy) / uRippleRect.z).rgb;
        col += ring * (0.5 + 0.4 * uMusic.z);
        // far clouds fade into the haze at the horizon
        float fog = 1.0 - exp(-uFogDensity * 0.6 * hitT);
        gl_FragColor = vec4(pow(tonemap(mix(col, uFogCol, fog)), vec3(1.0 / 2.2)), alpha);
      }`,
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), marchMat);
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 0;
  sheet.renderOrder = 10;
  group.add(sheet);

  // ---- looking under a finger: is it on a cloud? ----
  const probe = new Uint8Array(4);
  function cloudAt(x, z) {
    let u = ((x - offset.x) / SIZE) % 1, v = ((z - offset.y) / SIZE) % 1;
    if (u < 0) u += 1;
    if (v < 0) v += 1;
    try {
      renderer.readRenderTargetPixels(shapeRT, Math.min(SHAPE_RES - 1, Math.floor(u * SHAPE_RES)), Math.min(SHAPE_RES - 1, Math.floor(v * SHAPE_RES)), 1, 1, probe);
      return probe[0] / 255 * 3;
    } catch (e) { return 0; }
  }

  // ---- the frame ----------------------------------------------------------------
  const brushScale = (x, z) => clamp(Math.hypot(x - camera.position.x, camera.position.y, z - camera.position.z) / 14, 1, 5);
  const edits = [];
  function edit(ax, az, bx, bz, radius, kind, amount, push = 0) {
    if (edits.length < MAX_EDIT) edits.push([ax - offset.x, az - offset.y, bx - offset.x, bz - offset.y, radius, kind, amount, push]);
  }
  let clearing = 0, mistTime = 0;
  const MIST = [1, 1, 1];
  function update(dt, touches, time) {
    offset.x = (offset.x + WIND.x * DRIFT * dt) % SIZE;
    offset.y = (offset.y + WIND.y * DRIFT * dt) % SIZE;
    marchUniforms.uMusic.value.copy(music);
    // the sky follows the clock: the sun where the hour puts it, the moon across from it
    trueSun.copy(sunDirection(hour));
    moon.copy(sunDirection((hour + 12) % 24)).add(new THREE.Vector3(0.15, 0.05, 0.1)).normalize();
    skyMat.uniforms.uTime.value = time;
    sky.position.copy(camera.position);
    const viewScale = viewScaleNow();
    const frames = dt * 60;
    mistTime += dt;
    const mist = mistTime > 0.08;
    for (const t of touches) {
      const f = t.finger;
      // beyond the reach, a stroke would show up again in a nearer copy of the tile
      if (Math.hypot(t.x - camera.position.x, t.z - camera.position.z) > PAINT_REACH) continue;
      // far off, the brush widens with the distance, so a stroke is about as
      // wide on the screen wherever it is drawn
      const vs = viewScale * brushScale(t.x, t.z);
      const moved = Math.hypot(t.x - t.px, t.z - t.pz);
      if (!f.cloudMode || f.cloudMode === "none") f.cloudMode = "sky";
      if (f.cloudMode === "sky") {
        edit(t.px, t.pz, t.x, t.z, 0.75 * vs * (1 + 0.5 * t.depth), 0, (0.07 + 0.05 * t.depth) * frames);
        if (mist && moved > 0.01) burst({ x: t.x, y: 0, z: t.z }, MIST, 0.15, "pollen", 2);
      } else if (moved > 0.004) {
        // pulling the cloud along; the faster the pull, the thinner it goes
        const R = 1.2 * vs * (1 + 0.4 * t.depth);
        edit(t.px, t.pz, t.x, t.z, R, 1, Math.min(moved / R, 1) * 0.3);
        f.holeTime = 0;
      } else if (t.speed < 0.3) {
        // resting in a cloud: the hole keeps opening, to about a metre and a half
        f.holeTime = (f.holeTime || 0) + dt;
        const r = (0.5 + 1.0 * smooth(0, 1, f.holeTime / 3)) * vs;
        edit(t.x, t.z, t.x, t.z, r, 2, 0.02 * frames, 0.022 * frames);
      }
    }
    if (mist) mistTime = 0;

    let clearNow = 0;
    if (clearing > 0) { clearNow = 1 - Math.exp(-dt / 0.35); clearing -= dt; }
    if (edits.length || clearNow > 0 || fieldMat.uniforms.uInit.value > 0) {
      for (let i = 0; i < edits.length; i++) {
        const q = edits[i];
        segs[i].set(q[0], q[1], q[2], q[3]);
        shapes[i].set(q[4], q[5], q[6], q[7]);
      }
      fieldMat.uniforms.uCount.value = edits.length;
      fieldMat.uniforms.uClear.value = clearNow;
      fieldMat.uniforms.uPrev.value = fieldA.texture;
      run(fieldMat, fieldB);
      fieldMat.uniforms.uInit.value = 0;
      [fieldA, fieldB] = [fieldB, fieldA];
      edits.length = 0;
    }
    shapeMat.uniforms.uField.value = fieldA.texture;
    shapeMat.uniforms.uTime.value = time;
    run(shapeMat, shapeRT);
  }
  function run(mat, rt) {
    passQuad.material = mat;
    renderer.setRenderTarget(rt);
    renderer.render(passScene, passCam);
    renderer.setRenderTarget(null);
  }

  return {
    id: "clouds", name: "Moln", group,
    chords: [[10, 3], [0, 2], [9, 4], [2, 1]],          // Bbmaj7 C7 Am7 Dm: IVmaj7 V7 iii7 vi, the romantic "royal road" of ballads
    views: VIEWS_BELOW,
    sound: { voice: 6, ring: 6, wet: 0.5 },
    touchHeight: 0.0, glowHeight: -0.1,
    resize() {},
    update,
    tune() {},
    enter() {},
    exit() {},
    // where a finger lands decides what it does: open sky draws, a cloud is
    // pulled or, poked, opened
    tap(f) {
      if (Math.hypot(f.world.x - camera.position.x, f.world.z - camera.position.z) > PAINT_REACH) { f.cloudMode = "none"; return; }
      const onCloud = cloudAt(f.world.x, f.world.z) > 0.25;
      f.cloudMode = onCloud ? "cloud" : "sky";
      f.holeTime = 0;
      if (onCloud) {
        const s = 0.6 * brushScale(f.world.x, f.world.z);
        edit(f.world.x, f.world.z, f.world.x, f.world.z, s, 2, 0.45, 0.3);
        burst(f.world, MIST, 0.4, "pollen", 10);
      }
    },
    pluck() {},
    // wiped: the wind clears the sky
    erase() { clearing = 1.4; },
    stats() { return { field: floatTargets ? "half" : "8-bit" }; },
    field() { return fieldA; },
    shape() { return shapeRT; },
  };
})();
