// ---- scene: sand ------------------------------------------------------------------
// Fine glittering sand, as in a zen garden or an Etch A Sketch: a finger draws a
// groove that stays, with the sand it moved heaped along both sides; a tap
// leaves a pit and kicks up grains; every plucked string sends a ring of
// glitter in its plate's colour. The drawing stays until it is wiped: three
// fingers landing together, or shaking the phone where the browser reports
// motion. The wind's ripples cover everything a groove has not cut through.
//
// The grooves live in a half-float height field that is never faded (or an
// 8-bit one, coarser, where half floats cannot be drawn into). The glitter is
// the trick from Journey's sand (Alan Zucconi's write-up): every grain has its
// own tilt, and a grain flashes when that tilt mirrors the sun into the eye.
const sandScene = (() => {
  const group = new THREE.Group();
  const SIZE = 36, RES = 512;
  const RECT = new THREE.Vector3(-SIZE / 2, -SIZE / 2, SIZE);
  const MAX_STROKE = 12;
  const TONEMAP = "vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }";

  // ---- the drawing: height of the sand where fingers have been ----
  function fieldTarget() {
    return new THREE.WebGLRenderTarget(RES, RES, {
      type: floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
    });
  }
  let fieldA = fieldTarget(), fieldB = fieldTarget();
  // 8-bit targets store height + 0.5 scaled by 4, so grooves and heaps both fit
  const ENC = floatTargets ? "h" : "(h * 4.0 + 0.5)";
  const DEC = floatTargets ? "v" : "((v - 0.5) / 4.0)";
  const strokes = Array.from({ length: MAX_STROKE }, () => new THREE.Vector4());   // from x, z, to x, z
  const shapes = Array.from({ length: MAX_STROKE }, () => new THREE.Vector4());    // radius, depth, heap, kind (0 groove, 1 pit)
  const drawMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: {
      uPrev: { value: null }, uInit: { value: 1 }, uErase: { value: 0 },
      uCount: { value: 0 }, uStroke: { value: strokes }, uShape: { value: shapes }, uRect: { value: RECT },
    },
    fragmentShader: `
      uniform sampler2D uPrev; uniform float uInit, uErase; uniform int uCount;
      uniform vec4 uStroke[${MAX_STROKE}]; uniform vec4 uShape[${MAX_STROKE}]; uniform vec3 uRect;
      varying vec2 vUv;
      float decode(float v) { return ${DEC}; }
      float encode(float h) { return ${ENC}; }
      void main() {
        float h = decode(texture2D(uPrev, vUv).r) * (1.0 - uInit);
        h *= 1.0 - uErase;                                       // a shake smooths it all away
        vec2 w = uRect.xy + vUv * uRect.z;
        for (int i = 0; i < ${MAX_STROKE}; i++) {
          if (i >= uCount) break;
          vec2 a = uStroke[i].xy, b = uStroke[i].zw;
          vec2 ab = b - a;
          float t = clamp(dot(w - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
          float d = length(w - (a + ab * t)) / uShape[i].x;       // distance from the finger's path, in radii
          // the trough under the finger: never deeper than the finger presses
          float trough = -uShape[i].y * max(1.0 - d * d, 0.0);
          if (d < 1.0) h = min(h, trough);
          // the sand it pushed aside, heaped along both edges
          float heap = uShape[i].z * sin(3.14159 * clamp((d - 0.85) / 0.9, 0.0, 1.0));
          // only on sand nobody has drawn in yet: a new stretch of groove must not
          // wall off the groove it continues, or a line becomes a row of beads
          if (d > 0.85 && d < 1.75 && h > -0.002) h = max(h, heap);
        }
        gl_FragColor = vec4(encode(h), 0.0, 0.0, 1.0);
      }`,
  });
  const queued = [];
  function addStroke(ax, az, bx, bz, radius, depth, heap) {
    if (queued.length < MAX_STROKE) queued.push([ax, az, bx, bz, radius, depth, heap]);
  }

  const fieldUniforms = { uField: { value: fieldA.texture }, uFieldRect: { value: RECT } };
  const common = Object.assign({
    uNoise: { value: noiseTex }, uTime: { value: 0 }, uMusic: { value: new THREE.Vector3() },
    uRipple: { value: rippleRT.texture }, uRippleRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
  }, lightUniforms, fieldUniforms);

  const FIELD_GLSL = `
    uniform sampler2D uField; uniform vec3 uFieldRect;
    float fieldAt(vec2 xz) {
      vec2 uv = (xz - uFieldRect.xy) / uFieldRect.z;
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      float v = texture2D(uField, uv).r;
      return ${DEC} * inside;
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
        w.y += fieldAt(w.xz);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform sampler2D uRipple; uniform vec3 uRippleRect;
      uniform float uTime; uniform vec3 uMusic;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
      varying vec3 vWorld;
      ${FIELD_GLSL}
      ${TONEMAP}
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
      // the wind's ripples: long crests, bent by a slow noise
      float ripples(vec2 xz) {
        float warp = texture2D(uNoise, xz / 23.0).r * 6.0;
        return 0.012 * sin(dot(xz, vec2(0.62, 0.78)) * 15.0 + warp * 2.2);
      }
      void main() {
        vec2 xz = vWorld.xz;
        float e = 0.05;
        float h0 = fieldAt(xz);
        float hx = fieldAt(xz + vec2(e, 0.0)) - fieldAt(xz - vec2(e, 0.0));
        float hz = fieldAt(xz + vec2(0.0, e)) - fieldAt(xz - vec2(0.0, e));
        // where a groove or a heap is, the wind's ripples are gone
        float drawn = smoothstep(0.002, 0.012, abs(h0));
        float r0 = ripples(xz), rx = ripples(xz + vec2(e, 0.0)) - ripples(xz - vec2(e, 0.0)), rz = ripples(xz + vec2(0.0, e)) - ripples(xz - vec2(0.0, e));
        vec2 slope = vec2(hx, hz) / (2.0 * e) + vec2(rx, rz) / (2.0 * e) * (1.0 - drawn);
        vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
        // grain-sized roughness in the normal, so the sand reads as sand
        vec2 gr = hash22(floor(xz * 140.0)) - 0.5;
        vec3 nGrain = normalize(n + vec3(gr.x, 0.0, gr.y) * 0.25);

        float fine = texture2D(uNoise, xz / 3.0).b * 0.6 + texture2D(uNoise, xz / 0.9).b * 0.4;
        vec3 sand = mix(vec3(0.72, 0.48, 0.24), vec3(0.88, 0.64, 0.36), fine);
        sand = mix(sand, sand * vec3(0.92, 0.88, 0.85), texture2D(uNoise, xz / 17.0).g * 0.6);
        float ao = clamp(1.0 + h0 * 7.0, 0.55, 1.0);              // a groove's floor sits in shadow

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
        lit += glint * flash * wake * dotShape * sharp * 6.0;
        lit += ring * 0.25 * (0.5 + 0.5 * dotShape);               // and a faint tint where a ring passes

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

  // ---- the frame ----------------------------------------------------------------
  let erasing = 0, grainTime = 0;
  const SAND = [0.72, 0.58, 0.40];
  function update(dt, touches, time) {
    common.uTime.value = time;
    common.uMusic.value.copy(music);
    const viewScale = clamp(camera.position.y / 11, 0.6, 1.6);
    // each finger draws from where it was to where it is
    grainTime += dt;
    for (const t of touches) {
      const radius = 0.12 * viewScale * (1 + 0.6 * t.depth);
      const depth = 0.035 + 0.045 * t.depth;
      addStroke(t.px, t.pz, t.x, t.z, radius, depth, depth * 0.45);
      if (t.speed > 0.6 && grainTime > 0.05) burst({ x: t.x, y: 0, z: t.z }, SAND, 0.15, "sand", 3);
    }
    if (grainTime > 0.05) grainTime = 0;

    let eraseNow = 0;
    if (erasing > 0) { eraseNow = 1 - Math.exp(-dt / 0.22); erasing -= dt; }
    let n = 0;
    for (const q of queued) {
      strokes[n].set(q[0], q[1], q[2], q[3]);
      shapes[n].set(q[4], q[5], q[6], 0);
      n++;
    }
    queued.length = 0;
    if (n > 0 || eraseNow > 0 || drawMat.uniforms.uInit.value > 0) {
      drawMat.uniforms.uCount.value = n;
      drawMat.uniforms.uErase.value = eraseNow;
      drawMat.uniforms.uPrev.value = fieldA.texture;
      passQuad.material = drawMat;
      renderer.setRenderTarget(fieldB);
      renderer.render(passScene, passCam);
      renderer.setRenderTarget(null);
      drawMat.uniforms.uInit.value = 0;
      [fieldA, fieldB] = [fieldB, fieldA];
      fieldUniforms.uField.value = fieldA.texture;
    }
  }

  return {
    id: "sand", name: "Sand", group,
    sound: { voice: 4, ring: 4.5, wet: 0.40 },
    touchHeight: 0.0, glowHeight: 0.04,
    resize() {},
    update,
    tune() {},
    enter() {},
    exit() {},
    tap(f) {
      addStroke(f.world.x, f.world.z, f.world.x, f.world.z, 0.2, 0.06, 0.03);
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
    stats() { return { drawing: floatTargets ? "half" : "8-bit" }; },
  };
})();
