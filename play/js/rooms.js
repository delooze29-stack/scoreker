// The room round the table: a TV studio for snooker, a pub for UK pool, a tournament arena for US pool.
// Kept dim so the lit table is the picture.
import { canvasTex, carpetTex, boardsTex, woodTex } from "./tex.js";

const THREE = window.THREE;
const V3 = (x, h, y) => new THREE.Vector3(x, h, -y);
const FLOOR = -0.84;

function floor(G, mx, my, mat) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), mat); f.rotation.x = -Math.PI / 2; f.position.copy(V3(mx, FLOOR, my)); f.receiveShadow = true; G.add(f); return f;
}
// a flat panel facing the table from (x, y), `ry` turning it to face inwards
function panel(G, x, y, h0, w, h, ry, mat) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.copy(V3(x, h0 + h / 2, y)); m.rotation.y = ry; G.add(m); return m; }
// the four sides of a rectangle round the table: [x, y, length, facing]
const sides = (mx, my, dx, dy) => [[mx, my - dy, 2 * dx, Math.PI], [mx, my + dy, 2 * dx, 0], [mx - dx, my, 2 * dy, Math.PI / 2], [mx + dx, my, 2 * dy, -Math.PI / 2]];
// a point on a wall: k along it (-0.5..0.5), `out` metres off it towards the table
const onWall = ([x, y, len, ry], k, out = 0) => ({ x: x + Math.cos(ry) * k * len + Math.sin(ry) * out, y: y + Math.sin(ry) * k * len - Math.cos(ry) * out });

// A dim seated crowd on stepped tiers.
function crowd(G, mx, my, bx, by, rows, lit) {
  const seatCols = [0x141a26, 0x241519, 0x181b20, 0x261d16, 0x15211b, 0x2a2a30, 0x101116, 0x331a1d, 0x1b2a3a];
  const person = new THREE.CylinderGeometry(0.21, 0.17, 0.52, 10), headG = new THREE.SphereGeometry(0.095, 10, 8), list = [];
  person.scale(1, 1, 0.62); headG.scale(0.92, 1.1, 1);
  const tier = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.95, envMapIntensity: 0 });
  [[0, -1, bx * 2 + 3], [0, 1, bx * 2 + 3], [-1, 0, by * 2 + 3], [1, 0, by * 2 + 3]].forEach(([sx, sy, len]) => {
    for (let r = 0; r < rows; r++) {
      const dist = (sx ? bx : by) + 1.9 + r * 0.8, h = FLOOR + 0.3 + r * 0.42, span = len + 1.8 + r * 1.6;
      const step = new THREE.Mesh(new THREE.BoxGeometry(sx ? 0.8 : span, 0.42, sx ? span : 0.8), tier);
      step.position.copy(V3(mx + sx * dist, h - 0.21, my + sy * dist)); G.add(step);
      for (let k = -span / 2; k < span / 2; k += 0.44 + Math.random() * 0.16) {
        if (Math.random() < 0.14) continue;
        list.push({ x: mx + sx * dist + (sx ? 0 : k), y: my + sy * dist + (sx ? k : 0), h: h + 0.25 + Math.random() * 0.05, c: seatCols[(Math.random() * seatCols.length) | 0], ry: Math.atan2(sx, sy) });
      }
    }
  });
  const im = new THREE.InstancedMesh(person, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, envMapIntensity: 0 }), list.length);
  const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, envMapIntensity: 0 }), list.length);
  const skin = [0x6b4a3a, 0x4a3226, 0x8a6650, 0x3a2519, 0x70523f];
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => {
    q.setFromAxisAngle(up, p.ry);
    mtx.compose(V3(p.x, p.h, p.y), q, one); im.setMatrixAt(i, mtx); im.setColorAt(i, col.setHex(p.c).multiplyScalar(lit));
    mtx.compose(V3(p.x, p.h + 0.39, p.y), q, one); heads.setMatrixAt(i, mtx); heads.setColorAt(i, col.setHex(skin[i % skin.length]).multiplyScalar(lit * 0.8));
  });
  G.add(im, heads);
}

function hoarding(G, mx, my, dx, dy, tex, led, h = 0.7) { // advertising boards round the playing floor
  const dark = new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 0.7 });
  sides(mx, my, dx, dy).forEach(([x, y, len, ry]) => {
    const t = tex.clone(); t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.max(1, Math.round(len / (h * 9))), 1);
    const face = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3, roughness: 0.6 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(len + 0.08, h, 0.08), [dark, dark, dark, dark, face, dark]);
    b.position.copy(V3(x, FLOOR + h / 2, y)); b.rotation.y = ry; b.receiveShadow = true; G.add(b);
    if (led != null) { const l = new THREE.Mesh(new THREE.BoxGeometry(len + 0.08, 0.018, 0.085), new THREE.MeshBasicMaterial({ color: led })); l.position.copy(V3(x, FLOOR + h + 0.009, y)); l.rotation.y = ry; G.add(l); }
  });
}

function tvCamera() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.45, metalness: 0.6 });
  const cam = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 1.25, 8), metal);
    leg.position.set(Math.cos(a) * 0.22, 0.55, Math.sin(a) * 0.22); leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); cam.add(leg);
  }
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 10), metal); col.position.y = 1.25; cam.add(col);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.24), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.3 })); body.position.set(0.05, 1.5, 0); cam.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.38, 20), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.3, metalness: 0.5 }));
  lens.rotation.z = Math.PI / 2; lens.position.set(0.48, 1.5, 0); cam.add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshStandardMaterial({ color: 0x223355, roughness: 0.05, metalness: 0.9 })); glass.rotation.y = Math.PI / 2; glass.position.set(0.672, 1.5, 0); cam.add(glass);
  const vf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12), metal); vf.position.set(-0.2, 1.68, 0.05); cam.add(vf);
  const tally = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); tally.position.set(0.28, 1.65, 0); cam.add(tally);
  cam.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return cam;
}

// ---------------------------------------------------------------- snooker: the TV studio
function studio(G, L, W) {
  const mx = L / 2, my = W / 2;
  floor(G, mx, my, new THREE.MeshStandardMaterial({ color: 0xffffff, map: carpetTex(0x1d2c47, [60, 60]), roughness: 1, envMapIntensity: 0 }));
  const dx = L / 2 + 2.6, dy = W / 2 + 2.3;
  const ad = canvasTex(2048, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#0d1b40"); gr.addColorStop(1, "#070f26"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f2b71f"; g.fillRect(0, h - 22, w, 22);
    g.textBaseline = "middle"; g.textAlign = "center";
    [[w * 0.25, "SCOREKER", "#ffffff"], [w * 0.75, "CUE CLUB", "#f2b71f"]].forEach(([x, t, c]) => { g.font = "bold 132px 'Bebas Neue', Impact, sans-serif"; g.fillStyle = c; g.fillText(t, x, h * 0.46, w * 0.4); });
  });
  hoarding(G, mx, my, dx, dy, ad, 0xf2b71f, 0.8);
  crowd(G, mx, my, dx, dy, 6, 0.3);
  // the set behind the crowd: dark drapes with tall warm light boxes
  const drape = new THREE.MeshStandardMaterial({ color: 0x0a1226, roughness: 1, envMapIntensity: 0 });
  const boxTex = canvasTex(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#5c3d00"); gr.addColorStop(0.5, "#f2b71f"); gr.addColorStop(1, "#7a5200"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const boxMat = new THREE.MeshBasicMaterial({ map: boxTex, color: 0x9a9a9a });
  sides(mx, my, dx + 7.2, dy + 7.2).forEach(side => {
    const [x, y, len, ry] = side;
    panel(G, x, y, FLOOR, len + 14, 8, ry, drape);
    const n = Math.round(len / 2.6);
    for (let i = 0; i < n; i++) { const p = onWall(side, (i + 0.5) / n - 0.5, 0.05); panel(G, p.x, p.y, FLOOR + 2.6, 0.7, 3.4, ry, boxMat); }
  });
  const c1 = tvCamera(); c1.position.copy(V3(L * 0.3, FLOOR, W + 1.6)); c1.rotation.y = -Math.PI / 2 - 0.5; G.add(c1);
  const c2 = tvCamera(); c2.position.copy(V3(L * 0.72, FLOOR, -1.6)); c2.rotation.y = Math.PI / 2 - 0.5; G.add(c2);
  return { bg: 0x05070d, fog: [10, 30], hemi: [0xfff3e2, 0x1a1c24, 0.3], fill: [0xc8d2f0, 0.2, 2.6] };
}

// ---------------------------------------------------------------- UK pool: the pub
function pub(G, L, W) {
  const mx = L / 2, my = W / 2;
  floor(G, mx, my, new THREE.MeshStandardMaterial({ color: 0xffffff, map: boardsTex(0x5a3a22, [14, 26]), roughness: 0.62, envMapIntensity: 0.2 }));
  const dx = L / 2 + 2.9, dy = W / 2 + 2.6, hgt = 3;
  const wall = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = "#3a1f1c"; g.fillRect(0, 0, w, h); // deep red wallpaper
    g.strokeStyle = "rgba(255,210,150,.07)"; g.lineWidth = 3;
    for (let y = 30; y < h * 0.62; y += 86) for (let x = (y / 86 % 2) * 64; x < w; x += 128) { g.beginPath(); g.moveTo(x, y - 26); g.quadraticCurveTo(x + 24, y, x, y + 26); g.quadraticCurveTo(x - 24, y, x, y - 26); g.stroke(); }
    const y0 = h * 0.64; // panelled wainscot
    g.fillStyle = "#24160e"; g.fillRect(0, y0, w, h - y0);
    g.fillStyle = "#3b2414"; g.fillRect(0, y0, w, 22);
    for (let x = 0; x < w; x += 256) { g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 5; g.strokeRect(x + 26, y0 + 50, 204, h - y0 - 96); g.strokeStyle = "rgba(255,200,140,.08)"; g.lineWidth = 2; g.strokeRect(x + 30, y0 + 54, 204, h - y0 - 96); }
    g.fillStyle = "#170d08"; g.fillRect(0, h - 34, w, 34);
  });
  const walls = sides(mx, my, dx, dy);
  const glow = canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h * 0.6, 0, w / 2, h * 0.6, w / 2); gr.addColorStop(0, "rgba(255,196,120,.85)"); gr.addColorStop(0.4, "rgba(255,160,80,.25)"); gr.addColorStop(1, "rgba(255,150,60,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const glowMat = new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const brass = new THREE.MeshStandardMaterial({ color: 0x9a7a3a, roughness: 0.35, metalness: 0.9 }), shadeMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide });
  walls.forEach((side, i) => {
    const [x, y, len, ry] = side;
    const t = wall.clone(); t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 3, 1);
    panel(G, x, y, FLOOR, len, hgt, ry, new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, envMapIntensity: 0.05 })).receiveShadow = true;
    if (i === 3) return; // the bar is along this wall
    const n = i < 2 ? 3 : 2; // brass wall lights with a warm glow on the wallpaper
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n - 0.5, g0 = onWall(side, f, 0.012), s0 = onWall(side, f, 0.12), a0 = onWall(side, f, 0.06);
      panel(G, g0.x, g0.y, FLOOR + 1.25, 1.5, 1.5, ry, glowMat);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.13, 14, 1, true), shadeMat); shade.position.copy(V3(s0.x, FLOOR + 1.95, s0.y)); G.add(shade);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.12), brass); arm.position.copy(V3(a0.x, FLOOR + 1.86, a0.y)); arm.rotation.y = ry; G.add(arm);
    }
  });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * dx, 2 * dy), new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 1, envMapIntensity: 0 })); ceil.rotation.x = Math.PI / 2; ceil.position.copy(V3(mx, FLOOR + hgt, my)); G.add(ceil);
  // framed pictures and a dartboard
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.5 });
  const pic = (wi, k, w, h, col) => {
    const side = walls[wi], ry = side[3], a = onWall(side, k, 0.016), b2 = onWall(side, k, 0.033);
    const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.03), frameMat); f.position.copy(V3(a.x, FLOOR + 1.75, a.y)); f.rotation.y = ry; G.add(f);
    const t = canvasTex(128, 128, (g, cw, chh) => { g.fillStyle = col; g.fillRect(0, 0, cw, chh); g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.arc(cw * 0.5, chh * 0.62, cw * 0.3, Math.PI, 0); g.fill(); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, chh * 0.62, cw, chh); });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 })); p.position.copy(V3(b2.x, FLOOR + 1.75, b2.y)); p.rotation.y = ry; G.add(p);
  };
  pic(1, -0.2, 0.7, 0.5, "#31402f"); pic(1, 0.22, 0.5, 0.6, "#3c3a52"); pic(2, 0.18, 0.6, 0.45, "#4a3a2a"); pic(0, 0.3, 0.6, 0.45, "#4a2f2a");
  const dart = canvasTex(256, 256, (g, w, h) => {
    g.translate(w / 2, h / 2); g.fillStyle = "#0b0b0b"; g.beginPath(); g.arc(0, 0, 126, 0, 7); g.fill();
    for (let i = 0; i < 20; i++) { const a0 = (i - 0.5) / 20 * Math.PI * 2, a1 = (i + 0.5) / 20 * Math.PI * 2; g.fillStyle = i % 2 ? "#e9dfc4" : "#161616"; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 100, a0, a1); g.fill(); g.strokeStyle = i % 2 ? "#1f7a3a" : "#b3261e"; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 97, a0, a1); g.stroke(); g.beginPath(); g.arc(0, 0, 60, a0, a1); g.stroke(); }
    g.fillStyle = "#1f7a3a"; g.beginPath(); g.arc(0, 0, 10, 0, 7); g.fill(); g.fillStyle = "#b3261e"; g.beginPath(); g.arc(0, 0, 4.5, 0, 7); g.fill();
  });
  const db = new THREE.Mesh(new THREE.CircleGeometry(0.23, 32), new THREE.MeshStandardMaterial({ map: dart, roughness: 0.8 })); { const p = onWall(walls[2], -0.2, 0.02); db.position.copy(V3(p.x, FLOOR + 1.73, p.y)); db.rotation.y = walls[2][3]; G.add(db); }
  // the bar along the far end, with a lit back shelf
  const barMat = new THREE.MeshPhysicalMaterial({ map: woodTex(0x3a2213, { rep: [2, 2] }), roughness: 0.4, clearcoat: 0.5, envMapIntensity: 0.4 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.08, 2 * dy - 1.6), barMat); bar.position.copy(V3(mx + dx - 1.1, FLOOR + 0.54, my + 0.2)); bar.castShadow = bar.receiveShadow = true; G.add(bar);
  const topM = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 2 * dy - 1.5), barMat); topM.position.copy(V3(mx + dx - 1.1, FLOOR + 1.1, my + 0.2)); G.add(topM);
  const shelf = canvasTex(512, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#2a1608"); gr.addColorStop(1, "#b0702a"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const cols = ["#3a5a2a", "#7a4a1a", "#c9a24a", "#2a3a5a", "#8a2a1a", "#d8d0b8", "#1a2a1a"];
    for (let x = 8; x < w - 8; x += 15) { const bh = 44 + (x * 7 % 30); g.fillStyle = cols[(x * 13) % cols.length]; g.fillRect(x, h - bh - 6, 9, bh); g.fillRect(x + 3, h - bh - 18, 3, 12); }
    g.fillStyle = "#170d08"; g.fillRect(0, h - 6, w, 6);
  });
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2 * dy - 2, 0.55), new THREE.MeshBasicMaterial({ map: shelf, color: 0xb0b0b0 })); sh.position.copy(V3(mx + dx - 0.03, FLOOR + 1.62, my + 0.2)); sh.rotation.y = -Math.PI / 2; G.add(sh);
  for (let i = 0; i < 4; i++) { // stools
    const y = my - 1.4 + i * 0.95, seat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 18), new THREE.MeshStandardMaterial({ color: 0x2e0c0a, roughness: 0.55 })); seat.position.copy(V3(mx + dx - 1.75, FLOOR + 0.76, y)); seat.castShadow = true; G.add(seat);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.74, 8), new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.3, metalness: 0.9 })); post.position.copy(V3(mx + dx - 1.75, FLOOR + 0.37, y)); G.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 18), post.material); foot.position.copy(V3(mx + dx - 1.75, FLOOR + 0.015, y)); G.add(foot);
  }
  // a cue rack on the wall
  const rackM = new THREE.MeshStandardMaterial({ color: 0x2a180d, roughness: 0.5 });
  const rk = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.06), rackM); rk.position.copy(V3(mx - 1.6, FLOOR + 1.5, my - dy + 0.04)); G.add(rk);
  const rk2 = rk.clone(); rk2.position.y = FLOOR + 0.45; G.add(rk2);
  for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 1.45, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xc9a268 : 0xb58a52, roughness: 0.45 })); c.position.copy(V3(mx - 1.85 + i * 0.17, FLOOR + 1.12, my - dy + 0.09)); G.add(c); }
  return { bg: 0x0b0705, fog: [9, 26], hemi: [0xffe2c0, 0x1a100a, 0.3], fill: [0xffb070, 0.5, 2.3] };
}

// ---------------------------------------------------------------- US pool: the arena
function arena(G, L, W) {
  const mx = L / 2, my = W / 2;
  floor(G, mx, my, new THREE.MeshStandardMaterial({ color: 0xffffff, map: carpetTex(0x15171c, [60, 60]), roughness: 1, envMapIntensity: 0 }));
  const dx = L / 2 + 2.2, dy = W / 2 + 2.0;
  const ad = canvasTex(2048, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#40090c"); gr.addColorStop(1, "#1c0405"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.font = "bold 150px 'Bebas Neue', Impact, sans-serif"; g.textBaseline = "middle"; g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.9)";
    g.font = "bold 132px 'Bebas Neue', Impact, sans-serif"; [[w * 0.25, "SCOREKER"], [w * 0.75, "CUE CLUB"]].forEach(([x, t]) => g.fillText(t, x, h * 0.52, w * 0.4));
  });
  hoarding(G, mx, my, dx, dy, ad, 0x7a0c10, 0.7);
  crowd(G, mx, my, dx, dy, 7, 0.26);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 1, envMapIntensity: 0 });
  sides(mx, my, dx + 7.4, dy + 7.4).forEach(([x, y, len, ry]) => panel(G, x, y, FLOOR, len + 16, 9, ry, wallMat));
  // lighting truss high over the floor with small lamps
  const truss = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.7 }), lamp = new THREE.MeshBasicMaterial({ color: 0xcfd8ff });
  [[-1, 0], [1, 0]].forEach(([s]) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * dx + 2, 0.12, 0.12), truss); bar.position.copy(V3(mx, 3.6, my + s * (dy + 0.6))); G.add(bar);
    for (let i = -3; i <= 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), lamp); b.position.copy(V3(mx + i * (dx / 3.2), 3.5, my + s * (dy + 0.6))); G.add(b); }
  });
  return { bg: 0x040507, fog: [9, 28], hemi: [0xfff3e2, 0x101216, 0.26], fill: [0xc0c8e8, 0.2, 2.8] };
}

export function buildRoom(G, env, L, W) { return env === "studio" ? studio(G, L, W) : env === "pub" ? pub(G, L, W) : arena(G, L, W); }

// What the balls reflect: the long lamp over the table, and a hint of the room.
export function envScene(env, L, W) {
  const s = new THREE.Scene(); s.background = new THREE.Color(env === "studio" ? 0x0a0f1c : env === "pub" ? 0x140c07 : 0x07080b);
  const lampCol = env === "pub" ? 0xffe2b8 : 0xfff6e6;
  const n = L > 3 ? 3 : 2, len = L * 0.8 / n;
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.86, W * 0.3), new THREE.MeshBasicMaterial({ color: lampCol })); p.rotation.x = Math.PI / 2;
    p.position.set((i + 0.5 - n / 2) * len, 1.25, 0); s.add(p);
  }
  const band = env === "studio" ? 0x2a2a34 : env === "pub" ? 0x3a2414 : 0x2a1416;
  [[0, -7, 0], [0, 7, Math.PI], [-7, 0, Math.PI / 2], [7, 0, -Math.PI / 2]].forEach(([x, z, ry]) => { const b = new THREE.Mesh(new THREE.PlaneGeometry(22, 1.2), new THREE.MeshBasicMaterial({ color: band })); b.position.set(x, 0.4, z); b.rotation.y = ry; s.add(b); });
  const f = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ color: env === "studio" ? 0x12301c : env === "pub" ? 0x10301c : 0x0c2440 })); f.rotation.x = -Math.PI / 2; f.position.y = -0.6; s.add(f);
  return s;
}
