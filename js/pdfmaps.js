// 自治体ハザードマップ（PDF・画像）の取り込みと判定
import { fitAffine, mapToImage } from './geo.js';

export const MAP_CATEGORIES = [
  { key: 'flood', name: '洪水' },
  { key: 'naisui', name: '内水' },
  { key: 'dosha', name: '土砂災害' },
  { key: 'takashio', name: '高潮' },
  { key: 'tsunami', name: '津波' },
  { key: 'chikei', name: '地形・標高' },
  { key: 'hinan', name: '避難場所（目視用）' },
  { key: 'other', name: 'その他（目視用）' },
];

export const LEGEND_TEMPLATES = {
  depth: [
    ['0.5m未満', 1], ['0.5〜1m', 2], ['0.5〜3m', 3], ['1〜2m', 3], ['2〜5m', 4], ['3〜5m', 4], ['5m以上', 4], ['10m以上', 4],
    ['0.1〜0.2m', 1], ['0.2〜0.5m', 1], ['0.3m未満', 1],
  ],
  dosha: [['土砂災害警戒区域', 3], ['土砂災害特別警戒区域', 4], ['土石流危険渓流', 3], ['急傾斜地崩壊危険箇所', 3]],
  chikei: [['旧河道', 3], ['後背低地', 3], ['盛土地・埋立地', 3], ['自然堤防', 2], ['台地・段丘', 0], ['海抜0m以下', 3]],
};
export function templatesFor(cat) {
  if (['flood', 'naisui', 'takashio', 'tsunami'].includes(cat)) return LEGEND_TEMPLATES.depth;
  return LEGEND_TEMPLATES[cat] || [];
}
export const isVisualOnly = (cat) => cat === 'hinan' || cat === 'other';

let pdfjsReady = false;
function pdfjs() {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('PDF読み込み機能の準備ができていません');
  if (!pdfjsReady) {
    lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    pdfjsReady = true;
  }
  return lib;
}

export async function openPdf(file) {
  const lib = pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  return lib.getDocument({
    data,
    cMapUrl: 'vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'vendor/pdfjs/standard_fonts/',
  }).promise;
}

/** ページを画像化（スマホのメモリ上限を考慮して最大 約1600万画素） */
export async function renderPage(pdf, pageNo, maxSide = 5000, maxPixels = 16e6) {
  const page = await pdf.getPage(pageNo);
  const v1 = page.getViewport({ scale: 1 });
  let scale = Math.min(maxSide / Math.max(v1.width, v1.height), Math.sqrt(maxPixels / (v1.width * v1.height)));
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const out = { blob, width: cv.width, height: cv.height };
  cv.width = cv.height = 0;
  return out;
}

export async function renderThumb(pdf, pageNo, side = 240) {
  const page = await pdf.getPage(pageNo);
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: side / Math.max(v1.width, v1.height) });
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return cv;
}

/** 画像ファイル（PNG/JPEG）をそのまま取り込む */
export async function loadImageFile(file) {
  const bmp = await createImageBitmap(file);
  let { width, height } = bmp;
  const k = Math.min(1, Math.sqrt(16e6 / (width * height)));
  if (k >= 1 && file.type === 'image/png') return { blob: file, width, height };
  const cv = document.createElement('canvas');
  cv.width = Math.floor(width * k); cv.height = Math.floor(height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const out = { blob, width: cv.width, height: cv.height };
  cv.width = cv.height = 0;
  return out;
}

// 画像ビットマップのキャッシュ
const bmpCache = new Map();
export async function getBitmap(rec) {
  const key = rec.id + ':' + (rec.updatedImage || 0);
  if (!bmpCache.has(key)) bmpCache.set(key, createImageBitmap(rec.blob));
  return bmpCache.get(key);
}
export function dropBitmap(id) {
  for (const k of [...bmpCache.keys()]) if (k.startsWith(id + ':')) bmpCache.delete(k);
}

/** 画像の一部分の画素を取得 */
export function readRegion(bmp, x, y, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** タップ位置の色（周囲 5x5 の中央値） */
export function pickColor(bmp, x, y) {
  const r = 2;
  const img = readRegion(bmp, Math.round(x) - r, Math.round(y) - r, r * 2 + 1, r * 2 + 1);
  const ch = [[], [], []];
  for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) ch[c].push(img.data[i + c]);
  return ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
}

export const rgbHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

function matchLegend(rgb, legend, tol) {
  let best = null, bd = Infinity;
  for (const L of legend) {
    const d = Math.hypot(rgb[0] - L.rgb[0], rgb[1] - L.rgb[1], rgb[2] - L.rgb[2]);
    if (d < bd) { bd = d; best = L; }
  }
  return bd <= tol ? best : null;
}

export function parseDepth(label) {
  const nums = (label || '').match(/\d+(\.\d+)?/g);
  if (!nums || !/m|ｍ|メートル|cm/.test(label)) return null;
  let v = parseFloat(nums[nums.length - 1]);
  if (/cm/.test(label)) v /= 100;
  if (/以上|超/.test(label)) return 99;
  return v;
}

export function transformOf(rec) {
  return fitAffine(rec.points || []);
}

/**
 * PDF マップで地点を判定
 * 返り値: {covered:false} | {covered:true, here, near, x, y, T}
 */
export async function evalMap(rec, lat, lon, nearM = 50) {
  const T = transformOf(rec);
  if (!T) return { covered: false, reason: '位置合わせ未完了' };
  const p = mapToImage(T, lat, lon);
  if (p.x < 0 || p.y < 0 || p.x >= rec.width || p.y >= rec.height) return { covered: false, reason: '範囲外', T };
  const res = { covered: true, x: p.x, y: p.y, T };
  if (isVisualOnly(rec.category) || !(rec.legend && rec.legend.length)) return res;
  const bmp = await getBitmap(rec);
  const tol = rec.tolerance || 40;
  // 地点：半径 4px のうち、凡例に一致した色の多数決（文字や線を避ける）
  const R0 = 4;
  const x0 = Math.max(0, Math.round(p.x) - R0), y0 = Math.max(0, Math.round(p.y) - R0);
  const a = readRegion(bmp, x0, y0, R0 * 2 + 1, R0 * 2 + 1);
  const votes = new Map();
  for (let i = 0; i < a.data.length; i += 4) {
    const m = matchLegend([a.data[i], a.data[i + 1], a.data[i + 2]], rec.legend, tol);
    if (m) votes.set(m, (votes.get(m) || 0) + 1);
  }
  let here = null, hv = 0;
  for (const [m, v] of votes) if (v > hv || (v === hv && m.level > here.level)) { here = m; hv = v; }
  if (here && hv < 6) here = null; // 81 画素中 6 未満はノイズ扱い
  // 周辺
  const R = Math.max(R0 + 1, Math.min(300, Math.round(nearM / T.metersPerImagePx)));
  const bx = Math.max(0, Math.round(p.x) - R), by = Math.max(0, Math.round(p.y) - R);
  const bw = Math.min(rec.width - bx, R * 2 + 1), bh = Math.min(rec.height - by, R * 2 + 1);
  const b = readRegion(bmp, bx, by, bw, bh);
  const cnt = new Map();
  const cache = new Map();
  const cx = Math.round(p.x) - bx, cy = Math.round(p.y) - by;
  for (let y = 0; y < bh; y += 2)
    for (let x = 0; x < bw; x += 2) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      const i = (y * bw + x) * 4;
      const k = (b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2];
      let m = cache.get(k);
      if (m === undefined) { m = matchLegend([b.data[i], b.data[i + 1], b.data[i + 2]], rec.legend, tol); cache.set(k, m); }
      if (m) cnt.set(m, (cnt.get(m) || 0) + 1);
    }
  let near = null;
  for (const [m, v] of cnt) if (v >= 8 && (!near || m.level > near.level)) near = m;
  res.here = here;
  res.near = near && (!here || near.level > here.level) ? near : null;
  res.nearM = nearM;
  return res;
}

/** 地点周辺の切り抜き画像（十字付き） */
export async function snippet(rec, x, y, T, meters = 400, size = 300) {
  const bmp = await getBitmap(rec);
  let S = Math.round(meters / T.metersPerImagePx);
  S = Math.max(120, Math.min(S, 1600));
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = size * dpr; cv.height = size * dpr;
  cv.style.width = '100%';
  cv.style.maxWidth = size + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ccc'; ctx.fillRect(0, 0, cv.width, cv.height);
  const k = cv.width / S;
  ctx.drawImage(bmp, x - S / 2, y - S / 2, S, S, 0, 0, cv.width, cv.height);
  const c = cv.width / 2;
  const L = 18 * dpr;
  for (const [w, col] of [[5 * dpr, '#fff'], [2 * dpr, '#e00']]) {
    ctx.lineWidth = w; ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(c - L, c); ctx.lineTo(c - 5 * dpr, c); ctx.moveTo(c + 5 * dpr, c); ctx.lineTo(c + L, c);
    ctx.moveTo(c, c - L); ctx.lineTo(c, c - 5 * dpr); ctx.moveTo(c, c + 5 * dpr); ctx.lineTo(c, c + L);
    ctx.stroke();
  }
  // 縮尺バー
  const barM = meters >= 800 ? 200 : 100;
  const barPx = (barM / T.metersPerImagePx) * k;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(6 * dpr, cv.height - 22 * dpr, barPx + 50 * dpr, 16 * dpr);
  ctx.fillStyle = '#000';
  ctx.fillRect(10 * dpr, cv.height - 12 * dpr, barPx, 3 * dpr);
  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  ctx.fillText(barM + 'm', 14 * dpr + barPx, cv.height - 9 * dpr);
  return cv;
}
