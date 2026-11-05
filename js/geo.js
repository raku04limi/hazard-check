// 座標計算まわり（Webメルカトル、アフィン変換、距離）

const TILE = 256;

/** 緯度経度 → ズーム z の世界ピクセル座標 */
export function lonLatToPixel(lon, lat, z) {
  const n = TILE * Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
}

/** 世界ピクセル座標 → 緯度経度 */
export function pixelToLonLat(x, y, z) {
  const n = TILE * Math.pow(2, z);
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/** ズーム z での 1 ピクセルあたりのメートル */
export function metersPerPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
}

/** 2点間の距離（m） */
export function distance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- PDF 画像と地図の位置合わせ（アフィン変換） ----
// 地図側は z=18 の世界ピクセル座標（ほぼ等角で平面として扱える）を使う。
const GEO_Z = 18;

function solve3(m, b) {
  // 3x3 連立方程式（クラメルの公式）
  const det = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  const out = [];
  for (let c = 0; c < 3; c++) {
    const mc = m.map((row, i) => row.map((v, j) => (j === c ? b[i] : v)));
    out.push(det(mc) / d);
  }
  return out;
}

/**
 * 対応点（{px,py,lat,lon}）が 3 点以上あれば、
 * 地図 → 画像 のアフィン変換を最小二乗で求める。
 */
export function fitAffine(points) {
  if (!points || points.length < 2) return null;
  const w = points.map((p) => lonLatToPixel(p.lon, p.lat, GEO_Z));
  const ox = w.reduce((s, p) => s + p.x, 0) / w.length;
  const oy = w.reduce((s, p) => s + p.y, 0) / w.length;
  let T;
  if (points.length === 2) {
    // 2点：相似変換（拡大縮小・回転・平行移動）
    const [p0, p1] = points;
    const X0 = w[0].x - ox, Y0 = w[0].y - oy, X1 = w[1].x - ox, Y1 = w[1].y - oy;
    const dX = X1 - X0, dY = Y1 - Y0, du = p1.px - p0.px, dv = p1.py - p0.py;
    const den = dX * dX + dY * dY;
    if (den < 1e-9) return null;
    const a = (du * dX + dv * dY) / den, b = (dv * dX - du * dY) / den; // u = a X - b Y + c, v = b X + a Y + f
    T = { a, b: -b, c: p0.px - (a * X0 - b * Y0), d: b, e: a, f: p0.py - (b * X0 + a * Y0), ox, oy };
  } else {
    const X = w.map((p) => [p.x - ox, p.y - oy, 1]);
    const ata = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
    const atu = [0, 1, 2].map((i) => X.reduce((s, r, k) => s + r[i] * points[k].px, 0));
    const atv = [0, 1, 2].map((i) => X.reduce((s, r, k) => s + r[i] * points[k].py, 0));
    const pu = solve3(ata, atu);
    const pv = solve3(ata, atv);
    if (!pu || !pv) return null;
    T = { a: pu[0], b: pu[1], c: pu[2], d: pv[0], e: pv[1], f: pv[2], ox, oy };
  }
  const det = T.a * T.e - T.b * T.d;
  if (Math.abs(det) < 1e-12) return null;
  T.det = det;
  // 誤差（m）
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const mpp = metersPerPixel(lat0, GEO_Z);
  T.imgScale = Math.sqrt(Math.abs(det)); // 画像px / 世界px
  T.metersPerImagePx = mpp / T.imgScale;
  const errs = points.map((p) => {
    const q = mapToImage(T, p.lat, p.lon);
    return Math.hypot(q.x - p.px, q.y - p.py) * T.metersPerImagePx;
  });
  T.errors = errs;
  T.rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  return T;
}

export function mapToImage(T, lat, lon) {
  const w = lonLatToPixel(lon, lat, GEO_Z);
  const X = w.x - T.ox;
  const Y = w.y - T.oy;
  return { x: T.a * X + T.b * Y + T.c, y: T.d * X + T.e * Y + T.f };
}

export function imageToMap(T, x, y) {
  const u = x - T.c;
  const v = y - T.f;
  const X = (T.e * u - T.b * v) / T.det;
  const Y = (-T.d * u + T.a * v) / T.det;
  return pixelToLonLat(X + T.ox, Y + T.oy, GEO_Z);
}
