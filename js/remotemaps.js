// 収録済みの自治体ハザードマップ（data/ に置いた解析済みデータ）を使った判定
import { fitAffine, mapToImage } from './geo.js';

export const MAP_CATEGORIES = [
  { key: 'flood', name: '洪水' },
  { key: 'naisui', name: '内水' },
  { key: 'dosha', name: '土砂災害' },
  { key: 'takashio', name: '高潮' },
  { key: 'tsunami', name: '津波' },
  { key: 'tameike', name: 'ため池' },
  { key: 'jishin', name: '地震（震度・液状化）' },
  { key: 'jisseki', name: '過去の浸水実績' },
  { key: 'chikei', name: '地形・標高' },
  { key: 'hinan', name: '避難場所' },
];
const VISUAL = ['hinan', 'chikei'];
export const isVisualOnly = (f) => VISUAL.includes(f.category) || !(f.legend && f.legend.length);

let indexP = null;
export function loadIndex() {
  if (!indexP) {
    indexP = fetch('data/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { pages: {}, frames: [], wards: {} }))
      .catch(() => ({ pages: {}, frames: [], wards: {} }));
    indexP.then((idx) => { for (const f of idx.frames) f.T = fitAffine(f.points); });
  }
  return indexP;
}

/** その地点を含む可能性のある地図枠 */
export async function framesAt(lat, lon) {
  const idx = await loadIndex();
  const m = 0.002;
  return idx.frames.filter((f) => lon >= f.bbox[0] - m && lon <= f.bbox[2] + m && lat >= f.bbox[1] - m && lat <= f.bbox[3] + m);
}

// ---------- タイル画像 ----------
const tileCache = new Map();
function getTile(pageId, tx, ty) {
  const key = `${pageId}/${tx}_${ty}`;
  if (!tileCache.has(key)) {
    const p = fetch(`data/tiles/${key}.jpg`).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null)).catch(() => null);
    tileCache.set(key, p);
    if (tileCache.size > 120) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(key);
}

/** ページ画像の一部（x,y,w,h：ページpx）を canvas に描いて返す */
async function region(idx, pageId, x, y, w, h, outW = w, outH = h) {
  const pg = idx.pages[pageId];
  const T = pg.tile;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(outW)); cv.height = Math.max(1, Math.round(outH));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  const kx = cv.width / w, ky = cv.height / h;
  const jobs = [];
  for (let ty = Math.max(0, Math.floor(y / T)); ty <= Math.min(Math.ceil(pg.height / T) - 1, Math.floor((y + h) / T)); ty++)
    for (let tx = Math.max(0, Math.floor(x / T)); tx <= Math.min(Math.ceil(pg.width / T) - 1, Math.floor((x + w) / T)); tx++)
      jobs.push(getTile(pageId, tx, ty).then((bmp) => ({ bmp, tx, ty })));
  for (const { bmp, tx, ty } of await Promise.all(jobs)) {
    if (!bmp) continue;
    ctx.drawImage(bmp, (tx * T - x) * kx, (ty * T - y) * ky, bmp.width * kx, bmp.height * ky);
  }
  return cv;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// chroma：建物の線などで暗くなった塗り色にも対応するため、明るさを除いた色味で比べる
const chroma = (c) => { const t = c[0] + c[1] + c[2] || 1; return [c[0] / t, c[1] / t, c[2] / t]; };
function matchLegend(rgb, legend, tol, mode) {
  let best = null, bd = Infinity;
  if (mode === 'chroma') {
    const sum = rgb[0] + rgb[1] + rgb[2];
    if (sum < 240) return null;
    // 色味のほとんどない画素（地図の灰色の陰影や白地）は判定しない
    if (Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) < 20) return null;
    const c = chroma(rgb);
    for (const L of legend) {
      const k = L._c || (L._c = chroma(L.rgb));
      const d = Math.hypot(c[0] - k[0], c[1] - k[1], c[2] - k[2]);
      if (d < bd) { bd = d; best = L; }
    }
    return bd <= tol ? best : null;
  }
  for (const L of legend) {
    const d = Math.hypot(rgb[0] - L.rgb[0], rgb[1] - L.rgb[1], rgb[2] - L.rgb[2]);
    if (d < bd) { bd = d; best = L; }
  }
  return bd <= tol ? best : null;
}

/**
 * 地図枠で地点を判定
 * 返り値: { covered:false } | { covered:true, x, y, here, near, nearM }
 */
export async function evalFrame(f, lat, lon, nearM = 50) {
  const idx = await loadIndex();
  const pg = idx.pages[f.page];
  if (!f.T) return { covered: false };
  const p = mapToImage(f.T, lat, lon);
  if (p.x < 0 || p.y < 0 || p.x >= pg.width || p.y >= pg.height || !pointInPoly(p.x, p.y, f.area)) return { covered: false };
  const res = { covered: true, x: p.x, y: p.y };
  if (isVisualOnly(f)) return res;
  const tol = f.tolerance || 24;
  const R = Math.max(6, Math.min(200, Math.round(nearM / f.T.metersPerImagePx)));
  const x0 = Math.round(p.x) - R, y0 = Math.round(p.y) - R, S = R * 2 + 1;
  const cv = await region(idx, f.page, x0, y0, S, S);
  const data = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, S, S).data;
  const cache = new Map();
  const at = (x, y) => {
    const i = (y * S + x) * 4;
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let m = cache.get(k);
    if (m === undefined) { m = matchLegend([data[i], data[i + 1], data[i + 2]], f.legend, tol, f.match); cache.set(k, m); }
    return m;
  };
  // 地点：半径4px の多数決（文字や線を避ける）
  const votes = new Map();
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const m = at(R + dx, R + dy);
    if (m) votes.set(m, (votes.get(m) || 0) + 1);
  }
  let here = null, hv = 0;
  for (const [m, v] of votes) if (v > hv || (v === hv && m.level > here.level)) { here = m; hv = v; }
  if (here && hv < 6) here = null;
  // 地点が記号や文字の上で読めないときは、すぐ周り（半径20px）で最も多い色を使う
  let aroundMark = false;
  if (!here) {
    const v2 = new Map(); let tot = 0;
    for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) {
      if (dx * dx + dy * dy > 400 || R + dx < 0 || R + dy < 0 || R + dx >= S || R + dy >= S) continue;
      tot++;
      const m = at(R + dx, R + dy);
      if (m) v2.set(m, (v2.get(m) || 0) + 1);
    }
    let bm = null, bv = 0;
    for (const [m, v] of v2) if (v > bv) { bm = m; bv = v; }
    if (bm && bv >= tot * 0.15) { here = bm; aroundMark = true; }
  }
  // 周辺（範囲内の画素だけ）
  const cnt = new Map();
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
    if ((x - R) ** 2 + (y - R) ** 2 > R * R) continue;
    if (!pointInPoly(x0 + x, y0 + y, f.area)) continue;
    const m = at(x, y);
    if (m) cnt.set(m, (cnt.get(m) || 0) + 1);
  }
  let near = null;
  for (const [m, v] of cnt) if (v >= 8 && (!near || m.level > near.level)) near = m;
  res.here = here;
  res.aroundMark = aroundMark;
  res.near = near && (!here || near.level > here.level) ? near : null;
  res.nearM = nearM;
  return res;
}

/** 地点周辺の切り抜き（十字・縮尺付き） */
export async function snippet(f, r, meters = 400, size = 300) {
  const idx = await loadIndex();
  const mpp = f.T.metersPerImagePx;
  const S = Math.max(100, Math.min(Math.round(meters / mpp), 1600));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = await region(idx, f.page, r.x - S / 2, r.y - S / 2, S, S, size * dpr, size * dpr);
  cv.style.width = '100%';
  cv.style.maxWidth = size + 'px';
  const ctx = cv.getContext('2d');
  // 範囲外（表や凡例など）を薄く
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cv.width, cv.height);
  const k = cv.width / S;
  f.area.forEach(([x, y], i) => { const X = (x - (r.x - S / 2)) * k, Y = (y - (r.y - S / 2)) * k; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fill('evenodd');
  ctx.restore();
  const c = cv.width / 2, L = 18 * dpr;
  for (const [w, col] of [[5 * dpr, '#fff'], [2 * dpr, '#e00']]) {
    ctx.lineWidth = w; ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(c - L, c); ctx.lineTo(c - 5 * dpr, c); ctx.moveTo(c + 5 * dpr, c); ctx.lineTo(c + L, c);
    ctx.moveTo(c, c - L); ctx.lineTo(c, c - 5 * dpr); ctx.moveTo(c, c + 5 * dpr); ctx.lineTo(c, c + L);
    ctx.stroke();
  }
  const barM = meters >= 800 ? 200 : 100;
  const barPx = (barM / mpp) * k;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(6 * dpr, cv.height - 22 * dpr, barPx + 50 * dpr, 16 * dpr);
  ctx.fillStyle = '#000';
  ctx.fillRect(10 * dpr, cv.height - 12 * dpr, barPx, 3 * dpr);
  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  ctx.fillText(barM + 'm', 14 * dpr + barPx, cv.height - 9 * dpr);
  return cv;
}

export function parseDepth(label) {
  const s = label || '';
  if (!/\d/.test(s) || !/m/.test(s) || /分|時間|日|週/.test(s)) return null;
  const nums = s.match(/\d+(\.\d+)?/g);
  if (/以上/.test(s)) return 99;
  return parseFloat(nums[nums.length - 1]);
}
export const rgbHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
