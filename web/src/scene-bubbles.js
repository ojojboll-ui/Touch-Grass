// ---- scene: bubbles ---------------------------------------------------------------
// Soap bubbles in a garden seen through a wide-open lens. A finger drawn across empty air
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
// garden behind is built only to be seen out of focus: shapes, colour and light.
const bubbleScene = (() => {
  const group = new THREE.Group();
  const MAX = 160, MAX_WALLS = 320, NEAR = 6;   // bubbles, walls, and how many neighbours each one is cut by
  const LEVEL = 1.4, REACH = 9;                  // the height they float at, how far they may stray
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

  // ---- the garden behind -----------------------------------------------------------
  // A garden of its own, only ever seen through a wide-open lens: a lawn, a hedge,
  // trees all round with the sun glinting through their leaves, flower beds, and
  // strings of lights in the trees that come on at dusk. Nothing in it needs to
  // be sharp, so it is built from spheres, boxes and cylinders; what matters is
  // shape, colour and points of light, which the lens turns into bokeh.
  const worldScene = new THREE.Scene();
  const gardenUniforms = Object.assign({ uNoise: { value: noiseTex }, uTime: { value: 0 }, uDay: { value: 1 }, uTrueSun: { value: new THREE.Vector3(0, 1, 0) } }, lightUniforms);
  const WORLD_VERT = `
    attribute vec3 aColor;
    varying vec3 vWorld, vN, vColor;
    void main() {
      mat4 m = modelMatrix;
      #ifdef USE_INSTANCING
        m = modelMatrix * instanceMatrix;
      #endif
      vec4 w = m * vec4(position, 1.0);
      vWorld = w.xyz; vN = normalize(mat3(m) * normal); vColor = aColor;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const WORLD_COMMON = `
    uniform sampler2D uNoise; uniform float uTime, uDay; uniform vec3 uTrueSun;
    uniform vec3 uSunDir, uSunCol, uAmbient, uFogCol; uniform float uFogDensity;
    varying vec3 vWorld, vN, vColor;
    ${TONEMAP}
    float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
    // tone-mapped colour, then light brighter than white kept on top, so the lens can spread it
    vec4 finish(vec3 lit, vec3 glow) {
      float fog = 1.0 - exp(-uFogDensity * 0.8 * length(vWorld - cameraPosition));
      return vec4(pow(tonemap(mix(lit, uFogCol, fog)), vec3(1.0 / 2.2)) + glow * (1.0 - fog), 1.0);
    }
  `;
  const worldMat = (frag, extra = {}) => new THREE.ShaderMaterial(Object.assign({
    uniforms: gardenUniforms, vertexShader: WORLD_VERT, fragmentShader: WORLD_COMMON + frag,
  }, extra));
  const colourAttr = (geo, count, pick) => {
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { const c = pick(i); a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(a, 3));
  };
  let seed = 4242;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(), pp = new THREE.Vector3();
  const place = (mesh, i, x, y, z, sx, sy, sz) => { pp.set(x, y, z); ss.set(sx, sy, sz); mtx.compose(pp, qq, ss); mesh.setMatrixAt(i, mtx); };

  // the sky
  const skyMat = new THREE.ShaderMaterial({
    uniforms: gardenUniforms, side: THREE.BackSide, depthWrite: false,
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
      uniform vec3 uTrueSun, uSunCol, uFogCol; uniform float uDay;
      varying vec3 vDir;
      ${TONEMAP}
      void main() {
        vec3 d = normalize(vDir);
        vec3 zen = mix(vec3(0.01, 0.015, 0.04), vec3(0.2, 0.4, 0.78), uDay);
        vec3 sky = mix(uFogCol, zen, pow(clamp(d.y, 0.0, 1.0), 0.5));
        float cs = max(dot(d, uTrueSun), 0.0);
        sky += uSunCol * pow(cs, 12.0) * 0.5;
        vec3 glow = vec3(1.0, 0.9, 0.7) * 6.0 * smoothstep(0.9993, 0.9996, cs);
        gl_FragColor = vec4(pow(tonemap(sky), vec3(1.0 / 2.2)) + glow, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
  sky.frustumCulled = false;
  worldScene.add(sky);

  // the lawn, mown in stripes
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), worldMat(`
    void main() {
      vec2 xz = vWorld.xz;
      float n = texture2D(uNoise, xz / 7.0).g * 0.6 + texture2D(uNoise, xz / 1.3).b * 0.4;
      vec3 col = mix(vec3(0.10, 0.24, 0.05), vec3(0.22, 0.40, 0.08), n);
      col *= 0.9 + 0.12 * step(0.5, fract(xz.x / 2.4));
      vec3 lit = col * (uAmbient * 0.8 + uSunCol * max(uSunDir.y, 0.0) * 1.1);
      gl_FragColor = finish(lit, vec3(0.0));
    }`));
  lawn.rotation.x = -Math.PI / 2;
  worldScene.add(lawn);

  // leaves: trees' crowns and the hedge, with the sun glinting through
  const LEAF = `
    void main() {
      vec3 n = normalize(vN);
      float leafy = texture2D(uNoise, vWorld.xz * 0.5 + vWorld.y * 0.21).g * 0.6 + texture2D(uNoise, vWorld.xy * 1.7).b * 0.4;
      vec3 col = mix(vec3(0.04, 0.12, 0.03), vec3(0.22, 0.42, 0.08), leafy) * vColor;
      float lam = max(dot(n, uSunDir), 0.0);
      vec3 lit = col * (uAmbient * 0.6 + uSunCol * lam * 1.2);
      // glints: some leaves catch the sun, and twinkle as they move
      vec3 cell = floor(vWorld * 2.2);
      float h = hash13(cell);
      float tw = 0.5 + 0.5 * sin(uTime * (1.0 + 3.0 * h) + h * 50.0);
      vec3 glow = uSunCol * step(0.93, h) * lam * tw * 0.4 * uDay;
      gl_FragColor = finish(lit, glow);
    }`;
  const leafMat = worldMat(LEAF);
  const TREES = 26, CROWN = 5;
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 8);
  colourAttr(trunkGeo, TREES, () => [1, 1, 1]);
  const trunks = new THREE.InstancedMesh(trunkGeo, worldMat(`
    void main() {
      float lam = max(dot(normalize(vN), uSunDir), 0.0);
      vec3 lit = vec3(0.16, 0.11, 0.07) * (uAmbient * 0.7 + uSunCol * lam);
      gl_FragColor = finish(lit, vec3(0.0));
    }`), TREES);
  const crownGeo = new THREE.IcosahedronGeometry(1, 2);
  colourAttr(crownGeo, TREES * CROWN, () => { const v = 0.75 + 0.5 * rnd(); return [v * (0.9 + 0.2 * rnd()), v, v * (0.8 + 0.3 * rnd())]; });
  const crowns = new THREE.InstancedMesh(crownGeo, leafMat, TREES * CROWN);
  const treeTops = [], glintSpots = [];
  for (let i = 0; i < TREES; i++) {
    // all round, leaving the middle open where the bubbles float
    const a = (i / TREES) * Math.PI * 2 + rnd() * 0.3, r = 10 + rnd() * 18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 2.2 + rnd() * 2.5, size = 1.6 + rnd() * 1.6;
    place(trunks, i, x, h / 2, z, 1, h, 1);
    for (let k = 0; k < CROWN; k++) {
      const s = size * (0.6 + 0.5 * rnd());
      place(crowns, i * CROWN + k, x + (rnd() - 0.5) * size, h + size * 0.6 + (rnd() - 0.3) * size, z + (rnd() - 0.5) * size, s, s * 0.85, s);
    }
    treeTops.push([x, h + size, z, size]);
    for (let g = 0; g < 8; g++) {
      const a2 = rnd() * 6.28, up = rnd() * 0.9;
      glintSpots.push([x + Math.cos(a2) * size * 0.9 * Math.sqrt(1 - up * up), h + size * (0.6 + up * 0.8), z + Math.sin(a2) * size * 0.9 * Math.sqrt(1 - up * up), size]);
    }
  }
  worldScene.add(trunks, crowns);
  // a hedge behind the lawn
  const HEDGE = 40;
  const hedgeGeo = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  colourAttr(hedgeGeo, HEDGE, () => [0.85, 0.95, 0.85]);
  const hedge = new THREE.InstancedMesh(hedgeGeo, leafMat, HEDGE);
  for (let i = 0; i < HEDGE; i++) {
    const a = (i / HEDGE) * Math.PI * 2, r = 15;
    const box = new THREE.Object3D();
    box.position.set(Math.cos(a) * r, 0.9, Math.sin(a) * r);
    box.rotation.y = -a; box.scale.set(1.0, 1.8, 2.5);
    box.updateMatrix(); hedge.setMatrixAt(i, box.matrix);
  }
  worldScene.add(hedge);

  // flower beds: clusters of colour along the lawn
  const BLOOMS = 700;
  const bloomGeo = new THREE.IcosahedronGeometry(1, 1);
  const PALETTE_BEDS = [[1.0, 0.25, 0.3], [1.0, 0.75, 0.15], [0.95, 0.95, 0.9], [0.7, 0.35, 0.95], [1.0, 0.5, 0.7], [0.35, 0.55, 1.0]];
  const beds = Array.from({ length: 14 }, () => { const a = rnd() * 6.28, r = 4 + rnd() * 10; return [Math.cos(a) * r, Math.sin(a) * r, Math.floor(rnd() * 6)]; });
  colourAttr(bloomGeo, BLOOMS, (i) => PALETTE_BEDS[(beds[i % beds.length][2] + (rnd() < 0.2 ? 1 : 0)) % 6]);
  const blooms = new THREE.InstancedMesh(bloomGeo, worldMat(`
    void main() {
      float lam = max(dot(normalize(vN), uSunDir), 0.0) * 0.6 + 0.4;
      vec3 lit = vColor * (uAmbient * 0.7 + uSunCol * lam * 1.1);
      gl_FragColor = finish(lit, vColor * 0.4 * uDay * lam);
    }`), BLOOMS);
  for (let i = 0; i < BLOOMS; i++) {
    const b = beds[i % beds.length];
    const s = 0.07 + rnd() * 0.08;
    place(blooms, i, b[0] + (rnd() - 0.5) * 2.4, 0.25 + rnd() * 0.4, b[1] + (rnd() - 0.5) * 1.6, s, s, s);
  }
  worldScene.add(blooms);

  // strings of lights in the trees: faint by day, bright at dusk and after
  const LIGHTS = 220;
  const lightGeo = new THREE.IcosahedronGeometry(1, 1);
  colourAttr(lightGeo, LIGHTS, () => (rnd() < 0.8 ? [1.0, 0.78, 0.45] : [1.0, 0.95, 0.85]));
  const lights = new THREE.InstancedMesh(lightGeo, worldMat(`
    void main() {
      float on = mix(1.0, 0.25, uDay);
      gl_FragColor = finish(vColor * (0.6 + 0.6 * on), vec3(0.0));
    }`), LIGHTS);
  for (let i = 0; i < LIGHTS; i++) {
    // hung from one tree to the next, sagging between
    const a = treeTops[Math.floor(i / (LIGHTS / TREES)) % TREES], b = treeTops[(Math.floor(i / (LIGHTS / TREES)) + 1) % TREES];
    const t = (i % (LIGHTS / TREES)) / (LIGHTS / TREES);
    const sag = Math.sin(t * Math.PI) * 1.2;
    place(lights, i, a[0] + (b[0] - a[0]) * t, a[1] - a[3] * 0.6 + (b[1] - a[1]) * t - sag, a[2] + (b[2] - a[2]) * t, 0.12, 0.12, 0.12);
  }
  worldScene.add(lights);

  // ---- bokeh: points of light spread into discs ----
  // A lens turns each point of light out of focus into a disc as wide as it is
  // out of focus. Blurring the picture afterwards cannot do that well for tiny
  // bright points (they come out as a pattern of dots), so the lights in the
  // trees and the sun glinting through the leaves are drawn here as discs of
  // their own, over the blurred garden and under the bubbles: sized by their
  // distance from the focus, dimmer the wider they spread, a little brighter
  // at the rim, as real bokeh is.
  const bokehPos = [], bokehCol = [], bokehKind = [];
  for (let i = 0; i < LIGHTS; i++) {
    lights.getMatrixAt(i, mtx); pp.setFromMatrixPosition(mtx);
    const c = lightGeo.getAttribute("aColor");
    bokehPos.push(pp.x, pp.y, pp.z); bokehCol.push(c.getX(i), c.getY(i), c.getZ(i)); bokehKind.push(0, rnd());
  }
  for (const [x, y, z, size] of glintSpots) {
    bokehPos.push(x, y, z); bokehCol.push(1.0, 0.95, 0.8); bokehKind.push(1, rnd());
  }
  const bokehGeo = new THREE.BufferGeometry();
  bokehGeo.setAttribute("position", new THREE.Float32BufferAttribute(bokehPos, 3));
  bokehGeo.setAttribute("aColor", new THREE.Float32BufferAttribute(bokehCol, 3));
  bokehGeo.setAttribute("aKind", new THREE.Float32BufferAttribute(bokehKind, 2));
  const bokehMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uFocus: { value: 6 }, uDiscScale: { value: 40 }, uMaxDisc: { value: 120 } }, gardenUniforms),
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aColor; attribute vec2 aKind;
      uniform float uFocus, uDiscScale, uMaxDisc, uTime, uDay;
      uniform vec3 uSunDir;
      varying vec3 vCol; varying float vGain;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        float disc = clamp(abs(1.0 - uFocus / d) * uDiscScale, 3.0, uMaxDisc);
        gl_PointSize = disc;
        gl_Position = projectionMatrix * mv;
        // lights: faint by day, bright at dusk; glints: only by day, twinkling
        float tw = 0.5 + 0.5 * sin(uTime * (1.2 + 3.0 * aKind.y) + aKind.y * 60.0);
        float on = aKind.x < 0.5 ? mix(1.0, 0.18, uDay) : uDay * tw * tw * max(uSunDir.y, 0.0) * 0.7;
        // the same light spread wider is dimmer, but not so dim it vanishes
        vGain = on * clamp(pow(14.0 / disc, 0.9), 0.06, 1.0);
        vCol = aColor;
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vGain;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float disc = smoothstep(1.0, 0.86, r) * (0.75 + 0.25 * smoothstep(0.55, 0.95, r));
        gl_FragColor = vec4(vCol * disc * vGain, 1.0);
      }`,
  });
  const bokeh = new THREE.Points(bokehGeo, bokehMat);
  bokeh.frustumCulled = false;
  bokeh.renderOrder = 5;
  group.add(bokeh);

  // ---- the lens: a very shallow depth of field ----
  // The garden is rendered at a quarter of the screen's size, with depth, and
  // blurred by its distance from the bubbles in focus, as by a lens opened
  // wide: every point spreads into a disc as wide as it is out of focus, bright
  // points more than dark ones, so glints and lights turn into bokeh. Only the
  // plane of the bubbles is sharp; the bubbles are drawn sharp over it.
  const worldSize = new THREE.Vector2(2, 2);
  function halfTarget(depth) {
    const t = new THREE.WebGLRenderTarget(2, 2, {
      type: floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, stencilBuffer: false,
    });
    if (depth) { t.depthTexture = new THREE.DepthTexture(2, 2); t.depthTexture.type = THREE.UnsignedIntType; }
    return t;
  }
  const worldRT = halfTarget(true), cocRT = halfTarget(false), dofRT = halfTarget(false);
  const MAX_BLUR = 18;                       // pixels at a quarter of the resolution
  // how far out of focus each pixel is, kept beside its colour
  const cocMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: { uColor: { value: worldRT.texture }, uDepth: { value: worldRT.depthTexture }, uNear: { value: 0.5 }, uFar: { value: 400 },
                uFocus: { value: 6 }, uAperture: { value: 14 }, uPx: { value: new THREE.Vector2(0.01, 0.01) } },
    fragmentShader: `
      uniform sampler2D uColor, uDepth; uniform float uNear, uFar, uFocus, uAperture; uniform vec2 uPx;
      varying vec2 vUv;
      void main() {
        float z = texture2D(uDepth, vUv).r * 2.0 - 1.0;
        float dist = 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
        float coc = clamp(abs(1.0 - uFocus / dist) * uAperture, 0.0, ${MAX_BLUR}.0);
        // a small tent filter first: a point of light a pixel wide would only be
        // caught now and then by the spiral below, and come out as dots
        vec3 c = texture2D(uColor, vUv).rgb * 0.4
               + (texture2D(uColor, vUv + vec2(uPx.x, uPx.y)).rgb + texture2D(uColor, vUv + vec2(-uPx.x, uPx.y)).rgb
                + texture2D(uColor, vUv + vec2(uPx.x, -uPx.y)).rgb + texture2D(uColor, vUv - uPx).rgb) * 0.15;
        gl_FragColor = vec4(c, coc / ${MAX_BLUR}.0);
      }`,
  });
  // the gather, after Dennis Gustafsson's single-pass bokeh: a golden-angle
  // spiral outward; a sample counts where its own disc reaches this far
  const dofMat = new THREE.ShaderMaterial({
    vertexShader: PASS_VERT,
    uniforms: { uSrc: { value: cocRT.texture }, uPixel: { value: new THREE.Vector2(0.01, 0.01) } },
    fragmentShader: `
      uniform sampler2D uSrc; uniform vec2 uPixel;
      varying vec2 vUv;
      void main() {
        vec4 c0 = texture2D(uSrc, vUv);
        float centre = c0.a * ${MAX_BLUR}.0;
        vec3 sum = c0.rgb; float tot = 1.0;
        float r = 1.0, ang = 0.0;
        for (int i = 0; i < 64; i++) {
          if (r > ${MAX_BLUR}.0) break;
          vec4 s = texture2D(uSrc, vUv + vec2(cos(ang), sin(ang)) * uPixel * r);
          float size = s.a * ${MAX_BLUR}.0;
          // something sharp behind does not bleed over a blurred thing in front
          if (s.a > c0.a) size = min(size, centre * 2.0);
          float m = smoothstep(r - 0.5, r + 0.5, size);
          float luma = dot(s.rgb, vec3(0.3, 0.55, 0.15));
          float w = m * (1.0 + 7.0 * luma * luma * luma * luma);
          sum += mix(sum / tot, s.rgb, m) * max(w, 1.0 - m);
          tot += max(w, 1.0 - m);
          ang += 2.39996323; r += 2.6 / r;
        }
        gl_FragColor = vec4(sum / tot, 1.0);
      }`,
  });
  // drawn first, behind everything, filling the screen
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uTex: { value: dofRT.texture } },
    depthTest: false, depthWrite: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }",
    fragmentShader: "uniform sampler2D uTex; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }",
  }));
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -100;
  group.add(backdrop);
  const bufSize = new THREE.Vector2();
  function renderWorld(dt, touches, time) {
    renderer.getDrawingBufferSize(bufSize);
    const w = Math.max(2, Math.round(bufSize.x / 4)), h = Math.max(2, Math.round(bufSize.y / 4));
    if (w !== worldSize.x || h !== worldSize.y) {
      worldSize.set(w, h);
      for (const t of [worldRT, cocRT, dofRT]) t.setSize(w, h);
      dofMat.uniforms.uPixel.value.set(1 / w, 1 / h);
      cocMat.uniforms.uPx.value.set(1 / w, 1 / h);
    }
    gardenUniforms.uTime.value = time;
    const sun = sunDirection(hour);
    gardenUniforms.uTrueSun.value.copy(sun);
    gardenUniforms.uDay.value = smooth(-0.12, 0.2, sun.y);
    sky.position.copy(camera.position);
    renderer.setRenderTarget(worldRT);
    renderer.render(worldScene, camera);
    cocMat.uniforms.uNear.value = camera.near; cocMat.uniforms.uFar.value = camera.far;
    cocMat.uniforms.uFocus.value = Math.max(1, camera.position.distanceTo(focusAt.set(currentLook.x, LEVEL, currentLook.z)));
    cocMat.uniforms.uAperture.value = 60 * h / 200;   // wide open: a metre off the focus is already soft
    // the light discs are drawn at full size: the same lens, four times the pixels
    bokehMat.uniforms.uFocus.value = cocMat.uniforms.uFocus.value;
    bokehMat.uniforms.uDiscScale.value = 2 * cocMat.uniforms.uAperture.value * (bufSize.x / w);
    bokehMat.uniforms.uMaxDisc.value = 2 * MAX_BLUR * (bufSize.x / w);
    passQuad.material = cocMat;
    renderer.setRenderTarget(cocRT);
    renderer.render(passScene, passCam);
    passQuad.material = dofMat;
    renderer.setRenderTarget(dofRT);
    renderer.render(passScene, passCam);
    renderer.setRenderTarget(null);
  }
  const focusAt = new THREE.Vector3();

  // a finger whose view ray does not reach the bubbles' height nearby is in the sky
  const reachHit = new THREE.Vector3();
  function reaches(f) {
    if (f.sx == null || !worldAt(f.sx, f.sy, reachHit)) return false;
    return Math.hypot(reachHit.x - camera.position.x, reachHit.z - camera.position.z) < 22;
  }

  // seen from among the bubbles, the garden behind them
  // straight down first, then lower step by step, each still high enough that
  // the bubbles at the top of the screen are seen and can be reached
  const VIEWS_AMONG = [
    { name: "Rakt uppifrån",   pos: [0.0, 9.5, 0.3], look: [0, 1.4, 0.0], fov: 50 },
    { name: "Snett ovanifrån", pos: [0.0, 8.0, 4.8], look: [0, 1.4, 0.0], fov: 50 },
    { name: "Lite snett",      pos: [0.0, 6.2, 6.8], look: [0, 1.4, 0.0], fov: 50 },
  ];

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
    const viewScale = viewScaleNow();
    touches = touches.filter((t) => reaches(t.finger));
    renderWorld(dt, touches, time);

    // fingers: painting, blowing, herding
    for (const t of touches) {
      const f = t.finger;
      if (!f.bubbleMode || f.bubbleMode === "none") f.bubbleMode = "paint";
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
    sound: { voice: 2, ring: 4.5, wet: 0.55 },
    views: VIEWS_AMONG,
    touchHeight: LEVEL, glowHeight: LEVEL,
    resize() {},
    update,
    tune() {},
    // the meadow is lent to the world behind while the bubbles are out
    enter() {},
    exit() {},
    // a poke on a bubble pops it, and the finger herds the rest from there;
    // anywhere else it paints
    tap(f) {
      if (!reaches(f)) { f.bubbleMode = "none"; return; }
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
