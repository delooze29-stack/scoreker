// 3D view. Physics (x, y) on the table maps to three.js (x, height, -y).
import { defs as defsList } from "./rules.js";
import { C, canvasTex, ballTex, woodTex, radialTex } from "./tex.js";
import { buildTable3D } from "./table3d.js";
import { buildRoom, envScene } from "./rooms.js";

const THREE = window.THREE;
const V3 = (x, h, y) => new THREE.Vector3(x, h, -y);

// ---------------------------------------------------------------- the view
// Final pass when post effects are on: ACES tone mapping, sRGB output and a light vignette.
const OutputShader = {
  uniforms: { tDiffuse: { value: null }, exposure: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float exposure; varying vec2 vUv;
    vec3 fit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c *= exposure / 0.6; return clamp(O * fit(I * c), 0.0, 1.0); }
    vec3 srgb(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    void main(){ vec3 c = aces(texture2D(tDiffuse, vUv).rgb); vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.32; gl_FragColor = vec4(srgb(c), 1.0); }`,
};

const _ax = new THREE.Vector3();

export class View {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false; this.shadowDirty = 3;
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92;
    host.prepend(r.domElement);
    this.quality = "high"; this.exposure = 0.92;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090a);
    this.scene.fog = new THREE.Fog(0x07090a, 6, 15);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    this.cam = { pos: null, look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), mode: "" };
    this.ray = new THREE.Raycaster();
    this.buildEnv();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  }
  // High: bloom on the highlights and lights, HDR tone mapping, sharper shadows. Standard: lighter on the phone.
  // Smoothness first: lower the drawing resolution a step when the phone can't keep up.
  scaleResolution(f) {
    const r = this.renderer, max = Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 2.5 : 1.5);
    const pr = Math.max(0.75, Math.min(max, r.getPixelRatio() * f));
    if (Math.abs(pr - r.getPixelRatio()) < 0.02) return;
    r.setPixelRatio(pr); this.resize();
  }
  setQuality(q) {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === "high" ? 2.5 : 1.5));
    this.composer = null;
    if (q === "high" && THREE.EffectComposer && THREE.UnrealBloomPass) {
      try {
        const w = this.host.clientWidth || 400, h = this.host.clientHeight || 600, pr = r.getPixelRatio();
        const ext = r.extensions, hdr = r.capabilities.isWebGL2 && (ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float"));
        const opts = { format: THREE.RGBAFormat, type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, stencilBuffer: true }; // with a stencil the depth buffer is 24-bit, not 16: no flicker between the cloth and what lies on it
        const rt = r.capabilities.isWebGL2 ? new THREE.WebGLMultisampleRenderTarget(w * pr, h * pr, opts) : new THREE.WebGLRenderTarget(w * pr, h * pr, opts);
        const c = new THREE.EffectComposer(r, rt);
        c.addPass(new THREE.RenderPass(this.scene, this.camera));
        this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.5, 0.96);
        c.addPass(this.bloom);
        this.out = new THREE.ShaderPass(OutputShader); c.addPass(this.out);
        this.composer = c;
      } catch (e) { console.warn("post effects off", e); this.composer = null; }
    }
    r.toneMapping = this.composer ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
    this.resize();
  }
  buildEnv(env = "arena", L = 2.2, W = 1.1) { // what the lacquered balls and rails reflect
    const pm = new THREE.PMREMGenerator(this.renderer), old = this.scene.environment;
    this.scene.environment = pm.fromScene(envScene(env, L, W), 0.02).texture; pm.dispose(); if (old) old.dispose();
  }

  // -------------------------------------------------------------- table + room
  build(table, game, style) {
    if (this.group) { // clear the last table out properly, textures and all (ball designs are shared and kept)
      this.scene.remove(this.group);
      this.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => {
          for (const k of ["map", "normalMap", "emissiveMap"]) if (m[k] && !m[k].keep) m[k].dispose();
          m.dispose();
        });
      });
    }
    const G = this.group = new THREE.Group(); this.scene.add(G);
    this.table = table; this.game = game; this.style = style;
    const { L, W } = table, hi = this.quality === "high";
    this.buildEnv(style.env, L, W);

    const dims = buildTable3D(G, table, game, style, this.quality);
    this.rh = dims.rh; this.ch = dims.ch;
    const room = buildRoom(G, style.env, L, W);
    this.scene.background = C(room.bg); this.scene.fog = new THREE.Fog(C(room.bg), room.fog[0], room.fog[1]);
    this.exposure = style.exposure || 1; this.renderer.toneMappingExposure = this.exposure;

    // Light: one long lamp over the table. A shadow-casting key from straight above, soft pools
    // that fall away past the rails, and a little coloured fill from the room.
    G.add(new THREE.HemisphereLight(room.hemi[0], room.hemi[1], room.hemi[2]));
    const key = new THREE.DirectionalLight(0xfff4e2, 0.55); key.position.set(L / 2, 3.2, -W / 2 - 0.42); key.target.position.set(L / 2, 0, -W / 2); // leaning only across the table, so the shadow map stays square to it
    const sm = hi ? 4096 : 2048; key.castShadow = true; key.shadow.mapSize.set(sm, sm); key.shadow.bias = -0.00025; key.shadow.normalBias = 0.0035;
    Object.assign(key.shadow.camera, { left: -L / 2 - 0.55, right: L / 2 + 0.55, top: W / 2 + 0.55, bottom: -W / 2 - 0.55, near: 1.5, far: 4.6 });
    G.add(key, key.target);
    const nSpots = L > 3 ? 3 : 2;
    for (let i = 0; i < nSpots; i++) {
      const f = (i + 0.5) / nSpots, s = new THREE.SpotLight(0xfff0d8, 0.42, 7, 1.0, 0.85, 1.1);
      s.position.copy(V3(L * f, 1.75, W / 2)); s.target.position.copy(V3(L * f, 0, W / 2)); G.add(s, s.target);
    }
    const fill = new THREE.PointLight(room.fill[0], room.fill[1], 18, 1.4); fill.position.copy(V3(L / 2, room.fill[2], W / 2)); G.add(fill);
    // the lamp itself (hidden when it would get in the way of the camera)
    const shade = new THREE.Mesh(new THREE.BoxGeometry(L * 0.86, 0.1, W * 0.6), new THREE.MeshStandardMaterial({ color: C(0x101214), roughness: 0.4, metalness: 0.5 }));
    shade.position.copy(V3(L / 2, 1.62, W / 2)); G.add(shade);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.82, W * 0.54), new THREE.MeshBasicMaterial({ color: C(0xfff3df) }));
    glow.rotation.x = Math.PI / 2; glow.position.copy(V3(L / 2, 1.568, W / 2)); G.add(glow);
    this.canopy = [shade, glow];

    this.buildBalls(game);
    this.buildCue(game);
    this.buildGuides();
    this.shadowDirty = 3;
  }

  buildBalls(game) {
    this.balls = new Map();
    const R = this.table.R;
    this.blobGeo = new THREE.PlaneGeometry(R * 2.9, R * 2.9);
    this.blobMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: radialTex([[0, "rgba(0,0,0,.82)"], [0.3, "rgba(0,0,0,.5)"], [0.62, "rgba(0,0,0,.14)"], [1, "rgba(0,0,0,0)"]], 64) });
    const geo = new THREE.SphereGeometry(R, 56, 40), mats = new Map();
    for (const d of defsList(game)) {
      const tex = ballTex(d);
      if (!mats.has(tex)) mats.set(tex, new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tex, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.95 }));
      const m = new THREE.Mesh(geo, mats.get(tex)); m.castShadow = true;
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.group.add(m);
      const sh = new THREE.Mesh(this.blobGeo, this.blobMat); sh.rotation.x = -Math.PI / 2; sh.renderOrder = 2; this.group.add(sh);
      this.balls.set(d.id, { mesh: m, pot: null, shadow: sh });
    }
  }
  buildCue(game) {
    // A proper two-piece cue: leather tip, ferrule, pale ash shaft, a brass joint and a dark butt.
    const g = new THREE.Group(), len = 1.47, snooker = game === "snooker" || game === "uk";
    const part = (r1, r2, l, y, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, l, 24), mat); m.position.y = y; m.castShadow = true; g.add(m); return m; };
    const grainS = woodTex(0xd9b77e, { figure: 0.7, rep: [1, 3] }); grainS.rotation = Math.PI / 2;
    const grainB = woodTex(snooker ? 0x1c120c : 0x24160e, { figure: 0.5, rep: [1, 3] }); grainB.rotation = Math.PI / 2;
    const shaft = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: grainS, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.4 });
    const butt = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: grainB, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.1, envMapIntensity: 0.5 });
    const brass = new THREE.MeshStandardMaterial({ color: C(0xc9a24a), roughness: 0.25, metalness: 1, envMapIntensity: 1 });
    const tipR = snooker ? 0.0048 : 0.0064, t2 = tipR + 0.0002, jointR = snooker ? 0.0105 : 0.0112, buttR = snooker ? 0.0146 : 0.0152;
    part(tipR * 0.92, tipR, 0.007, -0.0035, new THREE.MeshStandardMaterial({ color: C(0x2c5c8a), roughness: 1 }));
    part(tipR, t2, 0.012, -0.013, snooker ? brass : new THREE.MeshStandardMaterial({ color: C(0xf1ede0), roughness: 0.3 }));
    part(t2, jointR, len * 0.55, -0.019 - len * 0.275, shaft);
    part(jointR + 0.0002, jointR + 0.0004, 0.022, -0.019 - len * 0.55 - 0.011, brass);
    part(jointR + 0.0004, buttR, len * 0.42, -0.041 - len * 0.55 - len * 0.21, butt);
    part(buttR, buttR * 0.96, 0.014, -0.041 - len * 0.97 - 0.007, new THREE.MeshStandardMaterial({ color: C(0x0c0c0c), roughness: 0.6 }));
    const inner = new THREE.Group(); inner.add(g); g.rotation.x = -Math.PI / 2;
    this.cue = new THREE.Group(); this.cue.add(inner); this.cueInner = g; this.group.add(this.cue); this.cue.visible = false;
  }
  buildGuides() {
    // guide lines are flat strips of a fixed width on the cloth, so they stay visible on sharp phone screens
    const R = this.table.R;
    const mk = (color, op, width) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false })); m.userData.w = width; m.renderOrder = 3; return m; };
    this.guide = { aim: mk(0xffffff, .55, R * 0.12), obj: mk(0xffd66b, .9, R * 0.16), cue: mk(0xbfe3ff, .7, R * 0.12) };
    this.guide.ghost = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R * 1.02, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }));
    this.guide.ghost.renderOrder = 3;
    this.guide.ghost.rotation.x = -Math.PI / 2;
    const glowTex = canvasTex(64, 256, (g, w, h) => {
      for (let y = 0; y < h; y++) {
        const along = 1 - y / h, fade = Math.pow(along, 0.6) * (y < 6 ? y / 6 : 1);
        const gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(.35, `rgba(255,255,255,${.25 * fade})`); gr.addColorStop(.5, `rgba(255,255,255,${.7 * fade})`);
        gr.addColorStop(.65, `rgba(255,255,255,${.25 * fade})`); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(0, y, w, 1);
      }
    });
    glowTex.encoding = THREE.LinearEncoding;
    this.guide.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.guide.glow.renderOrder = 2;
    Object.values(this.guide).forEach(o => { o.visible = false; this.group.add(o); });
    // the cue ball's predicted run after contact: a short chain of strips that can curve
    this.guidePath = []; for (let i = 0; i < 16; i++) { const m = mk(0xbfe3ff, 0.75, R * 0.13); m.visible = false; this.group.add(m); this.guidePath.push(m); }
    this.zoneMesh = null;
  }

  // -------------------------------------------------------------- balls
  resetBalls(list) {
    this.shadowDirty = 2;
    for (const b of list) {
      const e = this.balls.get(b.id); if (!e) continue;
      e.pot = null; e.mesh.visible = b.on; e.mesh.scale.setScalar(1);
      e.mesh.position.copy(V3(b.x, this.table.R, b.y));
      e.shadow.visible = b.on; e.shadow.position.copy(V3(b.x, 0.0019, b.y));
    }
  }
  // Follow the physics; animate balls dropping into pockets.
  sync(world, dt) {
    const R = this.table.R;
    for (const b of world.balls) {
      const e = this.balls.get(b.id); if (!e) continue;
      const m = e.mesh;
      if (b.on) {
        if (!m.visible || Math.abs(m.position.x - b.x) + Math.abs(m.position.z + b.y) > 1e-6) this.shadowDirty = 2;
        m.visible = true; m.position.set(b.x, R, -b.y);
        const wx = b.wx, wy = b.wz, wz = -b.wy, w = Math.hypot(wx, wy, wz);
        if (w > 1e-3) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(wx / w, wy / w, wz / w), w * dt); m.quaternion.premultiply(q); }
        e.pot = null; e.shadow.visible = true; e.shadow.position.set(b.x, 0.0019, -b.y);
      } else if (b.pocket >= 0 && m.visible) {
        // potted: it carries on into the pocket, tips over the edge of the slate and drops out of sight
        e.shadow.visible = false;
        const p = this.table.pockets[b.pocket], H = p.drop, lim = Math.max(0.004, H.r - R * 0.8);
        if (!e.pot) { const v = b.potV || { x: 0, y: 0 }, sp = Math.hypot(v.x, v.y), k = sp > 1.6 ? 1.6 / sp : 1; e.pot = { x: m.position.x, y: -m.position.z, vx: v.x * k, vy: v.y * k, h: R, vh: 0 }; }
        const q = e.pot; let left = Math.min(dt, 0.1);
        while (left > 1e-5) {
          const h = Math.min(left, 0.008); left -= h;
          const dx = H.x - q.x, dy = H.y - q.y, d = Math.hypot(dx, dy) || 1e-6;
          q.vx += dx / d * 9 * h; q.vy += dy / d * 9 * h; q.vx *= 1 - 3 * h; q.vy *= 1 - 3 * h;
          q.x += q.vx * h; q.y += q.vy * h;
          const ex = q.x - H.x, ey = q.y - H.y, el = Math.hypot(ex, ey);
          if (el > lim && q.h < R * 0.6) { // against the back of the pocket
            const nx = ex / el, ny = ey / el, vn = q.vx * nx + q.vy * ny;
            q.x = H.x + nx * lim; q.y = H.y + ny * lim; if (vn > 0) { q.vx -= 1.35 * vn * nx; q.vy -= 1.35 * vn * ny; }
          }
          if (el < H.r - R * 0.2 || q.h < R) { q.vh -= 9.81 * h; q.h += q.vh * h; }
        }
        m.position.set(q.x, q.h, -q.y); this.shadowDirty = 2;
        const sp = Math.hypot(q.vx, q.vy);
        if (sp > 1e-3) m.rotateOnWorldAxis(_ax.set(-q.vy / sp, 0, -q.vx / sp).normalize(), sp / R * Math.min(dt, 0.1));
        if (q.h < -0.16) m.visible = false;
      } else if (!b.on && b.pocket < 0) { m.visible = false; e.shadow.visible = false; }
    }
  }
  potAnimating() { for (const e of this.balls.values()) if (e.pot && e.mesh.visible) return true; return false; }

  // -------------------------------------------------------------- cue + guides
  setCue(show, cue, angle, spin, gap, elevIn) {
    if (this.cue.visible !== !!show) this.shadowDirty = 2;
    this.cue.visible = !!show; if (!show) return;
    const R = this.table.R, ux = Math.cos(angle), uy = Math.sin(angle), rx = uy, ry = -ux;
    const depth = R * Math.sqrt(Math.max(0, 1 - (spin.x * spin.x + spin.y * spin.y) * 0.25));
    const tx = cue.x - ux * (depth + gap) + rx * spin.x * R * 0.5, ty = cue.y - uy * (depth + gap) + ry * spin.x * R * 0.5;
    const tipH = R + spin.y * R * 0.5;
    if (Math.abs(this.cue.position.x - tx) + Math.abs(this.cue.position.z + ty) + Math.abs(this.cue.position.y - tipH) > 1e-6) this.shadowDirty = 2;
    this.cue.position.copy(V3(tx, tipH, ty));
    this.cue.rotation.set(0, Math.atan2(-ux, uy), 0);
    // How far back along the cue until it crosses the cushion and then the rail? Raise the butt to clear both.
    const elev = elevIn == null ? 0.07 : elevIn;
    this.cueElev = this.cueElev == null ? elev : this.cueElev + (elev - this.cueElev) * 0.35;
    this.cueInner.rotation.x = -Math.PI / 2 - this.cueElev;
  }
  setGuides(g) {
    const G = this.guide, h = 0.004;
    // keep the lines readable from a high or distant camera: widen them with distance
    const far = g && g.from ? Math.max(1, Math.min(4.5, this.camera.position.distanceTo(V3(g.from.x, 0, g.from.y)) / 0.75)) : 1;
    const line = (o, a, b) => {
      o.visible = !!(a && b); if (!o.visible) return;
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); if (l < 1e-4) { o.visible = false; return; }
      o.position.copy(V3((a.x + b.x) / 2, h, (a.y + b.y) / 2));
      o.rotation.set(-Math.PI / 2, 0, Math.atan2(dy, dx));
      o.scale.set(l, o.userData.w * far, 1);
    };
    line(G.aim, g && g.from, g && g.to);
    line(G.obj, g && g.objFrom, g && g.objTo);
    line(G.cue, g && g.cueFrom, g && g.cueTo);
    const path = g && g.cuePath, np = path ? Math.min(this.guidePath.length, path.length - 1) : 0;
    this.guidePath.forEach((m, i) => { if (i < np) { line(m, path[i], path[i + 1]); m.material.opacity = 0.75 * (1 - i / np * 0.75); } else m.visible = false; });
    G.ghost.visible = !!(g && g.ghost);
    if (G.ghost.visible) G.ghost.position.copy(V3(g.ghost.x, h, g.ghost.y));
    G.glow.visible = !!(g && g.from);
    if (G.glow.visible) { // a soft white beam from the cue ball along the aim, like TV snooker games
      const dx = g.to.x - g.from.x, dy = g.to.y - g.from.y, len = Math.max(0.01, Math.hypot(dx, dy) - this.table.R);
      const ux = dx / (len + this.table.R), uy = dy / (len + this.table.R), sx = g.from.x + ux * (this.table.R + len / 2), sy = g.from.y + uy * (this.table.R + len / 2);
      G.glow.position.copy(V3(sx, h + 0.001, sy));
      G.glow.rotation.set(-Math.PI / 2, 0, Math.atan2(uy, ux) - Math.PI / 2);
      G.glow.scale.set(this.table.R * 1.8, len, 1);
      G.aim.material.opacity = 0.5;
    }
  }
  showZone(z) {
    if (this.zoneMesh) { this.group.remove(this.zoneMesh); this.zoneMesh = null; }
    if (!z) return;
    const { L, W, R } = this.table, mat = new THREE.MeshBasicMaterial({ color: C(0x7fb8e6), transparent: true, opacity: .16, depthWrite: false });
    let geo;
    if (z.type === "D") geo = new THREE.CircleGeometry(z.r, 48, Math.PI / 2, Math.PI);
    else if (z.type === "baulk") geo = new THREE.PlaneGeometry(z.x, W);
    else geo = new THREE.PlaneGeometry(L, W);
    const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2;
    if (z.type === "D") m.position.copy(V3(z.x, 0.002, z.y));
    else if (z.type === "baulk") m.position.copy(V3(z.x / 2, 0.002, W / 2));
    else m.position.copy(V3(L / 2, 0.002, W / 2));
    this.zoneMesh = m; this.group.add(m);
  }

  // -------------------------------------------------------------- camera
  camTo(pos, look, up, rate, dt, snap) {
    const c = this.cam;
    if (!c.pos || snap) { c.pos = pos.clone(); c.look.copy(look); c.up.copy(up); }
    else { const k = 1 - Math.exp(-dt * rate); c.pos.lerp(pos, k); c.look.lerp(look, k); c.up.lerp(up, k).normalize(); }
    this.camera.position.copy(c.pos); this.camera.up.copy(c.up); this.camera.lookAt(c.look);
  }
  // mode: aim (behind the cue ball, pitch 0 low .. 1 high), top, follow
  updateCamera(v, dt) {
    const { L, W, R } = this.table, w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const snap = v.snap; v.snap = false;
    if (this.debugCam) { const d = this.debugCam; this.camera.fov = d.fov || 40; this.camera.clearViewOffset(); this.camera.position.set(d.pos[0], d.pos[1], -d.pos[2]); this.camera.up.set(0, 1, 0); this.camera.lookAt(d.look[0], d.look[1], -d.look[2]); this.camera.updateProjectionMatrix(); this.canopy.forEach(m => m.visible = !!d.lamp); return; }
    this.canopy.forEach(m => m.visible = v.mode !== "top" && v.mode !== "tv" && v.mode !== "follow" && (v.pitch || 0) < 0.35);
    if (v.mode === "tv") { // high broadcast view from behind the baulk end
      const portrait = w < h; this.camera.fov = portrait ? 50 : 44; this.camera.clearViewOffset();
      const z = v.zoom || 1, back = (portrait ? 0.9 + L * 0.42 : 0.8 + L * 0.36) * z, hgt = (portrait ? 1.2 + L * 0.42 : 1.25 + L * 0.42) * z;
      const far = v.tvEnd === 1, lx = portrait ? 0.58 : 0.5; // from behind either end, whichever is nearer the shot
      this.camTo(V3(far ? L + back : -back, hgt, W / 2), V3(L * (far ? 1 - lx : lx), 0, W / 2), new THREE.Vector3(0, 1, 0), 2.6, dt, snap);
    } else if (v.mode === "top") {
      this.camera.fov = 40; this.camera.clearViewOffset();
      const aspect = w / h, vert = aspect < 1, tv = Math.tan(20 * Math.PI / 180);
      const l = L + 0.45, wd = W + 0.45, longS = vert ? l : wd, shortS = vert ? wd : l;
      const z = Math.min(1, v.zoom || 1), H = Math.max(longS / 2 / tv, shortS / 2 / (tv * aspect)) * z;
      // zoomed in, drift towards the cue ball so it stays in view
      const fx = L / 2 + (v.cue.x - L / 2) * (1 - z) * 1.6, fy = W / 2 + (v.cue.y - W / 2) * (1 - z) * 1.6;
      const cx = Math.max(L * z / 2, Math.min(L - L * z / 2, fx)), cy = Math.max(W * z / 2 - 0.1, Math.min(W - W * z / 2 + 0.1, fy));
      this.camTo(V3(cx, H, cy), V3(cx, 0, cy), vert ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1), 6, dt, snap);
    } else {
      this.camera.fov = w < h ? 46 : 40;
      const p = v.pitch, ux = Math.cos(v.angle), uy = Math.sin(v.angle);
      const z = v.zoom || 1, back = (0.34 + p * 1.1) * z + (v.mode === "follow" ? 0 : v.draw || 0), ahead = 1.05 - p * 0.55;
      let high = (0.12 + p * 1.15) * z;
      if (v.mode !== "follow" && this.cue.visible && this.cueElev > 0.09) high = Math.max(high, R + (back + 0.05) * Math.tan(this.cueElev) + 0.07);
      if (v.mode !== "follow") { // standing behind a ball near the rail: lift the eye until the ball shows over the cushion
        const bx = -ux, by = -uy, dx = bx > 0 ? (L - v.cue.x) / bx : bx < 0 ? -v.cue.x / bx : Infinity, dy = by > 0 ? (W - v.cue.y) / by : by < 0 ? -v.cue.y / by : Infinity;
        const dn = Math.max(0.03, Math.min(dx, dy));
        if (back > dn) high = Math.max(high, Math.min(0.85 * Math.max(1, z), R * 0.4 + (this.rh + 0.012 - R * 0.4) * back / dn));
      }
      let eye = { x: v.cue.x - ux * back, y: v.cue.y - uy * back }, look = { x: v.cue.x + ux * ahead, y: v.cue.y + uy * ahead };
      if (v.mode === "follow" && v.track) { look = { x: v.track.x, y: v.track.y }; eye = v.eye || eye; }
      this.camTo(V3(eye.x, high, eye.y), V3(look.x, 0, look.y), new THREE.Vector3(0, 1, 0), v.mode === "follow" ? 4 : 18, dt, snap);
      this.camera.setViewOffset(w, h, 0, Math.round(h * (0.2 - p * 0.15)), w, h);
    }
    this.camera.updateProjectionMatrix();
  }
  pick(clientX, clientY, height) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera({ x: (clientX - r.left) / r.width * 2 - 1, y: -(clientY - r.top) / r.height * 2 + 1 }, this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(height ?? this.table.R)), p)) return null;
    return { x: p.x, y: -p.z };
  }
  render() {
    if (this.shadowDirty > 0) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty--; }
    if (this.composer) { this.out.uniforms.exposure.value = this.exposure; this.composer.render(); }
    else this.renderer.render(this.scene, this.camera);
  }
}

