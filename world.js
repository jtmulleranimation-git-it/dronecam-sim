// Practice world: mountain terrain, a twisty road loop with hairpins, forest, FPV gates.
// Built in UE coordinates (X north, Y east, Z up, meters) and mapped to three.js as (Y, Z, -X).
import * as THREE from '../vendor/three.module.min.js';
import { v3, smoothStep } from './uemath.js';

export const toThree = (x, y, z) => new THREE.Vector3(y, z, -x);

// ---------- noise ----------
function hash2(i, j) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 5) { let s = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { s += vnoise(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; } return s / n; }
function baseHeight(x, y) {
  const r = Math.hypot(x, y);
  const hills = fbm(x / 210 + 11.3, y / 210 - 4.7) * 95;
  const ridge = (1 - Math.abs(fbm(x / 120 - 2.1, y / 120 + 7.9, 4) * 2 - 1)) * 30;
  return hills + ridge + Math.max(0, r - 420) * 0.35;
}

// ---------- road ----------
const ROAD_PTS = [
  [40, 30], [120, 55], [205, 25], [265, 90], [215, 150], [150, 128], [105, 190], [170, 250], [245, 225], [305, 280],
  [250, 345], [150, 330], [60, 290], [-20, 320], [-100, 285], [-60, 220], [-130, 178], [-210, 220], [-285, 170],
  [-235, 108], [-150, 118], [-92, 78], [-170, 18], [-252, -30], [-300, -112], [-232, -160], [-160, -108],
  [-112, -172], [-162, -242], [-82, -302], [10, -262], [-30, -192], [40, -140], [112, -200], [192, -170],
  [252, -222], [322, -150], [262, -90], [172, -80], [108, -28],
];
function catmullClosed(pts, samplesPerSeg = 24) {
  const out = [], n = pts.length;
  const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5); // centripetal: no loops at hairpins
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = t1 + (t2 - t1) * s / samplesPerSeg;
      const L = (pa, pb, ta, tb) => [((tb - t) * pa[0] + (t - ta) * pb[0]) / (tb - ta), ((tb - t) * pa[1] + (t - ta) * pb[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  return out;
}
function resampleClosed(pts, step) {
  const out = []; const n = pts.length; let acc = 0; out.push(pts[0]);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n]; const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - acc;
    while (t <= seg) { out.push([a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg]); t += step; }
    acc = seg - (t - step);
  }
  out.pop();
  return out;
}

export function buildWorld(scene) {
  const ROAD_W = 7, STEP = 2;
  const road = resampleClosed(catmullClosed(ROAD_PTS), STEP).map(p => ({ x: p[0], y: p[1], h: 0 }));
  const N = road.length;
  road.forEach(p => { p.h = baseHeight(p.x, p.y); });
  for (let pass = 0; pass < 3; pass++) { // smooth the road grade
    const hs = road.map(p => p.h), W = 18;
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -W; k <= W; k++) s += hs[(i + k + N) % N]; road[i].h = s / (2 * W + 1); }
  }
  road.forEach((p, i) => { const a = road[(i - 1 + N) % N], b = road[(i + 1) % N]; const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); p.tx = dx / l; p.ty = dy / l; });

  // spatial hash of road samples
  const CELL = 20, grid = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  road.forEach((p, idx) => { const k = key(Math.floor(p.x / CELL), Math.floor(p.y / CELL)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(idx); });
  function nearestRoad(x, y) {
    const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL); let best = 1e9, bi = -1;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const L = grid.get(key(ci + a, cj + b)); if (!L) continue; for (const idx of L) { const p = road[idx]; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < best) { best = d; bi = idx; } } }
    return { d: Math.sqrt(best), i: bi };
  }

  // takeoff pad at the origin
  const PAD_R = 14;
  const padH = baseHeight(0, 0);
  function finalHeight(x, y) {
    let h = baseHeight(x, y);
    const r = Math.hypot(x, y);
    h += (padH - h) * smoothStep(PAD_R + 30, PAD_R, r);
    const nr = nearestRoad(x, y);
    if (nr.i >= 0) h += (road[nr.i].h - 0.35 - h) * smoothStep(22, 6, nr.d);
    return h;
  }

  // ---------- terrain mesh + height grid ----------
  const SIZE = 1500, RES = 300, S = SIZE / RES, X0 = -SIZE / 2;
  const H = new Float32Array((RES + 1) * (RES + 1));
  const pos = new Float32Array((RES + 1) * (RES + 1) * 3), col = new Float32Array((RES + 1) * (RES + 1) * 3);
  for (let i = 0; i <= RES; i++) for (let j = 0; j <= RES; j++) {
    const x = X0 + i * S, y = X0 + j * S, h = finalHeight(x, y), k = i * (RES + 1) + j;
    H[k] = h; pos[k * 3] = y; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -x;
  }
  const idx = new Uint32Array(RES * RES * 6); let w = 0;
  for (let i = 0; i < RES; i++) for (let j = 0; j < RES; j++) {
    const a = i * (RES + 1) + j, b = (i + 1) * (RES + 1) + j, c = a + 1, d = b + 1;
    idx[w++] = a; idx[w++] = c; idx[w++] = b; idx[w++] = c; idx[w++] = d; idx[w++] = b;
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setIndex(new THREE.BufferAttribute(idx, 1)); tg.computeVertexNormals();
  const nrm = tg.getAttribute('normal').array;
  const grass = new THREE.Color('#4f6b34'), grass2 = new THREE.Color('#3b5a2a'), rock = new THREE.Color('#7a756a'), dirt = new THREE.Color('#6b5a40'), tmp = new THREE.Color();
  for (let k = 0; k < H.length; k++) {
    const i = Math.floor(k / (RES + 1)), j = k % (RES + 1);
    const ny = nrm[k * 3 + 1], v = vnoise(i * 0.35, j * 0.35);
    tmp.copy(grass).lerp(grass2, v);
    tmp.lerp(rock, smoothStep(0.9, 0.72, ny));
    const x = X0 + i * S, y = X0 + j * S;
    if (Math.hypot(x, y) < PAD_R + 4) tmp.lerp(dirt, 0.6);
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true })));

  function groundHeight(x, y) {
    const fi = (x - X0) / S, fj = (y - X0) / S;
    const i = Math.max(0, Math.min(RES - 1, Math.floor(fi))), j = Math.max(0, Math.min(RES - 1, Math.floor(fj)));
    const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j));
    const a = H[i * (RES + 1) + j], b = H[(i + 1) * (RES + 1) + j], c = H[i * (RES + 1) + j + 1], d = H[(i + 1) * (RES + 1) + j + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function groundNormal(x, y) {
    const e = 1, hx = (groundHeight(x + e, y) - groundHeight(x - e, y)) / (2 * e), hy = (groundHeight(x, y + e) - groundHeight(x, y - e)) / (2 * e);
    const l = Math.hypot(hx, hy, 1); return v3(-hx / l, -hy / l, 1 / l);
  }

  // ---------- road ribbons ----------
  function ribbon(o0, o1, lift, color) {
    const p = new Float32Array(N * 2 * 3), ix = [];
    road.forEach((r, i) => {
      const nx = -r.ty, ny = r.tx; // left normal (UE: X north, Y east -> left of travel)
      const A = toThree(r.x + nx * o0, r.y + ny * o0, r.h + lift), B = toThree(r.x + nx * o1, r.y + ny * o1, r.h + lift);
      p.set([A.x, A.y, A.z, B.x, B.y, B.z], i * 6);
      const a = i * 2, b = a + 1, c = ((i + 1) % N) * 2, d = c + 1;
      ix.push(a, b, c, b, d, c);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 - lift * 10, polygonOffsetUnits: -1 }));
    scene.add(m);
  }
  ribbon(-ROAD_W / 2 - 0.8, ROAD_W / 2 + 0.8, 0.0, '#77705f'); // gravel shoulder
  ribbon(-ROAD_W / 2, ROAD_W / 2, 0.02, '#35363a');
  ribbon(-ROAD_W / 2 + 0.15, -ROAD_W / 2 + 0.3, 0.04, '#e8e6de');
  ribbon(ROAD_W / 2 - 0.3, ROAD_W / 2 - 0.15, 0.04, '#e8e6de');
  ribbon(-0.22, -0.08, 0.04, '#e3b21f');
  ribbon(0.08, 0.22, 0.04, '#e3b21f');

  // ---------- obstacles (trees, gate posts) ----------
  const obstacles = [], OCELL = 12, ogrid = new Map();
  const addObstacle = (x, y, r, top) => { const o = { x, y, r, top }; obstacles.push(o); const k = key(Math.floor(x / OCELL), Math.floor(y / OCELL)); if (!ogrid.has(k)) ogrid.set(k, []); ogrid.get(k).push(o); };

  // forest
  let seed = 7; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const trees = [];
  while (trees.length < 2600) {
    const x = (rnd() * 2 - 1) * 680, y = (rnd() * 2 - 1) * 680;
    if (Math.hypot(x, y) < PAD_R + 22) continue;
    if (nearestRoad(x, y).d < 9) continue;
    const n = groundNormal(x, y); if (n.z < 0.8) continue;
    const s = 0.7 + rnd() * 0.8; trees.push({ x, y, z: groundHeight(x, y), s, c: rnd() });
  }
  const trunkG = new THREE.CylinderGeometry(0.25, 0.4, 4, 5); trunkG.translate(0, 2, 0);
  const crownG = new THREE.ConeGeometry(2.6, 11, 7); crownG.translate(0, 8.5, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: '#4a3726' }), trees.length);
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), trees.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), cc = new THREE.Color();
  const greens = ['#24401f', '#2d4d26', '#1f3a22', '#35552b', '#29462a'].map(c => new THREE.Color(c));
  trees.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.c * 6.28); sc.set(t.s, t.s * (0.85 + t.c * 0.4), t.s);
    M.compose(toThree(t.x, t.y, t.z - 0.3), q, sc); trunks.setMatrixAt(i, M); crowns.setMatrixAt(i, M);
    crowns.setColorAt(i, cc.copy(greens[Math.floor(t.c * 5)]));
    addObstacle(t.x, t.y, 1.7 * t.s, t.z + 14 * t.s * (0.85 + t.c * 0.4));
  });
  scene.add(trunks, crowns);

  // FPV gates over the road
  const gateMat = new THREE.MeshLambertMaterial({ color: '#ff6a2a', emissive: '#5a1a00' });
  const gates = [];
  for (let g = 0; g < 10; g++) {
    const r = road[Math.floor((g + 0.5) * N / 10)];
    const nx = -r.ty, ny = r.tx, half = ROAD_W / 2 + 0.6, height = 4.5;
    const grp = new THREE.Group();
    for (const sgn of [-1, 1]) {
      const px = r.x + nx * half * sgn, py = r.y + ny * half * sgn;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, height, 6), gateMat);
      post.position.copy(toThree(px, py, r.h + height / 2)); grp.add(post);
      addObstacle(px, py, 0.15, r.h + height);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.3, 0.3, 0.3), gateMat);
    bar.position.copy(toThree(r.x, r.y, r.h + height));
    bar.rotation.y = Math.atan2(-r.ty, r.tx); // bar spans across the road
    grp.add(bar); scene.add(grp);
    gates.push({ x: r.x, y: r.y, z: r.h, tx: r.tx, ty: r.ty, half, height });
  }

  // takeoff pad
  const pad = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshLambertMaterial({ color: '#2a2c30' }));
  pad.rotation.x = -Math.PI / 2; pad.position.copy(toThree(0, 0, padH + 0.05)); scene.add(pad);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.7, 32), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(toThree(0, 0, padH + 0.07)); scene.add(ring);

  // fence ring (Drone > Fence > MaxDistanceM) drawn on the ground
  const fencePts = [];
  for (let a = 0; a <= 128; a++) { const t = a / 128 * Math.PI * 2, x = Math.cos(t) * 500, y = Math.sin(t) * 500; fencePts.push(toThree(x, y, groundHeight(x, y) + 1.5)); }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(fencePts), new THREE.LineBasicMaterial({ color: '#ff4040', transparent: true, opacity: 0.55 })));

  // sky dome
  const skyG = new THREE.SphereGeometry(3500, 32, 16), sc2 = [];
  const top = new THREE.Color('#4a74a8'), hor = new THREE.Color('#d9dfe0');
  const sp = skyG.getAttribute('position');
  for (let i = 0; i < sp.count; i++) { const t = Math.max(0, sp.getY(i) / 3500); const c = hor.clone().lerp(top, Math.pow(t, 0.6)); sc2.push(c.r, c.g, c.b); }
  skyG.setAttribute('color', new THREE.Float32BufferAttribute(sc2, 3));
  scene.add(new THREE.Mesh(skyG, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  scene.fog = new THREE.Fog('#d3dadc', 250, 1400);
  scene.add(new THREE.HemisphereLight('#dfe8f0', '#3a4a2a', 1.6));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.0); sun.position.set(300, 500, 200); scene.add(sun);

  function resolveObstacles(p, r) {
    const ci = Math.floor(p.x / OCELL), cj = Math.floor(p.y / OCELL); let normal = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = ogrid.get(key(ci + a, cj + b)); if (!L) continue;
      for (const o of L) {
        if (p.z > o.top + r) continue;
        const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy), min = o.r + r;
        if (d < min && d > 1e-4) { p.x = o.x + dx / d * min; p.y = o.y + dy / d * min; normal = v3(dx / d, dy / d, 0); }
      }
    }
    return normal;
  }

  // start on the pad, facing the first stretch of road
  const first = road[0];
  const spawnYaw = Math.atan2(first.y, first.x) * 180 / Math.PI;
  return {
    groundHeight, groundNormal, resolveObstacles, road, gates,
    origin: v3(0, 0, padH),
    spawn: { x: 0, y: 0, z: padH + 1.2, yaw: spawnYaw },
  };
}
