// Textures, all drawn in code (no image files).
const THREE = window.THREE;

export function canvasTex(w, h, draw, rep) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
// three.js r128 takes material colours as linear light; write them as ordinary screen colours and convert here
export const C = c => new THREE.Color(c).convertSRGBToLinear();
export const hex = c => "#" + new THREE.Color(c).getHexString();
const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); // repeatable

// Napped wool cloth: fine speckle, a faint weave, and soft blotches so a big area doesn't look flat.
export function clothTex(color, rep) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, n = (rnd() - 0.5) * 13 + ((x + y) & 1 ? 1.5 : -1.5);
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }, rep);
}
export function clothNormal(rep) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4, weave = Math.sin(x * 1.57) * 0.3 + Math.sin(y * 1.57) * 0.3;
    img.data[i] = 128 + (rnd() - 0.5) * 60 + weave * 40; img.data[i + 1] = 128 + (rnd() - 0.5) * 60 - weave * 40; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4; return t;
}

// Long straight-grained timber, grain running along the texture's width.
export function woodTex(color, o = {}) {
  const fig = o.figure == null ? 1 : o.figure;
  return canvasTex(1024, 256, (g, w, h) => {
    const base = new THREE.Color(color);
    g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
    // broad bands of lighter and darker growth
    for (let y = 0; y < h; y += 2) {
      const t = Math.sin(y * 0.11) * 0.5 + Math.sin(y * 0.037 + 2) * 0.5 + (rnd() - 0.5) * 0.5;
      g.fillStyle = t > 0 ? `rgba(255,214,160,${0.05 * t * fig})` : `rgba(0,0,0,${-0.12 * t * fig})`;
      g.fillRect(0, y, w, 2);
    }
    // the grain itself: many fine wandering lines
    for (let i = 0; i < 150; i++) {
      const y0 = rnd() * h, a = (0.05 + rnd() * 0.16) * fig, dark = rnd() < 0.72, ph = rnd() * 9, amp = 1 + rnd() * 3;
      g.strokeStyle = dark ? `rgba(20,8,2,${a})` : `rgba(255,220,170,${a * 0.45})`; g.lineWidth = 0.4 + rnd() * 1.3;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin(x * Math.PI * 2 / w * 2 + ph) * amp + Math.sin(x * Math.PI * 2 / w * 5 + ph * 2) * amp * 0.3; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    // pores
    g.fillStyle = "rgba(10,4,0,.16)";
    for (let i = 0; i < 900 * fig; i++) g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 9, 0.7);
    void base;
  }, o.rep || [1, 1]);
}

export function carpetTex(color, rep) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = hex(color); g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
  }, rep);
}
export function boardsTex(color, rep) { // floorboards, boards running along the width
  return canvasTex(1024, 512, (g, w, h) => {
    const n = 8, bh = h / n;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color(color).multiplyScalar(0.82 + rnd() * 0.36);
      g.fillStyle = hex(c.getHex()); g.fillRect(0, i * bh, w, bh);
      for (let k = 0; k < 26; k++) {
        const y = i * bh + rnd() * bh; g.strokeStyle = `rgba(0,0,0,${0.05 + rnd() * 0.1})`; g.lineWidth = 0.5 + rnd();
        g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / 90 + k) * 2); g.stroke();
      }
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, i * bh, w, 1.5);
      const jx = rnd() * w; g.fillRect(jx, i * bh, 2, bh); g.fillRect((jx + w * 0.45) % w, i * bh, 2, bh);
    }
  }, rep);
}

// One texture per distinct ball design, wrapped round the sphere (width = once round the equator).
const ballCache = new Map();
export function ballTex(d) {
  const key = `${d.kind}|${d.color}|${d.num || ""}`;
  if (ballCache.has(key)) return ballCache.get(key);
  const ivory = "#f4f0e2";
  const t = canvasTex(1024, 512, (g, w, h) => {
    const stripe = d.kind === "stripe";
    g.fillStyle = stripe || d.kind === "cue" ? ivory : d.color; g.fillRect(0, 0, w, h);
    if (stripe) { g.fillStyle = d.color; g.fillRect(0, h * 0.26, w, h * 0.48); }
    if (d.kind === "cue") { // six small red spots, like a TV match ball, so you can read the spin
      g.fillStyle = "#c2262b";
      const dot = (u, v, r) => { g.beginPath(); g.ellipse(u * w, v * h, r / Math.max(0.3, Math.sin(v * Math.PI)), r, 0, 0, 7); g.fill(); };
      [0, 0.25, 0.5, 0.75].forEach(u => dot(u + 0.125, 0.5, 11));
      g.fillRect(0, 0, w, 13); g.fillRect(0, h - 13, w, 13); // the two poles
    }
    if (d.num) {
      [0.25, 0.75].forEach(u => {
        g.fillStyle = ivory; g.beginPath(); g.ellipse(u * w, h / 2, 60, 60, 0, 0, 7); g.fill();
        g.fillStyle = "#141414"; g.font = `bold ${d.num > 9 ? 60 : 72}px Arial, Helvetica, sans-serif`;
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(d.num), u * w, h / 2 + 5);
        if (d.num === 6 || d.num === 9) g.fillRect(u * w - 17, h / 2 + 39, 34, 5);
      });
    }
  });
  ballCache.set(key, t); return t;
}

export function radialTex(stops, size = 128) {
  return canvasTex(size, size, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    stops.forEach(([p, c]) => gr.addColorStop(p, c)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
