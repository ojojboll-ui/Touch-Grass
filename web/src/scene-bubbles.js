// ---- scene: bubbles ---------------------------------------------------------------
// Soap bubbles over a garden seen out of focus. A finger drawn across empty air
// lets bubbles go along its path, big when it moves slowly and small when it
// hurries; a finger held still blows one up under it until it lets go. Bubbles
// that meet stick together into foam and drift as a clump. A poke pops a bubble
// in a spray of droplets, and a finger dragged on from there herds the rest.
// Every plucked string makes the bubbles near it shiver, and the strings'
// rings run colour through their films. Three fingers pop them all.
//
// Foam, as real foam is: bubbles that touch do not pass through each other.
// They pack into clumps in all three dimensions, and where two meet, a flat
// film wall divides them; where three meet, their walls join along a line. The
// geometry is a power diagram cut to the bubbles: a point belongs to the bubble
// whose |p - c|^2 - r^2 is least. So each sphere is drawn only where it is not
// inside a neighbour, and each wall is a disc on the plane where two of those
// powers are equal, cut away wherever a third bubble's is less. The seams,
// where surfaces and walls meet, catch the light as bright lines.
//
// The colour is thin-film interference: the film's thickness swirls over the
// surface and drains toward the top, the path through it grows as the view
// grazes, and red, green and blue fall in and out of step at different
// thicknesses. Mostly clear facing you, mostly reflection at the rim. The
// garden behind is never sharp: soft fields of colour and lens bokeh.
const bubbleScene = (() => {
  const group = new THREE.Group();
  const MAX = 160, MAX_WALLS = 320, NEAR = 6;   // bubbles, walls, and how many neighbours each one is cut by
  const LEVEL = 1.0, REACH = 9;                  // the height they float at, how far they may stray
  const TONEMAP = "vec3 tonemap(vec3 x) { x *= 0.62; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }";
  const FAR = 1e4;                               // where an empty neighbour slot sits

  // ---- the bubbles' state ----
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const rad = new Float32Array(MAX), grow = new Float32Array(MAX);      // radius, and the radius it is growing toward
  const age = new Float32Array(MAX), life = new Float32Array(MAX), phase = new Float32Array(MAX);
  const alive = new Uint8Array(MAX), held = new Uint8Array(MAX);
  const pop = new Float32Array(MAX);                                    // > 0 while popping: seconds left
  const wobble = new Float32Array(MAX);

  // ---- what both the spheres and the walls are made of ----
  const NBR_ATTRS = Array.from({ length: NEAR }, (_, i) => `aN${i}`);
  const NBR_DECL = NBR_ATTRS.map((n, i) => `attribute vec4 ${n}; varying vec4 vN${i};`).join("\n");
  const NBR_PASS = NBR_ATTRS.map((n, i) => `vN${i} = ${n};`).join(" ");
  const NBR_VARY = NBR_ATTRS.map((n, i) => `varying vec4 vN${i};`).join("\n");
  const filmUniforms = () => Object.assign({
    uNoise: { value: noiseTex }, uTime: { value: 0 },
    uRipple: { value: rippleRT.texture }, uRippleRect: { value: new THREE.Vector3(-BEND_SIZE / 2, -BEND_SIZE / 2, BEND_SIZE) },
  }, lightUniforms);
  const FILM_GLSL = `
    uniform sampler2D uNoise, uRipple; uniform float uTime; uniform vec3 uRippleRect;
    uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol;
    ${TONEMAP}
    // the film's colour at a point: swirling, thinner at the top where it drains
    vec3 filmColour(vec3 local, vec2 film, float c, vec3 world) {
      vec2 sw = local.xz * 0.3 + vec2(local.y * 0.15, 0.0) + film.y + vec2(uTime * 0.0065, -uTime * 0.0045);
      float swirl = texture2D(uNoise, sw).g * 0.75 + texture2D(uNoise, sw * 2.6 + 0.4).a * 0.25;
      float thick = 0.4 + 2.2 * swirl - 0.35 * local.y + film.x;
      vec3 col = 0.5 + 0.5 * cos(6.2831 * (thick * (0.55 + 0.45 * c) * 2.2 + vec3(0.0, 0.33, 0.67)));
      vec3 ring = texture2D(uRipple, (world.xz - uRippleRect.xy) / uRippleRect.z).rgb;
      return mix(col, col * 0.4 + ring * 1.6, clamp(length(ring) * 1.5, 0.0, 0.8));
    }
    // what a film reflects: a bright sky above, the garden below, the sun
    vec3 reflection(vec3 R, out float spec) {
      vec3 garden = mix(vec3(0.08, 0.18, 0.10), vec3(0.36, 0.32, 0.18), texture2D(uNoise, R.xz * 0.4 + 0.2).g);
      garden *= uAmbient * 0.8 + uSunCol * 0.4;
      vec3 sky = uFogCol * 1.1 + uSunCol * 0.25;
      float s = max(dot(R, uSunDir), 0.0);
      spec = pow(s, 160.0) * 4.0 + pow(s, 12.0) * 0.25;
      return mix(garden, sky, smoothstep(-0.25, 0.35, R.y));
    }
  `;

  // ---- the spheres ----
  const geo = new THREE.SphereGeometry(1, 40, 20);
  geo.deleteAttribute("uv");
  const aFilm = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);   // thickness offset, swirl seed
  const aState = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);  // fade, wobble, wobble phase
  geo.setAttribute("aFilm", aFilm);
  geo.setAttribute("aState", aState);
  const nbr = NBR_ATTRS.map((n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    geo.setAttribute(n, a);
    return a;
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: filmUniforms(),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec2 aFilm; attribute vec3 aState;
      ${NBR_DECL}
      uniform float uTime;
      varying vec3 vWorld, vLocal, vFF;
      void main() {
        vec3 p = position;
        // a shiver: the surface rings in a few lobes, dying away
        float lobes = sin(p.x * 3.0 + uTime * 11.0 + aState.z) * sin(p.y * 2.0 - uTime * 9.0) + sin(p.z * 4.0 + uTime * 13.0);
        p *= 1.0 + aState.y * 0.05 * lobes;
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = w.xyz; vLocal = position; vFF = vec3(aFilm, aState.x);
        ${NBR_PASS}
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      ${FILM_GLSL}
      varying vec3 vWorld, vLocal, vFF;
      ${NBR_VARY}
      // how far outside a neighbour this point is (negative: inside it)
      float outside(vec4 s) { return length(vWorld - s.xyz) - s.w; }
      void main() {
        // the part of this sphere inside a neighbour is not there: the wall between them is
        float seam = 1e3, d;
        ${NBR_ATTRS.map((n, i) => `d = outside(vN${i}); if (d < 0.0) discard; seam = min(seam, d);`).join("\n        ")}
        vec3 n = normalize(vLocal);
        if (!gl_FrontFacing) n = -n;
        vec3 V = normalize(cameraPosition - vWorld);
        float c = abs(dot(n, V));
        vec3 film = filmColour(vLocal, vFF.xy, c, vWorld);
        float spec;
        vec3 env = reflection(reflect(-V, n), spec);
        float fres = 0.05 + 0.95 * pow(1.0 - c, 3.5);
        // the seam where this surface meets a wall: a thin bright line
        float edge = smoothstep(0.02, 0.0, seam);
        vec3 col = film * env * 1.4 + uSunCol * spec + env * edge * 0.6;
        float alpha = clamp(fres * 0.8 + 0.05 + spec * 0.6 + edge * 0.35, 0.0, 1.0) * vFF.z;
        gl_FragColor = vec4(pow(tonemap(col), vec3(1.0 / 2.2)), alpha);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  group.add(mesh);

  // ---- the walls between them ----
  const wallGeo = new THREE.CircleGeometry(1, 48);
  wallGeo.deleteAttribute("uv");
  const wSelf = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WALLS * 4), 4);   // one of the two bubbles: centre, radius
  const wFilm = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WALLS * 2), 2);
  wallGeo.setAttribute("aSelf", wSelf);
  wallGeo.setAttribute("aFilm", wFilm);
  const wNbr = NBR_ATTRS.map((n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WALLS * 4), 4);
    wallGeo.setAttribute(n, a);
    return a;
  });
  const wallMat = new THREE.ShaderMaterial({
    uniforms: filmUniforms(),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 aSelf; attribute vec2 aFilm;
      ${NBR_DECL}
      varying vec3 vWorld, vNormal; varying vec4 vSelf; varying vec2 vFilm;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vSelf = aSelf; vFilm = aFilm;
        vNormal = normalize(mat3(instanceMatrix) * vec3(0.0, 0.0, 1.0));
        ${NBR_PASS}
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      ${FILM_GLSL}
      varying vec3 vWorld, vNormal; varying vec4 vSelf; varying vec2 vFilm;
      ${NBR_VARY}
      float power(vec4 s) { vec3 d = vWorld - s.xyz; return dot(d, d) - s.w * s.w; }
      void main() {
        // on this plane the two bubbles' powers are equal; a third bubble with
        // less owns the point, and the wall stops there, meeting its walls
        float me = power(vSelf);
        if (me > 0.0) discard;
        float seam = -me / (2.0 * vSelf.w), d;
        ${NBR_ATTRS.map((n, i) => `d = power(vN${i}) - me; if (d < 0.0) discard; seam = min(seam, d / (2.0 * max(length(vN${i}.xyz - vSelf.xyz), 0.01)));`).join("\n        ")}
        vec3 n = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(n, V) < 0.0) n = -n;
        float c = dot(n, V);
        vec3 local = (vWorld - vSelf.xyz) / vSelf.w;
        vec3 film = filmColour(local, vFilm, c, vWorld);
        float spec;
        vec3 env = reflection(reflect(-V, n), spec);
        float fres = 0.04 + 0.9 * pow(1.0 - c, 3.0);
        float edge = smoothstep(0.018, 0.0, seam);
        vec3 col = film * env * 1.3 + uSunCol * spec + env * edge * 0.6;
        float alpha = clamp(fres * 0.7 + 0.04 + spec * 0.5 + edge * 0.3, 0.0, 1.0);
        gl_FragColor = vec4(pow(tonemap(col), vec3(1.0 / 2.2)), alpha);
      }`,
  });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, MAX_WALLS);
  walls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  walls.frustumCulled = false;
  walls.renderOrder = 11;
  walls.count = 0;
  group.add(walls);

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
      if (oldest >= 0) popNow(oldest);
      return -1;
    }
    alive[k] = 1; held[k] = isHeld ? 1 : 0; pop[k] = 0;
    px[k] = x; pz[k] = z; py[k] = LEVEL + (Math.random() - 0.5) * 0.3;
    vx[k] = (Math.random() - 0.5) * 0.2; vy[k] = 0; vz[k] = (Math.random() - 0.5) * 0.2;
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
      const d = Math.hypot(px[i] - px[k], py[i] - py[k], pz[i] - pz[k]);
      if (d < (rad[i] + r) * 1.3) wobble[i] = Math.max(wobble[i], 0.8);
    }
  }
  // the bubble a finger's view ray meets first
  const ray = new THREE.Vector3();
  function bubbleAt(world) {
    ray.copy(world).sub(camera.position).normalize();
    const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
    let best = -1, bestT = 1e9;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i] || pop[i] > 0) continue;
      const cx = px[i] - ox, cy = py[i] - oy, cz = pz[i] - oz;
      const along = cx * ray.x + cy * ray.y + cz * ray.z;
      const miss2 = cx * cx + cy * cy + cz * cz - along * along;
      const r = rad[i] * 1.05;
      if (miss2 > r * r) continue;
      const t = along - Math.sqrt(r * r - miss2);
      if (t > 0 && t < bestT) { bestT = t; best = i; }
    }
    return best;
  }

  // ---- the frame ----------------------------------------------------------------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1), axis = new THREE.Vector3();
  const touching = Array.from({ length: MAX }, () => []);   // each bubble's overlapping neighbours
  let popAll = 0;
  function setNbr(attrs, slot, list, from) {
    for (let s = 0; s < NEAR; s++) {
      const j = list[s];
      if (j === undefined) attrs[s].setXYZW(slot, FAR, FAR, FAR, 0);
      else attrs[s].setXYZW(slot, px[j], py[j], pz[j], rad[j]);
    }
  }
  function update(dt, touches, time) {
    mat.uniforms.uTime.value = time;
    wallMat.uniforms.uTime.value = time;
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
        // held still: blow one up under the finger
        if (blowing < 0) {
          f.holdTime = (f.holdTime || 0) + dt;
          if (f.holdTime > 0.25) { f.blowing = spawn(t.x, t.z, 0.15, true); f.holdTime = 0; }
        } else {
          grow[blowing] = Math.min(1.4 * viewScale, grow[blowing] + dt * 0.35);
          px[blowing] = t.x; pz[blowing] = t.z; py[blowing] = LEVEL; vx[blowing] = vy[blowing] = vz[blowing] = 0;
        }
      }
    }

    // the air: a slow drift, swirling a little; neither rising nor sinking far
    // from where they float; a pull back toward the view
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
      vy[i] += ((LEVEL - py[i]) * 0.35 + 0.04 * Math.sin(time * 0.5 + phase[i])) * dt;
      const ox = px[i] - cx, oz = pz[i] - cz, od = Math.hypot(ox, oz);
      if (od > REACH * viewScale) { vx[i] -= ox / od * (od - REACH * viewScale) * 0.6 * dt; vz[i] -= oz / od * (od - REACH * viewScale) * 0.6 * dt; }
    }
    // foam: bubbles that touch settle pressed a fifth into each other, so a wall
    // forms between them; bubbles nearly touching are drawn together. In all
    // three dimensions, so a clump packs into a ball
    for (let i = 0; i < MAX; i++) touching[i].length = 0;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i] || pop[i] > 0) continue;
      for (let j = i + 1; j < MAX; j++) {
        if (!alive[j] || pop[j] > 0) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
        const sum = rad[i] + rad[j];
        const d = Math.hypot(dx, dy, dz) || 1e-4, rest = sum * 0.8;
        if (d > sum * 1.35) continue;
        if (d < sum) { touching[i].push(j); touching[j].push(i); }
        const pull = d < rest ? (d - rest) * 5.0 : (d - rest) * 0.8;
        const s = pull * dt / d;
        const wi = held[i] ? 0 : rad[j] / sum, wj = held[j] ? 0 : rad[i] / sum;
        vx[i] += dx * s * wi; vy[i] += dy * s * wi; vz[i] += dz * s * wi;
        vx[j] -= dx * s * wj; vy[j] -= dy * s * wj; vz[j] -= dz * s * wj;
      }
    }
    // move, and set every sphere
    const drag = Math.exp(-dt / 1.2);
    for (let i = 0; i < MAX; i++) {
      if (!alive[i]) { m4.makeScale(0, 0, 0); mesh.setMatrixAt(i, m4); aState.setX(i, 0); continue; }
      if (!held[i]) {
        vx[i] *= drag; vy[i] *= drag; vz[i] *= drag;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      }
      wobble[i] *= Math.exp(-dt / 0.5);
      const popping = pop[i] > 0 ? pop[i] / 0.09 : 1;
      const s = rad[i] * (pop[i] > 0 ? 1 + (1 - popping) * 0.25 : 1);
      pos.set(px[i], py[i], pz[i]); sc.set(s, s, s);
      m4.compose(pos, q, sc);
      mesh.setMatrixAt(i, m4);
      aState.setXYZ(i, Math.min(1, age[i] / 0.15) * popping, wobble[i], phase[i]);
    }
    // each sphere is cut by the neighbours it presses into most
    for (let i = 0; i < MAX; i++) {
      const list = touching[i];
      if (list.length > NEAR) {
        const depth = (j) => rad[i] + rad[j] - Math.hypot(px[j] - px[i], py[j] - py[i], pz[j] - pz[i]);
        list.sort((a, b) => depth(b) - depth(a));
      }
      setNbr(nbr, i, list);
    }
    // a wall for every pair that touches: a disc on the plane where their powers
    // are equal, as wide as the circle where the two spheres cross
    let w = 0;
    for (let i = 0; i < MAX && w < MAX_WALLS; i++) {
      for (const j of touching[i]) {
        if (j < i || w >= MAX_WALLS) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
        const d = Math.hypot(dx, dy, dz);
        if (d < Math.abs(rad[i] - rad[j]) + 1e-3) continue;           // one inside the other: no wall yet
        const x = (d * d + rad[i] * rad[i] - rad[j] * rad[j]) / (2 * d);
        const a2 = rad[i] * rad[i] - x * x;
        if (a2 <= 1e-6) continue;
        axis.set(dx / d, dy / d, dz / d);
        pos.set(px[i] + axis.x * x, py[i] + axis.y * x, pz[i] + axis.z * x);
        q.setFromUnitVectors(zAxis, axis);
        const a = Math.sqrt(a2);
        sc.set(a, a, a);
        m4.compose(pos, q, sc);
        walls.setMatrixAt(w, m4);
        q.identity();
        wSelf.setXYZW(w, px[i], py[i], pz[i], rad[i]);
        wFilm.setXY(w, (aFilm.getX(i) + aFilm.getX(j)) * 0.5, aFilm.getY(i));
        // cut by the other bubbles around both, nearest the wall first
        const others = [];
        for (const k of touching[i]) if (k !== j) others.push(k);
        for (const k of touching[j]) if (k !== i && others.indexOf(k) < 0) others.push(k);
        if (others.length > NEAR) {
          const near = (k) => Math.hypot(px[k] - pos.x, py[k] - pos.y, pz[k] - pos.z) - rad[k];
          others.sort((u, v) => near(u) - near(v));
        }
        setNbr(wNbr, w, others);
        w++;
      }
    }
    walls.count = w;
    mesh.instanceMatrix.needsUpdate = true;
    walls.instanceMatrix.needsUpdate = true;
    aState.needsUpdate = true; aFilm.needsUpdate = true;
    wSelf.needsUpdate = true; wFilm.needsUpdate = true;
    for (const a of nbr) a.needsUpdate = true;
    for (const a of wNbr) a.needsUpdate = true;

    // three fingers: they all go, one after another, over about a second
    if (popAll > 0) {
      popAll -= dt;
      for (let i = 0; i < MAX; i++) if (alive[i] && pop[i] <= 0 && Math.random() < dt * 4) popNow(i);
    }
  }

  return {
    id: "bubbles", name: "Bubblor", group,
    chords: [[9, 0], [4, 0], [11, 0], [1, 1]],          // A E B C#m: IV I V vi, the lift that starts away from home
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
      const k = bubbleAt(f.world);
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
    stats() { let n = 0; for (let i = 0; i < MAX; i++) n += alive[i]; return { bubbles: n, walls: walls.count }; },
    count() { let n = 0; for (let i = 0; i < MAX; i++) n += alive[i]; return n; },
    // for testing: a clump made at once
    clump(x, z, n, r) { for (let k = 0; k < n; k++) spawn(x + (Math.random() - 0.5) * r * 2, z + (Math.random() - 0.5) * r * 2, r * (0.6 + 0.8 * Math.random())); },
  };
})();
