// ---- scene: clouds ----------------------------------------------------------------
// Above a sea of cumulus, with the land far below. Where a finger lands decides
// what it does: on open sky it draws new cloud along its path; on a cloud it
// pulls the cloud along with it, and the cloud thins out as it is stretched; a
// poke into a cloud opens a hole, and a finger left resting there keeps
// widening it, the cloud pushed aside into a ring. The clouds drift on the wind,
// their tops slowly boiling, and the plucked strings' rings glow in them.
//
// How it is drawn: a density field (half float, wrapping, so the clouds that
// drift off one side come back on the other) holds what fingers have made. A
// second pass turns density into a cloud shape (height, with noise for the
// cauliflower tops) and lights it: sun on the slopes, self-shadow toward the
// sun, darker hollows. Each pixel then marches its view ray down through the
// shape: a thick cloud turns opaque within a metre, a stretched one is shallow
// and stays sheer. (Stacked slices were tried first; seen at a slant they
// stepped like terraces.) The field is never advected by the wind; it is drawn
// at an offset instead, so drifting costs nothing and blurs nothing.
const cloudScene = (() => {
  const group = new THREE.Group();
  const SIZE = 48, RES = 256, SHAPE_RES = 512;
  const TOP = 3.6, MARCH_STEPS = 16;        // the cloud layer's depth, and the steps a ray takes through it
  const GROUND = -30;                        // the land, far below
  const MAX_EDIT = 10;
  const WIND = new THREE.Vector2(0.8, 0.6), DRIFT = 0.22;   // metres a second
  const TONEMAP = "vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }";

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
          float a = texture2D(uNoise, vUv).a, b = texture2D(uNoise, vUv * 2.0).b;
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

  // ---- the shape: height of the cloud tops, and how they are lit ----
  const shapeMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: Object.assign({ uField: { value: fieldA.texture }, uNoise: { value: noiseTex }, uTime: { value: 0 }, uSize: { value: SIZE } }, lightUniforms),
    fragmentShader: `
      uniform sampler2D uField, uNoise; uniform float uTime, uSize;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      float heightAt(vec2 uv) {
        float v = texture2D(uField, uv).r;
        float d = ${DEC};
        // the tops boil slowly: noise drifting two ways (whole-number scales, so it wraps with the field)
        vec2 drift = vec2(uTime * 0.0021, uTime * 0.0013);
        float n = texture2D(uNoise, uv * 3.0 + drift).b * 0.55 + texture2D(uNoise, uv * 7.0 - drift * 1.7).b * 0.33
                + texture2D(uNoise, uv * 19.0 + drift * 2.3).b * 0.12;
        // rounded heaps, not peaks: height rises fast at a cloud's edge and
        // flattens over its middle, as a cumulus does
        float x = max(0.0, d * (0.45 + 1.1 * n) - 0.1);
        return 3.2 * pow(x, 0.7);
      }
      void main() {
        float e = 1.5 / ${SHAPE_RES}.0;
        float h = heightAt(vUv);
        float hx = heightAt(vUv + vec2(e, 0.0)) - heightAt(vUv - vec2(e, 0.0));
        float hz = heightAt(vUv + vec2(0.0, e)) - heightAt(vUv - vec2(0.0, e));
        vec3 n = normalize(vec3(-hx / (2.0 * e * uSize), 1.0, -hz / (2.0 * e * uSize)));
        float lam = dot(n, uSunDir) * 0.5 + 0.5;                 // wrapped: clouds scatter light round their sides
        // self-shadow: is there taller cloud between here and the sun?
        vec2 toward = uSunDir.xz / max(length(uSunDir.xz), 1e-3);
        float rise = uSunDir.y / max(length(uSunDir.xz), 0.05);
        float shade = 0.0;
        for (int k = 1; k <= 3; k++) {
          float dist = float(k) * 0.6;
          float above = heightAt(vUv + toward * dist / uSize) - (h + dist * rise);
          shade = max(shade, smoothstep(0.0, 0.6, above));
        }
        // hollows: lower than the cloud around them
        float around = (heightAt(vUv + vec2(4.0 * e, 0.0)) + heightAt(vUv - vec2(4.0 * e, 0.0))
                      + heightAt(vUv + vec2(0.0, 4.0 * e)) + heightAt(vUv - vec2(0.0, 4.0 * e))) * 0.25;
        float hollow = clamp(1.0 - (around - h) * 1.2, 0.0, 1.0);
        gl_FragColor = vec4(h / 3.0, lam * (1.0 - 0.55 * shade), hollow, 1.0);
      }`,
  });

  // ---- the volume: rays marched down through the shape ----
  // One sheet over the top of the cloud layer; each pixel follows its view ray
  // down through the layer in a fixed number of steps (offset a little per
  // pixel, so the steps blur into a volume), gathering light where the ray is
  // inside a cloud, until the cloud is opaque or the ray reaches the base.
  const offset = new THREE.Vector2();
  const marchUniforms = Object.assign({
    uShapeTex: { value: shapeRT.texture }, uOffset: { value: offset }, uSize: { value: SIZE },
    uRipple: { value: rippleRT.texture }, uRippleRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
    uMusic: { value: new THREE.Vector3() },
  }, lightUniforms);
  const marchMat = new THREE.ShaderMaterial({
    uniforms: marchUniforms,
    transparent: true, depthWrite: false,
    vertexShader: `
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D uShapeTex, uRipple; uniform vec2 uOffset; uniform float uSize;
      uniform vec3 uRippleRect, uMusic;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        vec3 rd = normalize(vWorld - cameraPosition);
        vec2 toward = uSunDir.xz / max(length(uSunDir.xz), 1e-3);
        float rise = uSunDir.y / max(length(uSunDir.xz), 0.05);
        if (rd.y > -0.02) discard;
        float t0 = max((${TOP.toFixed(2)} - cameraPosition.y) / rd.y, 0.0);
        float t1 = -cameraPosition.y / rd.y;
        float dt = (t1 - t0) / ${MARCH_STEPS}.0;
        float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 col = vec3(0.0);
        float trans = 1.0, hitT = t1;
        for (int i = 0; i < ${MARCH_STEPS}; i++) {
          float t = t0 + (float(i) + jitter) * dt;
          vec3 p = cameraPosition + rd * t;
          vec4 s = texture2D(uShapeTex, (p.xz - uOffset) / uSize);
          float h = s.r * 3.0;
          float inside = h - p.y;
          if (inside > 0.0) {
            // a thick cloud fills up within a metre; a thin one stays sheer
            float a = 1.0 - exp(-2.4 * dt * smoothstep(0.0, 0.5, inside) * min(1.0, h / 0.6 + 0.25));
            float top = clamp(p.y / max(h, 0.01), 0.0, 1.0);
            // one step toward the sun: how much cloud stands between this point
            // and the light. Sunlit tops go white, the far sides and the bases
            // fall into the sky's blue
            float hs = texture2D(uShapeTex, (p.xz + toward * 0.7 - uOffset) / uSize).r * 3.0;
            float sunVis = exp(-2.2 * max(0.0, hs - (p.y + 0.7 * rise))) * mix(0.55, 1.0, s.g);
            vec3 lit = uSunCol * (0.05 + 1.35 * sunVis) + uAmbient * (0.4 + 0.45 * top);
            lit *= mix(0.6, 1.0, top) * mix(0.65, 1.0, s.b);
            if (trans > 0.99) hitT = t;
            col += trans * a * lit;
            trans *= 1.0 - a;
            if (trans < 0.02) break;
          }
        }
        if (trans > 0.995) discard;
        float alpha = 1.0 - trans;
        col /= alpha;
        vec3 hit = cameraPosition + rd * hitT;
        vec3 ring = texture2D(uRipple, (hit.xz - uRippleRect.xy) / uRippleRect.z).rgb;
        col += ring * (0.5 + 0.4 * uMusic.z);
        float fog = 1.0 - exp(-uFogDensity * 0.5 * hitT);
        gl_FragColor = vec4(pow(tonemap(mix(col, uFogCol, fog)), vec3(1.0 / 2.2)), alpha);
      }`,
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), marchMat);
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = TOP;
  sheet.renderOrder = 10;
  group.add(sheet);

  // ---- the land far below, seen through the holes, under the clouds' shadows ----
  const groundMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uNoise: { value: noiseTex }, uShapeTex: { value: shapeRT.texture }, uOffset: { value: offset }, uSize: { value: SIZE } }, lightUniforms),
    vertexShader: `
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D uNoise, uShapeTex; uniform vec2 uOffset; uniform float uSize;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vWorld;
      ${TONEMAP}
      void main() {
        vec2 xz = vWorld.xz;
        float land = texture2D(uNoise, xz / 260.0).g + (texture2D(uNoise, xz / 70.0).b - 0.5) * 0.25;
        float shore = smoothstep(0.47, 0.5, land);
        vec3 sea = mix(vec3(0.06, 0.18, 0.30), vec3(0.08, 0.24, 0.34), texture2D(uNoise, xz / 90.0).r * 0.5);
        float fields = texture2D(uNoise, xz / 22.0).b;
        vec3 earth = mix(vec3(0.20, 0.32, 0.12), vec3(0.42, 0.40, 0.20), fields);
        earth = mix(earth, vec3(0.14, 0.24, 0.10), smoothstep(0.55, 0.65, texture2D(uNoise, xz / 40.0).g));
        vec3 col = mix(sea, earth, shore);
        col = mix(col, vec3(0.62, 0.6, 0.5), 0.5 * smoothstep(0.47, 0.475, land) * (1.0 - smoothstep(0.477, 0.485, land)));
        // the clouds' shadows: follow the sun up to the cloud layer
        vec2 up = xz + uSunDir.xz / max(uSunDir.y, 0.15) * (${-GROUND}.0 + 1.0);
        float cloud = texture2D(uShapeTex, (up - uOffset) / uSize).r * 3.0;
        float lightHere = 1.0 - 0.6 * smoothstep(0.1, 0.8, cloud);
        vec3 lit = col * (uAmbient * 0.7 + uSunCol * max(uSunDir.y, 0.0) * 0.9 * lightHere);
        float fog = 1.0 - exp(-uFogDensity * 2.4 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND;
  ground.renderOrder = 0;
  group.add(ground);

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
    const viewScale = clamp(camera.position.y / 11, 0.6, 1.6);
    const frames = dt * 60;
    mistTime += dt;
    const mist = mistTime > 0.08;
    for (const t of touches) {
      const f = t.finger;
      const moved = Math.hypot(t.x - t.px, t.z - t.pz);
      if (!f.cloudMode) f.cloudMode = "sky";
      if (f.cloudMode === "sky") {
        edit(t.px, t.pz, t.x, t.z, 0.75 * viewScale * (1 + 0.5 * t.depth), 0, (0.07 + 0.05 * t.depth) * frames);
        if (mist && moved > 0.01) burst({ x: t.x, y: 1.2, z: t.z }, MIST, 0.15, "pollen", 2);
      } else if (moved > 0.004) {
        // pulling the cloud along; the faster the pull, the thinner it goes
        const R = 1.2 * viewScale * (1 + 0.4 * t.depth);
        edit(t.px, t.pz, t.x, t.z, R, 1, Math.min(moved / R, 1) * 0.3);
        f.holeTime = 0;
      } else if (t.speed < 0.3) {
        // resting in a cloud: the hole keeps opening, to about a metre and a half
        f.holeTime = (f.holeTime || 0) + dt;
        const r = (0.5 + 1.0 * smooth(0, 1, f.holeTime / 3)) * viewScale;
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
    sound: { voice: 6, ring: 6, wet: 0.5 },
    touchHeight: 1.2, glowHeight: 1.6,
    resize() {},
    update,
    tune() {},
    enter() {},
    exit() {},
    // where a finger lands decides what it does: open sky draws, a cloud is
    // pulled or, poked, opened
    tap(f) {
      const onCloud = cloudAt(f.world.x, f.world.z) > 0.25;
      f.cloudMode = onCloud ? "cloud" : "sky";
      f.holeTime = 0;
      if (onCloud) {
        edit(f.world.x, f.world.z, f.world.x, f.world.z, 0.6, 2, 0.45, 0.3);
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
