// ---- scene: sand ------------------------------------------------------------------
// Fine glittering sand, as in a zen garden or an Etch A Sketch: a finger draws a
// groove that stays, with the sand it moved heaped along both sides; a tap
// leaves a pit and kicks up grains; every plucked string sends a ring of
// glitter in its plate's colour. The drawing stays until it is wiped: three
// fingers landing together, or shaking the phone where the browser reports
// motion. The wind's ripples cover everything a groove has not cut through.
//
// A finger that rests digs: the pit deepens and widens into a cone, its rim
// rising around it. A finger pressed in and dragged shovels: the sand it moves
// is carried ahead of it as a heap that grows with the stroke and stays where
// the stroke ends. Sand steeper than it can lie slumps until it can.
//
// Now and then a gust comes through: grains stream low over the sand, the
// ripples creep downwind, the dunes shift a little, and the drawing wears.
//
// The grooves live in a half-float height field that is never faded (or an
// 8-bit one, coarser, where half floats cannot be drawn into). The glitter is
// the trick from Journey's sand (Alan Zucconi's write-up): every grain has its
// own tilt, and a grain flashes when that tilt mirrors the sun into the eye.
const sandScene = (() => {
  const group = new THREE.Group();
  const SIZE = 36, RES = 512;
  const RECT = new THREE.Vector3(-SIZE / 2, -SIZE / 2, SIZE);
  const MAX_STROKE = 12, MAX_HEAP = 8;
  const TEXEL = SIZE / RES;
  const MAX_DIG = 1.25, MAX_HEAP_RADIUS = 2.0;   // a heap that wide stands about 0.85 m
  const REPOSE = 0.67;                       // tan of the angle dry sand lies at, about 34 degrees
  const WIND = new THREE.Vector2(0.62, 0.78); // downwind, in x and z; the ripples' crests lie across it
  const TONEMAP = "vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }";

  // ---- the drawing: height of the sand where fingers have been ----
  function fieldTarget() {
    return new THREE.WebGLRenderTarget(RES, RES, {
      type: floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
    });
  }
  let fieldA = fieldTarget(), fieldB = fieldTarget();
  // 8-bit targets store height * 0.3 + 0.5, so pits 1.5 m deep and heaps as tall both fit
  const ENC = floatTargets ? "h" : "(h * 0.3 + 0.5)";
  const DEC = floatTargets ? "v" : "((v - 0.5) / 0.3)";
  const strokes = Array.from({ length: MAX_STROKE }, () => new THREE.Vector4());   // from x, z, to x, z
  const shapes = Array.from({ length: MAX_STROKE }, () => new THREE.Vector4());    // groove radius, groove depth, rim height, pit depth
  const heaps = Array.from({ length: MAX_HEAP }, () => new THREE.Vector4());       // x, z, radius, height
  const drawMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: {
      uPrev: { value: null }, uInit: { value: 1 }, uErase: { value: 0 }, uRepose: { value: REPOSE },
      uCount: { value: 0 }, uStroke: { value: strokes }, uShape: { value: shapes }, uRect: { value: RECT },
      uHeapCount: { value: 0 }, uHeap: { value: heaps },
    },
    fragmentShader: `
      uniform sampler2D uPrev; uniform float uInit, uErase, uRepose; uniform int uCount, uHeapCount;
      uniform vec4 uStroke[${MAX_STROKE}]; uniform vec4 uShape[${MAX_STROKE}]; uniform vec4 uHeap[${MAX_HEAP}]; uniform vec3 uRect;
      varying vec2 vUv;
      float decode(float v) { return ${DEC}; }
      float encode(float h) { return ${ENC}; }
      void main() {
        float h = decode(texture2D(uPrev, vUv).r) * (1.0 - uInit);
        h *= 1.0 - uErase;                                       // a shake smooths it all away, a gust a little
        vec2 w = uRect.xy + vUv * uRect.z;
        for (int i = 0; i < ${MAX_STROKE}; i++) {
          if (i >= uCount) break;
          vec2 a = uStroke[i].xy, b = uStroke[i].zw;
          vec2 ab = b - a;
          float t = clamp(dot(w - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
          float dist = length(w - (a + ab * t));
          vec4 s = uShape[i];
          // the groove under the finger, and the pit it digs where it rests:
          // a cone no steeper than the sand will stand
          float outer = s.x + s.w / (uRepose * 0.9);
          float dg = dist / s.x;
          float trough = -s.y * max(1.0 - dg * dg, 0.0) - s.w * max(1.0 - dist / outer, 0.0);
          if (dist < outer) h = min(h, trough);
          // the sand it pushed aside, heaped along both edges and around the pit
          float d = dist / outer;
          float rim = s.z * sin(3.14159 * clamp((d - 0.85) / 0.9, 0.0, 1.0));
          // only on sand nobody has drawn in yet: a new stretch of groove must not
          // wall off the groove it continues, or a line becomes a row of beads
          if (d > 0.85 && d < 1.75 && h > -0.002) h = max(h, rim);
        }
        // the heaps shovelled ahead of the fingers, lying over whatever is
        // there: a heap pushed across a pit or a groove sits in it, it does not
        // fill it, so a pit a finger climbs out of keeps its shape
        for (int i = 0; i < ${MAX_HEAP}; i++) {
          if (i >= uHeapCount) break;
          float d = length(w - uHeap[i].xy) / uHeap[i].z;
          float k = max(1.0 - d * d, 0.0);
          if (k > 0.0) h = max(h, min(h, 0.0) + uHeap[i].w * k * k);
        }
        gl_FragColor = vec4(encode(h), 0.0, 0.0, 1.0);
      }`,
  });
  // Slumping: wherever the sand between two neighbouring cells is steeper than it
  // can lie, the excess runs downhill. Every exchange is counted from both
  // sides, so no sand is made or lost.
  const slumpMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: { uPrev: { value: null }, uTexel: { value: 1 / RES }, uMaxDiff: { value: REPOSE * TEXEL } },
    fragmentShader: `
      uniform sampler2D uPrev; uniform float uTexel, uMaxDiff;
      varying vec2 vUv;
      float decode(float v) { return ${DEC}; }
      float encode(float h) { return ${ENC}; }
      float at(vec2 o) { return decode(texture2D(uPrev, vUv + o * uTexel).r); }
      float flow(float h, float n, float limit) { float d = n - h; return sign(d) * max(abs(d) - limit, 0.0); }
      void main() {
        float h = at(vec2(0.0));
        float m = uMaxDiff, md = uMaxDiff * 1.4142;
        float f = flow(h, at(vec2(1.0, 0.0)), m) + flow(h, at(vec2(-1.0, 0.0)), m)
                + flow(h, at(vec2(0.0, 1.0)), m) + flow(h, at(vec2(0.0, -1.0)), m)
                + flow(h, at(vec2(1.0, 1.0)), md) + flow(h, at(vec2(-1.0, 1.0)), md)
                + flow(h, at(vec2(1.0, -1.0)), md) + flow(h, at(vec2(-1.0, -1.0)), md);
        gl_FragColor = vec4(encode(h + f * 0.1), 0.0, 0.0, 1.0);
      }`,
  });
  const queued = [], queuedHeaps = [];
  function addStroke(ax, az, bx, bz, radius, depth, rim, pit) {
    if (queued.length < MAX_STROKE) queued.push([ax, az, bx, bz, radius, depth, rim, pit]);
  }
  function addHeap(x, z, radius, height) {
    if (queuedHeaps.length < MAX_HEAP) queuedHeaps.push([x, z, radius, height]);
  }

  const fieldUniforms = { uField: { value: fieldA.texture }, uFieldRect: { value: RECT } };
  const common = Object.assign({
    uNoise: { value: noiseTex }, uTime: { value: 0 }, uMusic: { value: new THREE.Vector3() },
    uRipple: { value: rippleRT.texture }, uRippleRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
    uWind: { value: new THREE.Vector4(WIND.x, WIND.y, 0, 0) },
    uDrift: { value: new THREE.Vector2() },     // how far the blown sand has streamed, and how hard it blows
  }, lightUniforms, fieldUniforms);

  const FIELD_GLSL = `
    uniform sampler2D uField; uniform vec3 uFieldRect;
    uniform sampler2D uNoise;
    uniform vec4 uWind;          // downwind x, z; how far the ripples have crept; how far the dunes have moved
    float fieldAt(vec2 xz) {
      vec2 uv = (xz - uFieldRect.xy) / uFieldRect.z;
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      float v = texture2D(uField, uv).r;
      return ${DEC} * inside;
    }
    // the dunes: long gentle windward slopes and short steep lee faces, low in
    // the middle where fingers draw and taller further out
    float duneAt(vec2 xz) {
      vec2 p = xz - uWind.xy * uWind.w;
      float s = dot(p, uWind.xy) / 7.5 + texture2D(uNoise, p / 53.0).r * 2.2;
      float u = fract(s);
      float prof = u < 0.75 ? smoothstep(0.0, 1.0, u / 0.75) : smoothstep(0.0, 1.0, (1.0 - u) / 0.25);
      float vary = 0.5 + texture2D(uNoise, p / 37.0 + 0.3).g;
      return (prof - 0.5) * (0.14 + 0.32 * smoothstep(4.0, 14.0, length(xz))) * vary;
    }
  `;

  const sandMat = new THREE.ShaderMaterial({
    uniforms: common,
    extensions: { derivatives: true },
    vertexShader: `
      varying vec3 vWorld;
      ${FIELD_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // the dunes flatten toward the edge of the near sand, which the far sand meets flat
        float edge = 1.0 - smoothstep(15.0, 17.8, max(abs(w.x), abs(w.z)));
        w.y += fieldAt(w.xz) + duneAt(w.xz) * edge;
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D uRipple; uniform vec3 uRippleRect;
      uniform float uTime; uniform vec3 uMusic; uniform vec2 uDrift;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vWorld;
      ${FIELD_GLSL}
      ${TONEMAP}
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
      // the wind's ripples: long crests across the wind, bent by a slow noise,
      // creeping downwind while a gust blows
      float ripples(vec2 xz) {
        float warp = texture2D(uNoise, xz / 23.0).r * 6.0;
        return 0.012 * sin(dot(xz, uWind.xy) * 15.0 + warp * 2.2 - uWind.z);
      }
      void main() {
        vec2 xz = vWorld.xz;
        float e = 0.05;
        float h0 = fieldAt(xz);
        float hx = fieldAt(xz + vec2(e, 0.0)) - fieldAt(xz - vec2(e, 0.0));
        float hz = fieldAt(xz + vec2(0.0, e)) - fieldAt(xz - vec2(0.0, e));
        float ed = 0.15;
        float dx = duneAt(xz + vec2(ed, 0.0)) - duneAt(xz - vec2(ed, 0.0));
        float dz = duneAt(xz + vec2(0.0, ed)) - duneAt(xz - vec2(0.0, ed));
        // where a groove or a heap is, the wind's ripples are gone
        float drawn = smoothstep(0.002, 0.012, abs(h0));
        float rx = ripples(xz + vec2(e, 0.0)) - ripples(xz - vec2(e, 0.0)), rz = ripples(xz + vec2(0.0, e)) - ripples(xz - vec2(0.0, e));
        vec2 slope = vec2(hx, hz) / (2.0 * e) + vec2(dx, dz) / (2.0 * ed) + vec2(rx, rz) / (2.0 * e) * (1.0 - drawn);
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        // grain-sized roughness in the normal, so the sand reads as sand
        vec2 gr = hash22(floor(xz * 140.0)) - 0.5;
        vec3 nGrain = normalize(n + vec3(gr.x, 0.0, gr.y) * 0.25);

        float fine = texture2D(uNoise, xz / 3.0).b * 0.6 + texture2D(uNoise, xz / 0.9).b * 0.4;
        vec3 sand = mix(vec3(0.72, 0.48, 0.24), vec3(0.88, 0.64, 0.36), fine);
        sand = mix(sand, sand * vec3(0.92, 0.88, 0.85), texture2D(uNoise, xz / 17.0).g * 0.6);
        // a pit's floor sits in shadow, deeper the deeper it goes
        float ao = clamp(1.0 + min(h0, 0.0) * 5.0, 0.45, 1.0);

        vec3 V = normalize(cameraPosition - vWorld);
        float lam = max(dot(nGrain, uSunDir), 0.0);
        vec3 lit = sand * (uAmbient * 0.6 + uSunCol * lam * 0.75) * ao;
        // a soft sheen where the sand faces away from the sun's mirror, as Journey's
        float sheen = pow(max(dot(reflect(-V, n), uSunDir), 0.0), 18.0);
        lit += uSunCol * sheen * 0.08;

        // glitter: each grain cell has its own facet; it flashes when the facet
        // mirrors the sun into the eye. More grains wake with the high notes,
        // and the plucked strings' rings make their colour glitter
        vec2 cell = floor(xz * 17.0);
        vec2 hr = hash22(cell + 7.0);
        float t = uTime * 0.25 + hash12(cell) * 6.2831;
        vec3 facet = normalize(vec3((hr.x - 0.5) * 1.6 + 0.15 * sin(t), 0.8, (hr.y - 0.5) * 1.6 + 0.15 * cos(t)));
        float flash = pow(max(dot(reflect(-V, facet), uSunDir), 0.0), 60.0);
        vec2 ruv = (xz - uRippleRect.xy) / uRippleRect.z;
        vec3 ring = texture2D(uRipple, ruv).rgb;
        float wake = step(0.70 - uMusic.z * 0.12 - length(ring) * 0.3, hash12(cell + 3.1));
        vec2 inCell = fract(xz * 17.0) - 0.5;
        float dotShape = smoothstep(0.42, 0.05, length(inCell + (hr - 0.5) * 0.25));
        float px = fwidth(xz.x * 17.0);
        float sharp = 1.0 - smoothstep(0.6, 1.4, px);             // fade glints too small to draw
        vec3 glint = mix(uSunCol, ring * 3.0 + uSunCol * 0.3, clamp(length(ring) * 2.0, 0.0, 1.0));
        lit += glint * flash * wake * dotShape * sharp * 6.0 * ao;
        lit += ring * 0.25 * (0.5 + 0.5 * dotShape);               // and a faint tint where a ring passes

        // in a gust, pale wisps of blown sand stream low across the ground
        if (uDrift.y > 0.01) {
          vec2 across = vec2(-uWind.y, uWind.x);
          float al = dot(xz, uWind.xy), ac = dot(xz, across);
          float wisp = smoothstep(0.54, 0.7, texture2D(uNoise, vec2((al - uDrift.x) / 7.0, ac / 1.6)).a);
          wisp *= smoothstep(0.3, 0.42, texture2D(uNoise, vec2((al - uDrift.x * 0.55) / 31.0, ac / 9.0)).r);
          lit = mix(lit, lit * 1.3 + uSunCol * 0.05, wisp * uDrift.y * 0.6);
        }

        float fog = 1.0 - exp(-uFogDensity * 0.6 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 320, 320), sandMat);
  sand.rotation.x = -Math.PI / 2;
  group.add(sand);
  const far = new THREE.Mesh(new THREE.RingGeometry(SIZE * 0.5 * Math.SQRT2, 160, 4, 1, Math.PI / 4), sandMat);
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.003;
  group.add(far);

  // ---- grains on the wind: they hop low along the sand, many in a gust ----
  const GRAINS = 700, GRAIN_REACH = 9;
  const grainGeo = new THREE.BufferGeometry();
  const gPos = new Float32Array(GRAINS * 3);
  const gSpeed = new Float32Array(GRAINS), gHop = new Float32Array(GRAINS), gPhase = new Float32Array(GRAINS);
  for (let i = 0; i < GRAINS; i++) {
    gPos[i * 3] = (Math.random() - 0.5) * 2 * GRAIN_REACH;
    gPos[i * 3 + 2] = (Math.random() - 0.5) * 2 * GRAIN_REACH;
    gSpeed[i] = 0.6 + 0.8 * Math.random();
    gHop[i] = 0.02 + 0.2 * Math.pow(Math.random(), 2);
    gPhase[i] = Math.random() * Math.PI * 2;
  }
  grainGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3));
  const grainMat = new THREE.PointsMaterial({
    size: 0.08, map: dotTex, color: new THREE.Color(0.95, 0.8, 0.58), transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0.6,
  });
  const grains = new THREE.Points(grainGeo, grainMat);
  grains.frustumCulled = false;
  group.add(grains);

  // ---- the wind: a light breeze, and a gust every minute or so ----
  let gustClock = 0, gustAt = 12 + Math.random() * 15, gust = 0;
  const GUST_SECONDS = 10;
  function blow(dt) {
    gustClock += dt;
    const u = (gustClock - gustAt) / GUST_SECONDS;
    gust = u > 0 && u < 1 ? Math.pow(Math.sin(Math.PI * u), 2) : 0;
    if (u >= 1) { gustClock = 0; gustAt = 40 + Math.random() * 40; }
    const w = common.uWind.value;
    w.z += dt * (0.02 + 0.55 * gust);       // the ripples creep a third of a crest per gust
    w.w += dt * 0.08 * gust;                // the dunes move under half a metre
    common.uDrift.value.set(common.uDrift.value.x + dt * (0.5 + 2.6 * gust), gust);
    return gust;
  }

  function moveGrains(dt, strength) {
    const cx = currentLook.x, cz = currentLook.z, R = GRAIN_REACH;
    const speed = 0.5 + 2.6 * strength;
    for (let i = 0; i < GRAINS; i++) {
      let x = gPos[i * 3] + WIND.x * speed * gSpeed[i] * dt;
      let z = gPos[i * 3 + 2] + WIND.y * speed * gSpeed[i] * dt;
      // along and across the wind, from the middle of the view
      let a = (x - cx) * WIND.x + (z - cz) * WIND.y;
      let b = -(x - cx) * WIND.y + (z - cz) * WIND.x;
      if (a > R || a < -R || b > R || b < -R) {
        a = a > R ? a - 2 * R : a < -R ? a + 2 * R : a;
        if (b > R || b < -R) b = (Math.random() - 0.5) * 2 * R;
        x = cx + a * WIND.x - b * WIND.y;
        z = cz + a * WIND.y + b * WIND.x;
      }
      gPhase[i] += dt * (3 + 4 * gSpeed[i]) * (0.5 + strength);
      gPos[i * 3] = x; gPos[i * 3 + 2] = z;
      gPos[i * 3 + 1] = 0.01 + gHop[i] * Math.abs(Math.sin(gPhase[i])) * (0.35 + 0.65 * strength);
    }
    grainGeo.attributes.position.needsUpdate = true;
    grainGeo.setDrawRange(0, Math.floor(GRAINS * (0.08 + 0.92 * strength)));
    // lit like the sand around them, so they do not glow at night
    const s = lightUniforms.uSunCol.value, am = lightUniforms.uAmbient.value;
    grainMat.color.setRGB(1.15 * (am.r * 0.6 + s.r * 0.75), 1.0 * (am.g * 0.6 + s.g * 0.75), 0.78 * (am.b * 0.6 + s.b * 0.75));
    grainMat.opacity = 0.45 + 0.4 * strength;
  }

  // ---- the frame ----------------------------------------------------------------
  let erasing = 0, grainTime = 0, settling = 0, wear = 0;
  const SAND = [0.72, 0.58, 0.40];
  const hands = new WeakMap();             // what each finger has dug and is carrying
  function update(dt, touches, time) {
    common.uTime.value = time;
    common.uMusic.value.copy(music);
    const viewScale = viewScaleNow();
    const wind = blow(dt);
    moveGrains(dt, wind);

    grainTime += dt;
    const spray = grainTime > 0.05;
    for (const t of touches) {
      let st = hands.get(t.finger);
      if (!st) { st = { dig: 0, load: 0 }; hands.set(t.finger, st); }
      // a light touch draws a fine line; pressed in, the finger is a wide deep blade
      const radius = 0.12 * viewScale * (1 + 0.9 * t.depth);
      const depth = 0.035 + 0.12 * t.depth;
      const mx = t.x - t.px, mz = t.z - t.pz, moved = Math.hypot(mx, mz);
      if (t.speed < 0.3) {
        // resting: it digs, slower the deeper it is, down to about a metre and a quarter
        const before = st.dig;
        st.dig = Math.min(MAX_DIG, st.dig + dt * 0.32 * t.depth * (1 - 0.5 * st.dig / MAX_DIG));
        if (spray && st.dig > before + 1e-4) burst({ x: t.x, y: 0, z: t.z }, SAND, 0.2 + st.dig * 0.6, "sand", 2);
      } else {
        // moving: it climbs out of its pit (whose sand is already in the rim) and
        // pushes the sand it cuts ahead of it; a dragged hand gathers more than
        // the groove it leaves, and spills little
        st.dig *= Math.exp(-moved / 0.35);
        st.load = st.load * Math.exp(-moved / 12) + 2 * moved * (4 / 3) * radius * depth * (0.15 + 0.85 * t.depth);
      }
      addStroke(t.px, t.pz, t.x, t.z, radius, depth, depth * 0.45 + st.dig * 0.3, st.dig);
      if (moved > 1e-4 && st.load > 0) {
        // a heap about as steep as sand stands, holding what the finger carries
        const a = Math.min(MAX_HEAP_RADIUS, Math.cbrt(st.load / 0.45));
        if (a > 0.08) {
          const ahead = radius + st.dig / (REPOSE * 0.9) + a * 0.7;
          addHeap(t.x + mx / moved * ahead, t.z + mz / moved * ahead, a, 0.43 * a);
        }
      }
      if (t.speed > 0.6 && spray) burst({ x: t.x, y: 0, z: t.z }, SAND, 0.15, "sand", 3);
    }
    if (spray) grainTime = 0;

    let eraseNow = 0;
    if (erasing > 0) { eraseNow = 1 - Math.exp(-dt / 0.22); erasing -= dt; }
    // a gust wears the drawing by about 5%, in a dozen small steps: a half-float
    // target rounds toward zero, so wearing a little every frame would lose a
    // whole step of precision each time and flatten everything
    wear += 0.01 * wind * dt;
    if (wear > 0.004) { eraseNow = 1 - (1 - eraseNow) * (1 - wear); wear = 0; }
    let n = 0;
    for (const q of queued) {
      strokes[n].set(q[0], q[1], q[2], q[3]);
      shapes[n].set(q[4], q[5], q[6], q[7]);
      n++;
    }
    queued.length = 0;
    let m = 0;
    for (const q of queuedHeaps) heaps[m++].set(q[0], q[1], q[2], q[3]);
    queuedHeaps.length = 0;
    if (n > 0 || m > 0 || eraseNow > 0 || drawMat.uniforms.uInit.value > 0) {
      drawMat.uniforms.uCount.value = n;
      drawMat.uniforms.uHeapCount.value = m;
      drawMat.uniforms.uErase.value = eraseNow;
      pass(drawMat);
      drawMat.uniforms.uInit.value = 0;
      settling = 3;                         // and keep slumping a while after
    }
    if (settling > 0) {
      settling -= dt;
      pass(slumpMat);
      pass(slumpMat);
    }
  }
  function pass(mat) {
    mat.uniforms.uPrev.value = fieldA.texture;
    passQuad.material = mat;
    renderer.setRenderTarget(fieldB);
    renderer.render(passScene, passCam);
    renderer.setRenderTarget(null);
    [fieldA, fieldB] = [fieldB, fieldA];
    fieldUniforms.uField.value = fieldA.texture;
  }

  return {
    id: "sand", name: "Sand", group,
    chords: [[2, 0], [11, 1], [7, 0], [9, 0]],          // D Bm G A: I vi IV V, the fifties doo-wop turn
    sound: { voice: 5, ring: 5, wet: 0.42 },
    touchHeight: 0.0, glowHeight: 0.04,
    resize() {},
    update,
    tune() {},
    enter() {},
    exit() {},
    tap(f) {
      addStroke(f.world.x, f.world.z, f.world.x, f.world.z, 0.2, 0.06, 0.03, 0);
      burst(f.world, SAND, 0.5, "sand", 18);
    },
    pluck() {},
    // wiped like an Etch A Sketch: the sand settles flat over about a second,
    // grains spraying up across the view
    erase() {
      erasing = 1.1;
      for (let k = 0; k < 10; k++) {
        const p = { x: camera.position.x + (Math.random() - 0.5) * 8, y: 0, z: camera.position.z - 2 + (Math.random() - 0.5) * 8 };
        burst(p, SAND, 0.8, "sand", 10);
      }
    },
    // for testing: the wind's state, and a gust on demand
    stats() { return { drawing: floatTargets ? "half" : "8-bit", gust: +gust.toFixed(2) }; },
    gustNow() { gustAt = gustClock; },
    field() { return fieldA; },
  };
})();
