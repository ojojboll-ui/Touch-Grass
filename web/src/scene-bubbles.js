// ---- scene: bubbles ---------------------------------------------------------------
// Soap bubbles over a garden seen out of focus. A finger drawn across empty air
// lets bubbles go along its path, big when it moves slowly and small when it
// hurries; a finger held still blows one up under it until it lets go. Bubbles
// that meet stick together into foam and drift as a clump. A poke pops a bubble
// in a spray of droplets, and a finger dragged on from there herds the rest.
// Every plucked string makes the bubbles near it shiver, and the strings'
// rings run colour through their films. Three fingers pop them all.
//
// Each bubble is a sphere in one instanced mesh; its colour is thin-film
// interference: the film's thickness swirls over the surface and drains toward
// the bottom, the path through it grows as the view grazes, and red, green and
// blue fall in and out of step at different thicknesses. Mostly clear facing
// you, mostly reflection at the rim. The garden behind is never sharp: soft
// fields of colour and lens bokeh, all of it low frequency.
const bubbleScene = (() => {
  const group = new THREE.Group();
  const MAX = 160, LEVEL = 1.0, REACH = 9;   // how many, the height they float at, how far they may stray
  const TONEMAP = "vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }";

  // ---- the bubbles' state ----
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vz = new Float32Array(MAX);
  const rad = new Float32Array(MAX), grow = new Float32Array(MAX);      // radius, and the radius it is growing toward
  const age = new Float32Array(MAX), life = new Float32Array(MAX), phase = new Float32Array(MAX);
  const alive = new Uint8Array(MAX), held = new Uint8Array(MAX);
  const pop = new Float32Array(MAX);                                    // > 0 while popping: seconds left
  const wobble = new Float32Array(MAX);

  // ---- the mesh ----
  const geo = new THREE.SphereGeometry(1, 40, 20);
  const aFilm = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);   // thickness offset, swirl seed
  const aState = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);  // fade, wobble, wobble phase
  geo.setAttribute("aFilm", aFilm);
  geo.setAttribute("aState", aState);
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uNoise: { value: noiseTex }, uTime: { value: 0 },
      uRipple: { value: rippleRT.texture }, uRippleRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
    }, lightUniforms),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec2 aFilm; attribute vec3 aState;
      uniform float uTime;
      varying vec3 vWorld, vNormal, vLocal; varying vec2 vFilm; varying float vFade;
      void main() {
        vec3 p = position;
        // a shiver: the surface rings in a few lobes, dying away
        float lobes = sin(p.x * 3.0 + uTime * 11.0 + aState.z) * sin(p.y * 2.0 - uTime * 9.0) + sin(p.z * 4.0 + uTime * 13.0);
        p *= 1.0 + aState.y * 0.06 * lobes;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vLocal = position;
        vFilm = aFilm; vFade = aState.x;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D uNoise, uRipple; uniform float uTime; uniform vec3 uRippleRect;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol;
      varying vec3 vWorld, vNormal, vLocal; varying vec2 vFilm; varying float vFade;
      ${TONEMAP}
      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 V = normalize(cameraPosition - vWorld);
        float c = abs(dot(n, V));
        // the film: swirling, thinner at the top where it drains
        vec2 sw = vLocal.xz * 0.6 + vec2(vLocal.y * 0.3, 0.0) + vFilm.y + vec2(uTime * 0.013, -uTime * 0.009);
        float swirl = texture2D(uNoise, sw * 0.5).g * 0.75 + texture2D(uNoise, sw * 1.3 + 0.4).a * 0.25;
        float thick = 0.4 + 2.2 * swirl - 0.35 * vLocal.y + vFilm.x;
        float path = thick * (0.55 + 0.45 * c) * 2.2;
        vec3 film = 0.5 + 0.5 * cos(6.2831 * (path + vec3(0.0, 0.33, 0.67)));
        vec3 ring = texture2D(uRipple, (vWorld.xz - uRippleRect.xy) / uRippleRect.z).rgb;
        film = mix(film, film * 0.4 + ring * 1.6, clamp(length(ring) * 1.5, 0.0, 0.8));
        float fres = 0.05 + 0.95 * pow(1.0 - c, 3.5);
        // what it reflects: a bright sky above, the dim garden below, and the sun
        vec3 R = reflect(-V, n);
        vec3 env = mix(uFogCol * 0.35 + uAmbient * 0.2, uFogCol * 1.1 + uSunCol * 0.25, smoothstep(-0.2, 0.6, R.y));
        float spec = pow(max(dot(R, uSunDir), 0.0), 160.0) * 4.0 + pow(max(dot(R, uSunDir), 0.0), 12.0) * 0.25;
        vec3 col = film * env * 1.4 + uSunCol * spec;
        float alpha = clamp(fres * 0.8 + 0.05 + spec * 0.6, 0.0, 1.0) * vFade;
        gl_FragColor = vec4(pow(tonemap(col), vec3(1.0 / 2.2)), alpha);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  group.add(mesh);

  // ---- the garden behind, out of focus ----
  const gardenMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uNoise: { value: noiseTex }, uTime: { value: 0 } }, lightUniforms),
    vertexShader: `
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform float uTime;
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol;
      varying vec3 vWorld;
      ${TONEMAP}
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
      // lens bokeh: soft discs with a slightly brighter rim, one in some cells
      vec3 bokeh(vec2 xz, float cell, float keep, vec3 tint) {
        vec2 g = xz / cell, c = floor(g), f = fract(g);
        vec3 sum = vec3(0.0);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 k = c + vec2(float(i), float(j));
          float h = hash12(k);
          if (h < keep) continue;
          vec2 centre = vec2(float(i), float(j)) + hash22(k + 2.7);
          float r = 0.35 + 0.5 * hash12(k + 9.1);
          float d = length(f - centre) / r;
          float disc = smoothstep(1.0, 0.85, d) * (0.7 + 0.3 * smoothstep(0.5, 0.95, d));
          vec3 hue = mix(tint, vec3(1.0, 0.95, 0.85), hash12(k + 5.3));
          sum += hue * disc * (h - keep) / (1.0 - keep);
        }
        return sum;
      }
      void main() {
        vec2 xz = vWorld.xz + vec2(uTime * 0.05, uTime * 0.03);
        // soft fields of colour: leaves, a lawn, a flower bed, all melted together
        float n1 = texture2D(uNoise, xz / 55.0).g, n2 = texture2D(uNoise, xz / 38.0 + 0.3).r, n3 = texture2D(uNoise, xz / 80.0).a;
        vec3 leaves = mix(vec3(0.07, 0.16, 0.10), vec3(0.20, 0.36, 0.16), smoothstep(0.35, 0.65, n1));
        vec3 bloom = mix(vec3(0.55, 0.42, 0.20), vec3(0.42, 0.26, 0.40), smoothstep(0.25, 0.45, n2));
        vec3 col = mix(leaves, bloom, smoothstep(0.52, 0.66, n3) * 0.7);
        col *= uAmbient * 0.7 + uSunCol * 0.4 * max(uSunDir.y, 0.0);
        // bokeh: the sun glinting through leaves by day, lights at night
        float night = 1.0 - smoothstep(0.0, 0.25, uSunDir.y + 0.1);
        vec3 b = bokeh(xz, 4.5, 0.86, vec3(0.9, 0.95, 0.6)) + bokeh(xz + 11.0, 2.6, 0.9, vec3(0.6, 0.9, 1.0)) * 0.6;
        col += b * (uSunCol * 0.12 + vec3(1.0, 0.75, 0.45) * 0.3 * night);
        float fade = 1.0 - exp(-0.004 * length(vWorld - cameraPosition));
        gl_FragColor = vec4(pow(tonemap(mix(col, uFogCol * 0.6, fade)), vec3(1.0 / 2.2)), 1.0);
      }`,
  });
  const garden = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), gardenMat);
  garden.rotation.x = -Math.PI / 2;
  garden.position.y = -6;
  group.add(garden);

  // ---- making and popping ----
  function spawn(x, z, r, isHeld = false) {
    let k = -1;
    for (let i = 0; i < MAX; i++) if (!alive[i]) { k = i; break; }
    if (k < 0) {
      // full: the oldest that is not being blown goes
      let oldest = -1;
      for (let i = 0; i < MAX; i++) if (!held[i] && pop[i] <= 0 && (oldest < 0 || age[i] > age[oldest])) oldest = i;
      if (oldest < 0) return -1;
      popNow(oldest);
      return -1;
    }
    alive[k] = 1; held[k] = isHeld ? 1 : 0; pop[k] = 0;
    px[k] = x; pz[k] = z; py[k] = LEVEL;
    vx[k] = (Math.random() - 0.5) * 0.2; vz[k] = (Math.random() - 0.5) * 0.2;
    rad[k] = Math.min(r, 0.12); grow[k] = r;
    age[k] = 0; life[k] = 45 + Math.random() * 75; phase[k] = Math.random() * 6.28;
    wobble[k] = 0.6;
    aFilm.setXY(k, Math.random() * 0.8, Math.random() * 10);
    return k;
  }
  const filmRgb = (k) => {
    const t = aFilm.getX(k) * 2.2 + 1.3;
    return [0.5 + 0.5 * Math.cos(6.2831 * t), 0.5 + 0.5 * Math.cos(6.2831 * (t + 0.33)), 0.5 + 0.5 * Math.cos(6.2831 * (t + 0.67))];
  };
  function popNow(k) {
    if (!alive[k] || pop[k] > 0) return;
    pop[k] = 0.09; held[k] = 0;
    const r = rad[k];
    burst({ x: px[k], y: py[k] - r * 0.3, z: pz[k] }, filmRgb(k), 0.3 + 0.4 * r, "splash", 8 + Math.round(14 * r));
    // the neighbours feel it
    for (let i = 0; i < MAX; i++) {
      if (!alive[i] || i === k) continue;
      const d = Math.hypot(px[i] - px[k], pz[i] - pz[k]);
      if (d < (rad[i] + r) * 1.6) wobble[i] = Math.max(wobble[i], 0.8);
    }
  }
  function bubbleAt(x, z) {
    let best = -1, bestD = 1e9;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i] || pop[i] > 0) continue;
      const d = Math.hypot(px[i] - x, pz[i] - z) / rad[i];
      if (d < 1.05 && d < bestD) { best = i; bestD = d; }
    }
    return best;
  }

  // ---- the frame ----------------------------------------------------------------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  let popAll = 0;
  function update(dt, touches, time) {
    mat.uniforms.uTime.value = time;
    gardenMat.uniforms.uTime.value = time;
    const viewScale = viewScaleNow();

    // fingers: painting, blowing, herding
    for (const t of touches) {
      const f = t.finger;
      if (!f.bubbleMode) f.bubbleMode = "paint";
      const mx = t.x - t.px, mz = t.z - t.pz, moved = Math.hypot(mx, mz);
      if (f.bubbleMode === "herd") {
        for (let i = 0; i < MAX; i++) {
          if (!alive[i]) continue;
          const d = Math.hypot(px[i] - t.x, pz[i] - t.z);
          const w = Math.exp(-(d * d) / (1.2 * 1.2 * viewScale * viewScale));
          if (w > 0.01 && dt > 0) { vx[i] += (mx / dt - vx[i]) * w * 0.25; vz[i] += (mz / dt - vz[i]) * w * 0.25; }
        }
        continue;
      }
      const blowing = f.blowing != null && alive[f.blowing] && held[f.blowing] ? f.blowing : -1;
      if (moved > 0.01) {
        // painting: let the one being blown go, and leave bubbles along the way,
        // big for a slow finger and small for a quick one
        if (blowing >= 0) { held[blowing] = 0; f.blowing = null; }
        const speed = moved / Math.max(dt, 1e-3);
        const r = clamp(1.0 / (1 + speed * 0.25), 0.15, 0.9) * viewScale * (0.8 + 0.5 * t.depth);
        f.paintLeft = (f.paintLeft || 0) - moved;
        while (f.paintLeft <= 0) {
          const a = Math.random();
          spawn(t.px + mx * a + (Math.random() - 0.5) * r, t.pz + mz * a + (Math.random() - 0.5) * r, r * (0.6 + 0.8 * Math.random()));
          f.paintLeft += r * 1.7;
        }
      } else if (t.speed < 0.3) {
        // held still: blow one up under the finger, up to about a metre across... and more
        if (blowing < 0) {
          f.holdTime = (f.holdTime || 0) + dt;
          if (f.holdTime > 0.25) { f.blowing = spawn(t.x, t.z, 0.15, true); f.holdTime = 0; }
        } else {
          grow[blowing] = Math.min(1.4 * viewScale, grow[blowing] + dt * 0.35);
          px[blowing] = t.x; pz[blowing] = t.z; vx[blowing] = 0; vz[blowing] = 0;
        }
      }
    }

    // the air: a slow drift, swirling a little, and a pull back toward the view
    const cx = currentLook.x, cz = currentLook.z;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i]) continue;
      age[i] += dt;
      if (pop[i] > 0) {
        pop[i] -= dt;
        if (pop[i] <= 0) { alive[i] = 0; held[i] = 0; }
        continue;
      }
      if (age[i] > life[i] && !held[i]) { popNow(i); continue; }
      rad[i] += (grow[i] - rad[i]) * (1 - Math.exp(-dt / 0.25));
      if (held[i]) continue;
      const sw = time * 0.05;
      vx[i] += (0.12 * Math.sin(pz[i] * 0.35 + sw) + 0.05) * dt;
      vz[i] += (0.12 * Math.cos(px[i] * 0.3 - sw * 1.3) + 0.03) * dt;
      const ox = px[i] - cx, oz = pz[i] - cz, od = Math.hypot(ox, oz);
      if (od > REACH * viewScale) { vx[i] -= ox / od * (od - REACH * viewScale) * 0.6 * dt; vz[i] -= oz / od * (od - REACH * viewScale) * 0.6 * dt; }
    }
    // foam: bubbles that touch press into each other a little and stay; those
    // nearly touching are drawn together
    for (let i = 0; i < MAX; i++) {
      if (!alive[i] || pop[i] > 0) continue;
      for (let j = i + 1; j < MAX; j++) {
        if (!alive[j] || pop[j] > 0) continue;
        const dx = px[j] - px[i], dz = pz[j] - pz[i];
        const d = Math.hypot(dx, dz) || 1e-4, rest = (rad[i] + rad[j]) * 0.9;
        if (d > rest * 1.6) continue;
        const pull = d < rest ? (d - rest) * 4.0 : (d - rest) * 0.6;   // push apart when pressed, gently together when near
        const ux = dx / d * pull * dt, uz = dz / d * pull * dt;
        const wi = held[i] ? 0 : rad[j] / (rad[i] + rad[j]), wj = held[j] ? 0 : rad[i] / (rad[i] + rad[j]);
        vx[i] += ux * wi; vz[i] += uz * wi; vx[j] -= ux * wj; vz[j] -= uz * wj;
      }
    }
    // move, and set every instance
    const drag = Math.exp(-dt / 1.6);
    for (let i = 0; i < MAX; i++) {
      if (!alive[i]) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); aState.setX(i, 0); continue; }
      if (!held[i]) {
        vx[i] *= drag; vz[i] *= drag;
        px[i] += vx[i] * dt; pz[i] += vz[i] * dt;
      }
      py[i] = LEVEL + 0.12 * Math.sin(time * 0.6 + phase[i]) + rad[i] * 0.3;
      wobble[i] *= Math.exp(-dt / 0.5);
      const popping = pop[i] > 0 ? pop[i] / 0.09 : 1;
      const s = rad[i] * (pop[i] > 0 ? 1 + (1 - popping) * 0.25 : 1);
      pos.set(px[i], py[i], pz[i]); sc.set(s, s, s);
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(i, m4);
      aState.setXYZ(i, Math.min(1, age[i] / 0.15) * popping, wobble[i], phase[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    aState.needsUpdate = true;
    aFilm.needsUpdate = true;

    // three fingers: they all go, one after another, over about a second
    if (popAll > 0) {
      popAll -= dt;
      for (let i = 0; i < MAX; i++) if (alive[i] && pop[i] <= 0 && Math.random() < dt * 4) popNow(i);
    }
  }

  return {
    id: "bubbles", name: "Bubblor", group,
    sound: { voice: 1, ring: 4.5, wet: 0.55 },
    touchHeight: LEVEL, glowHeight: LEVEL,
    resize() {},
    update,
    tune() {},
    enter() {},
    exit() {},
    // a poke on a bubble pops it, and the finger herds the rest from there;
    // anywhere else it paints
    tap(f) {
      const k = bubbleAt(f.world.x, f.world.z);
      f.blowing = null; f.paintLeft = 0; f.holdTime = 0;
      if (k >= 0) { popNow(k); f.bubbleMode = "herd"; } else f.bubbleMode = "paint";
    },
    // a plucked string makes the bubbles near the finger shiver
    pluck(f, col, vel) {
      for (let i = 0; i < MAX; i++) {
        if (!alive[i]) continue;
        const d = Math.hypot(px[i] - f.world.x, pz[i] - f.world.z);
        if (d < 3.5) wobble[i] = Math.max(wobble[i], vel * (1 - d / 3.5) * 1.2);
      }
    },
    erase() { popAll = 1.2; },
    stats() { let n = 0; for (let i = 0; i < MAX; i++) n += alive[i]; return { bubbles: n }; },
    count() { let n = 0; for (let i = 0; i < MAX; i++) n += alive[i]; return n; },
  };
})();
