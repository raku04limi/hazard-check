// 国土交通省「重ねるハザードマップ」・国土地理院のオープンデータを使った判定
import { lonLatToPixel, distance, metersPerPixel } from './geo.js';

const DP = 'https://disaportaldata.gsi.go.jp/raster/';
const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';

export const CATEGORIES = [
  { key: 'flood', name: '洪水', icon: '🌊' },
  { key: 'naisui', name: '内水', icon: '🌧️' },
  { key: 'dosha', name: '土砂災害', icon: '⛰️' },
  { key: 'takashio', name: '高潮', icon: '🌀' },
  { key: 'tsunami', name: '津波', icon: '🌊' },
  { key: 'tameike', name: 'ため池', icon: '💧', pdfOnly: true },
  { key: 'jishin', name: '地震（震度・液状化）', icon: '🫨', pdfOnly: true },
  { key: 'chikei', name: '地形・標高', icon: '🗺️' },
  { key: 'hinan', name: '避難場所', icon: '🏫' },
];

export const LEVELS = [
  { n: 0, label: '該当なし', short: 'なし' },
  { n: 1, label: '低', short: '低' },
  { n: 2, label: '注意', short: '注意' },
  { n: 3, label: '高', short: '高' },
  { n: 4, label: '非常に高', short: '危険' },
];

// 浸水深の凡例色（ハザードマップポータルサイトの新凡例）
const DEPTH = [
  { rgb: [255, 255, 179], label: '0.3m未満', depth: 0.3, level: 1 },
  { rgb: [247, 245, 169], label: '0.5m未満', depth: 0.5, level: 1 },
  { rgb: [248, 225, 166], label: '0.5〜1m', depth: 1, level: 2 },
  { rgb: [255, 216, 192], label: '0.5〜3m', depth: 3, level: 3 },
  { rgb: [255, 183, 183], label: '3〜5m', depth: 5, level: 4 },
  { rgb: [255, 145, 145], label: '5〜10m', depth: 10, level: 4 },
  { rgb: [242, 133, 201], label: '10〜20m', depth: 20, level: 4 },
  { rgb: [220, 122, 220], label: '20m以上', depth: 99, level: 4 },
];
const TSUNAMI_LABELS = { '247,245,169': '0.3〜0.5m', '255,216,192': '1〜3m' };

export const NATIONAL_LAYERS = [
  { key: 'flood_l2', cat: 'flood', name: '洪水 浸水深（想定最大規模）', path: '01_flood_l2_shinsuishin_data', type: 'depth' },
  { key: 'flood_l1', cat: 'flood', name: '洪水 浸水深（計画規模）', path: '01_flood_l1_shinsuishin_newlegend_data', type: 'depth' },
  { key: 'flood_keizoku', cat: 'flood', name: '浸水継続時間', path: '01_flood_l2_keizoku_data', type: 'presence', level: 2, inLabel: '浸水が長時間続く区域（時間は地図の凡例で確認）' },
  { key: 'kaoku_hanran', cat: 'flood', name: '家屋倒壊等氾濫想定区域（氾濫流）', path: '01_flood_l2_kaokutoukai_hanran_data', type: 'presence', level: 4, inLabel: '区域内（木造家屋が倒壊する恐れ）' },
  { key: 'kaoku_kagan', cat: 'flood', name: '家屋倒壊等氾濫想定区域（河岸侵食）', path: '01_flood_l2_kaokutoukai_kagan_data', type: 'presence', level: 4, inLabel: '区域内（地盤ごと流される恐れ）' },
  { key: 'naisui', cat: 'naisui', name: '内水 浸水想定', path: '02_naisui_data', type: 'depth' },
  { key: 'takashio', cat: 'takashio', name: '高潮 浸水深（想定最大規模）', path: '03_hightide_l2_shinsuishin_data', type: 'depth' },
  { key: 'tsunami', cat: 'tsunami', name: '津波 浸水深', path: '04_tsunami_newlegend_data', type: 'depth', labels: TSUNAMI_LABELS },
  { key: 'doseki', cat: 'dosha', name: '土石流 警戒区域', path: '05_dosekiryukeikaikuiki', type: 'dosha' },
  { key: 'kyukeisha', cat: 'dosha', name: '急傾斜地の崩壊 警戒区域', path: '05_kyukeishakeikaikuiki', type: 'dosha' },
  { key: 'jisuberi', cat: 'dosha', name: '地すべり 警戒区域', path: '05_jisuberikeikaikuiki', type: 'dosha' },
].map((l) => ({ ...l, url: DP + l.path + '/{z}/{x}/{y}.png' }));

const SHELTER_TYPES = [
  { id: '01', name: '洪水' },
  { id: '07', name: '内水氾濫' },
  { id: '02', name: '土砂災害' },
  { id: '03', name: '高潮' },
  { id: '05', name: '津波' },
  { id: '04', name: '地震' },
];

// ---------- タイル取得 ----------
const tileCache = new Map();

/** タイル取得: {status:'ok',bmp} | {status:'empty'} | {status:'error',message} */
export function fetchTile(url) {
  if (tileCache.has(url)) return tileCache.get(url);
  const p = (async () => {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res.status === 404 || res.status === 204) return { status: 'empty' };
      if (!res.ok) return { status: 'error', message: 'HTTP ' + res.status };
      const blob = await res.blob();
      if (!blob.size) return { status: 'empty' };
      return { status: 'ok', bmp: await createImageBitmap(blob) };
    } catch (e) {
      return { status: 'error', message: String(e && e.message || e) };
    }
  })();
  tileCache.set(url, p);
  p.then((r) => { if (r.status === 'error') tileCache.delete(url); });
  return p;
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.status === 404) return { status: 'empty' };
    if (!res.ok) return { status: 'error', message: 'HTTP ' + res.status };
    return { status: 'ok', data: await res.json() };
  } catch (e) {
    return { status: 'error', message: String(e && e.message || e) };
  }
}

const tpl = (url, z, x, y) => url.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/** 地点周辺 radius px の範囲をタイルから切り出して ImageData を返す */
export async function sampleRaster(url, lat, lon, z, radius) {
  const g = lonLatToPixel(lon, lat, z);
  const x0 = Math.floor(g.x - radius), x1 = Math.floor(g.x + radius);
  const y0 = Math.floor(g.y - radius), y1 = Math.floor(g.y + radius);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++)
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++)
      jobs.push(fetchTile(tpl(url, z, tx, ty)).then((r) => ({ r, tx, ty })));
  const results = await Promise.all(jobs);
  let error = null, any = false;
  for (const { r, tx, ty } of results) {
    if (r.status === 'ok') { ctx.drawImage(r.bmp, tx * 256 - x0, ty * 256 - y0); any = true; }
    else if (r.status === 'error') error = r.message;
  }
  if (error && !any) return { error };
  const img = ctx.getImageData(0, 0, w, h);
  return { img, cx: Math.floor(g.x) - x0, cy: Math.floor(g.y) - y0, error, partial: !!error };
}

function nearestColor(rgb, palette, tol = 28) {
  let best = null, bd = Infinity;
  for (const p of palette) {
    const d = Math.hypot(rgb[0] - p.rgb[0], rgb[1] - p.rgb[1], rgb[2] - p.rgb[2]);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= tol ? best : null;
}

const hex = (rgb) => '#' + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');

function classifyPixel(layer, rgba) {
  if (rgba[3] < 100) return null;
  const rgb = [rgba[0], rgba[1], rgba[2]];
  if (layer.type === 'depth') {
    const m = nearestColor(rgb, DEPTH);
    if (!m) return { level: 2, label: '浸水想定区域内（深さは色で確認）', color: hex(rgb), unknown: true };
    const key = m.rgb.join(',');
    const label = (layer.labels && layer.labels[key]) || m.label;
    return { level: m.level, label: '浸水深 ' + label, depth: m.depth, color: hex(m.rgb) };
  }
  if (layer.type === 'dosha') {
    const special = rgb[0] > 150 && rgb[1] < 110 && rgb[2] < 110;
    return special
      ? { level: 4, label: '土砂災害特別警戒区域（レッドゾーン）', color: hex(rgb) }
      : { level: 3, label: '土砂災害警戒区域（イエローゾーン）', color: hex(rgb) };
  }
  return { level: layer.level || 2, label: layer.inLabel || '区域内', color: hex(rgb) };
}

/** ラスタ層の判定（地点そのもの＋周辺 nearM m 以内の最大） */
export async function evalRasterLayer(layer, lat, lon, nearM = 50) {
  const z = 17;
  const mpp = metersPerPixel(lat, z);
  const R = Math.max(2, Math.round(nearM / mpp));
  const s = await sampleRaster(layer.url, lat, lon, z, R);
  if (s.error && !s.img) return { layer, error: s.error };
  const { img, cx, cy } = s;
  const at = (x, y) => {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };
  // 地点：中心 3x3 の最大レベル（境界線上の誤判定を避ける）
  let here = null;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = classifyPixel(layer, at(cx + dx, cy + dy));
      if (c && (!here || c.level > here.level)) here = c;
    }
  let near = null;
  const cache = new Map();
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      const px = at(x, y);
      if (px[3] < 100) continue;
      const k = px.join(',');
      let c = cache.get(k);
      if (c === undefined) { c = classifyPixel(layer, px); cache.set(k, c); }
      if (c && (!near || c.level > near.level)) near = c;
    }
  return { layer, here, near: near && (!here || near.level > here.level) ? near : null, nearM, partial: s.partial };
}

/** 標高（m）: 地理院 DEM タイル */
export async function getElevation(lat, lon) {
  for (const [name, z] of [['dem5a_png', 15], ['dem5b_png', 15], ['dem10b_png', 14]]) {
    const s = await sampleRaster(GSI + name + '/{z}/{x}/{y}.png', lat, lon, z, 0);
    if (!s.img) { if (s.error) continue; else continue; }
    const d = s.img.data;
    if (d[3] < 100) continue;
    const x = d[0] * 65536 + d[1] * 256 + d[2];
    if (x === 8388608) continue;
    const h = (x < 8388608 ? x : x - 16777216) * 0.01;
    return { elevation: Math.round(h * 10) / 10, source: name.startsWith('dem5') ? '5mメッシュ' : '10mメッシュ' };
  }
  return null;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInGeom(lon, lat, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((p) => pointInRing(lon, lat, p[0]) && !p.slice(1).some((h) => pointInRing(lon, lat, h)));
}

function propText(p) {
  if (!p) return '';
  for (const k of ['name', '名称', 'label', 'title', '地形分類', 'class', 'type']) if (p[k]) return String(p[k]);
  const s = Object.values(p).find((v) => typeof v === 'string' && v.length > 0 && v.length < 40);
  return s || '';
}
function propDesc(p) {
  if (!p) return '';
  const v = Object.values(p).filter((x) => typeof x === 'string' && x.length >= 40);
  return v[0] || '';
}

const BAD_LAND = [
  [/旧河道|旧水部|湿地|後背低地|後背湿地|谷底低地|埋立|干拓|盛土|落堀|凹地|浅い谷/, 3],
  [/氾濫平野|低地|自然堤防|扇状地|砂州|砂丘|天井川|河原|切土/, 2],
  [/台地|段丘|山地|丘陵|岩/, 0],
];
function landLevel(name) {
  for (const [re, lv] of BAD_LAND) if (re.test(name)) return lv;
  return 1;
}

/** 地形分類（自然地形・人工地形） */
export async function getLandform(lat, lon) {
  const z = 14;
  const g = lonLatToPixel(lon, lat, z);
  const tx = Math.floor(g.x / 256), ty = Math.floor(g.y / 256);
  const out = [];
  let error = null;
  for (const [key, label] of [['experimental_landformclassification1', '自然地形'], ['experimental_landformclassification2', '人工地形']]) {
    const r = await fetchJSON(`${GSI}${key}/${z}/${tx}/${ty}.geojson`);
    if (r.status === 'error') { error = r.message; continue; }
    if (r.status !== 'ok') continue;
    for (const f of r.data.features || []) {
      if (f.geometry && pointInGeom(lon, lat, f.geometry)) {
        const name = propText(f.properties);
        out.push({ kind: label, name, desc: propDesc(f.properties), level: landLevel(name) });
      }
    }
  }
  return { items: out, error };
}

/** 指定緊急避難場所（災害種別ごとの最寄り） */
export async function getShelters(lat, lon, rangeM = 3000) {
  const z = 10;
  const mpp = metersPerPixel(lat, z);
  const g = lonLatToPixel(lon, lat, z);
  const r = rangeM / mpp;
  const tiles = [];
  for (let ty = Math.floor((g.y - r) / 256); ty <= Math.floor((g.y + r) / 256); ty++)
    for (let tx = Math.floor((g.x - r) / 256); tx <= Math.floor((g.x + r) / 256); tx++) tiles.push([tx, ty]);
  let error = null;
  const result = await Promise.all(SHELTER_TYPES.map(async (t) => {
    const feats = [];
    for (const [tx, ty] of tiles) {
      const res = await fetchJSON(`${GSI}skhb${t.id}/${z}/${tx}/${ty}.geojson`);
      if (res.status === 'error') error = res.message;
      if (res.status === 'ok') feats.push(...(res.data.features || []));
    }
    const list = feats
      .filter((f) => f.geometry && f.geometry.type === 'Point')
      .map((f) => {
        const [flon, flat] = f.geometry.coordinates;
        return { name: propText(f.properties) || '（名称不明）', address: f.properties && (f.properties.address || f.properties['所在地'] || f.properties['住所']) || '', lat: flat, lon: flon, dist: distance(lat, lon, flat, flon) };
      })
      .sort((a, b) => a.dist - b.dist);
    // 重複除去
    const seen = new Set();
    const uniq = list.filter((s) => { const k = s.name + Math.round(s.dist); if (seen.has(k)) return false; seen.add(k); return true; });
    return { type: t, nearest: uniq.slice(0, 3) };
  }));
  return { byType: result, error };
}

/** 住所 → 緯度経度（国土地理院 住所検索） */
export async function geocode(q) {
  const r = await fetchJSON('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
  if (r.status === 'error') throw new Error('住所検索に失敗しました（' + r.message + '）');
  const list = (r.status === 'ok' && Array.isArray(r.data) ? r.data : []).map((f) => ({
    title: f.properties && f.properties.title,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
  return list;
}

/** 国のデータでの一括判定 */
export async function evaluateNational(lat, lon, onProgress) {
  const tasks = NATIONAL_LAYERS.map((l) => evalRasterLayer(l, lat, lon).catch((e) => ({ layer: l, error: String(e) })));
  const [layers, elev, land, shel] = await Promise.all([
    Promise.all(tasks.map((t) => t.then((r) => { onProgress && onProgress(); return r; }))),
    getElevation(lat, lon).catch(() => null),
    getLandform(lat, lon).catch((e) => ({ items: [], error: String(e) })),
    getShelters(lat, lon).catch((e) => ({ byType: [], error: String(e) })),
  ]);
  return { layers, elev, land, shel };
}
