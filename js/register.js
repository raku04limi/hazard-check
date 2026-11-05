// 地図画像どうしの自動位置合わせ
// 位置合わせ済みの地図（参照）の一部をテンプレートにし、新しい画像の中から
// 同じ背景地図を「拡大率＋平行移動」で探す（正規化相互相関を FFT で計算）。

// ---------- 特徴量（輝度の勾配） ----------
const featCache = new WeakMap();

export function featureMap(bmp, W) {
  let byW = featCache.get(bmp);
  if (!byW) { byW = new Map(); featCache.set(bmp, byW); }
  if (byW.has(W)) return byW.get(W);
  const H = Math.max(8, Math.round((bmp.height * W) / bmp.width));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  cv.width = cv.height = 0;
  const L = new Float32Array(W * H);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
  const g = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = L[i + 1] - L[i - 1], gy = L[i + W] - L[i - W];
      g[i] = Math.min(Math.sqrt(gx * gx + gy * gy), 60) / 60;
    }
  const f = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      f[i] = (g[i - W - 1] + g[i - W] + g[i - W + 1] + g[i - 1] + g[i] + g[i + 1] + g[i + W - 1] + g[i + W] + g[i + W + 1]) / 9;
    }
  const out = { w: W, h: H, data: f, k: W / bmp.width };
  byW.set(W, out);
  return out;
}

// ---------- FFT ----------
const nextPow2 = (n) => 1 << Math.ceil(Math.log2(n));

function fft1d(re, im, off, stride, n, inv) {
  // ビット反転
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = off + (i + k) * stride, b = off + (i + k + half) * stride;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function fft2d(re, im, P, Q, inv) {
  for (let y = 0; y < Q; y++) fft1d(re, im, y * P, 1, P, inv);
  for (let x = 0; x < P; x++) fft1d(re, im, x, P, Q, inv);
  if (inv) { const s = 1 / (P * Q); for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; } }
}

// ---------- 正規化相互相関 ----------
function prepTarget(F) {
  const P = nextPow2(F.w), Q = nextPow2(F.h);
  const re = new Float64Array(P * Q), im = new Float64Array(P * Q);
  for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) re[y * P + x] = F.data[y * F.w + x];
  fft2d(re, im, P, Q, false);
  const W1 = F.w + 1;
  const s1 = new Float64Array(W1 * (F.h + 1)), s2 = new Float64Array(W1 * (F.h + 1));
  for (let y = 0; y < F.h; y++) {
    let r1 = 0, r2 = 0;
    for (let x = 0; x < F.w; x++) {
      const v = F.data[y * F.w + x];
      r1 += v; r2 += v * v;
      s1[(y + 1) * W1 + x + 1] = s1[y * W1 + x + 1] + r1;
      s2[(y + 1) * W1 + x + 1] = s2[y * W1 + x + 1] + r2;
    }
  }
  return { F, P, Q, re, im, s1, s2, W1 };
}

function ncc(T, tw, th, tg, maxPeaks = 0) {
  const { F, P, Q, W1, s1, s2 } = tg;
  if (tw > F.w || th > F.h) return null;
  const n = tw * th;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += T[i];
  mean /= n;
  let tn = 0;
  const re = new Float64Array(P * Q), im = new Float64Array(P * Q);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const v = T[y * tw + x] - mean; re[y * P + x] = v; tn += v * v; }
  tn = Math.sqrt(tn);
  if (tn < 1e-6) return null;
  fft2d(re, im, P, Q, false);
  // I_hat * conj(T_hat)
  for (let i = 0; i < re.length; i++) {
    const ar = tg.re[i], ai = tg.im[i], br = re[i], bi = -im[i];
    re[i] = ar * br - ai * bi; im[i] = ar * bi + ai * br;
  }
  fft2d(re, im, P, Q, true);
  const RW = F.w - tw + 1, RH = F.h - th + 1;
  const R = new Float32Array(RW * RH);
  for (let y = 0; y < RH; y++)
    for (let x = 0; x < RW; x++) {
      const a = y * W1 + x, b = (y + th) * W1 + x;
      const S1 = s1[b + tw] - s1[a + tw] - s1[b] + s1[a];
      const S2 = s2[b + tw] - s2[a + tw] - s2[b] + s2[a];
      const v = S2 - (S1 * S1) / n;
      R[y * RW + x] = v < n * 0.002 ? 0 : re[y * P + x] / (tn * Math.sqrt(v));
    }
  const peaks = [];
  const rad = Math.max(4, Math.round(Math.min(tw, th) / 2));
  for (let k = 0; k < (maxPeaks || 1); k++) {
    let best = -1, bx = 0, by = 0;
    for (let i = 0; i < R.length; i++) if (R[i] > best) { best = R[i]; bx = i % RW; by = (i / RW) | 0; }
    if (best <= 0) break;
    const at = (x, y) => (x < 0 || y < 0 || x >= RW || y >= RH ? best : R[y * RW + x]);
    const sub = (m, c, p) => { const d = m - 2 * c + p; return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d)); };
    peaks.push({ score: best, x: bx + sub(at(bx - 1, by), best, at(bx + 1, by)), y: by + sub(at(bx, by - 1), best, at(bx, by + 1)) });
    for (let y = Math.max(0, by - rad); y < Math.min(RH, by + rad); y++) R.fill(-1, y * RW + Math.max(0, bx - rad), y * RW + Math.min(RW, bx + rad));
  }
  return maxPeaks ? peaks : peaks[0] || null;
}

function cropResize(F, x0, y0, w, h, s, mask) {
  // F の (x0,y0,w,h) を s 倍に縮小・拡大
  const tw = Math.max(8, Math.round(w * s)), th = Math.max(8, Math.round(h * s));
  const out = new Float32Array(tw * th);
  const sx = w / tw, sy = h / th;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const fx = x0 + (x + 0.5) * sx - 0.5, fy = y0 + (y + 0.5) * sy - 0.5;
      const ix = Math.max(0, Math.min(F.w - 2, Math.floor(fx))), iy = Math.max(0, Math.min(F.h - 2, Math.floor(fy)));
      const dx = Math.min(1, Math.max(0, fx - ix)), dy = Math.min(1, Math.max(0, fy - iy));
      const i = iy * F.w + ix;
      let v = F.data[i] * (1 - dx) * (1 - dy) + F.data[i + 1] * dx * (1 - dy) + F.data[i + F.w] * (1 - dx) * dy + F.data[i + F.w + 1] * dx * dy;
      if (mask && !mask(fx / F.k, fy / F.k)) v = 0;
      out[y * tw + x] = v;
    }
  return { T: out, tw, th, sx: tw / w, sy: th / h };
}

function zeroRect(F, x0, y0, x1, y1) {
  const a = Math.max(0, Math.floor(x0)), b = Math.min(F.w, Math.ceil(x1));
  const c = Math.max(0, Math.floor(y0)), d = Math.min(F.h, Math.ceil(y1));
  for (let y = c; y < d; y++) F.data.fill(0, y * F.w + a, y * F.w + b);
}
const cloneF = (F) => ({ ...F, data: new Float32Array(F.data) });
const tick = () => new Promise((r) => setTimeout(r, 0));

function pip(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 参照画像の box（画像px）を新しい画像の中から探す。
 * 返り値: [{ s, tx, ty, score }]  新画像px = s * 参照画像px + (tx, ty)
 */
export async function findMatches(refBmp, box, poly, tgtBmp, opts = {}) {
  const {
    sameImage = false, smin = 0.4, smax = 2.5, steps = 34, maxMatches = 4,
    coarseW = 512, fineW = 1024, threshold = 0.24, minFrac = 0.25, onProgress,
  } = opts;
  const mask = poly && poly.length >= 3 ? (x, y) => pip(x, y, poly) : null;
  const tmask = null; // テンプレートは範囲内の長方形（box）をそのまま使う
  const rc = featureMap(refBmp, coarseW), rf = featureMap(refBmp, fineW);
  const tc = cloneF(featureMap(tgtBmp, coarseW)), tf = cloneF(featureMap(tgtBmp, fineW));
  const [bx0, by0, bx1, by1] = box;
  if (sameImage) {
    // 参照の地図そのもの（範囲内）を消してから探す
    for (const F of [tc, tf]) {
      if (mask) {
        for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) if (mask(x / F.k, y / F.k)) F.data[y * F.w + x] = 0;
      } else zeroRect(F, bx0 * F.k, by0 * F.k, bx1 * F.k, by1 * F.k);
    }
  }
  // 1) 粗い解像度で、拡大率ごとに候補を集める
  const tgC = prepTarget(tc);
  const cands = [];
  for (let i = 0; i < steps; i++) {
    const s = Math.exp(Math.log(smin) + ((Math.log(smax) - Math.log(smin)) * i) / (steps - 1));
    if (sameImage && Math.abs(s - 1) < 0.08) continue;
    // 見つける地図がページの1/4未満の大きさになる拡大率は使わない（小さすぎると偶然の一致が増える）
    if (s * (bx1 - bx0) < minFrac * tgtBmp.width && s * (by1 - by0) < minFrac * tgtBmp.height) continue;
    const t = cropResize(rc, bx0 * rc.k, by0 * rc.k, (bx1 - bx0) * rc.k, (by1 - by0) * rc.k, (s * tc.k) / rc.k, tmask);
    if (t.tw < 40 || t.th < 40) continue;
    const ps = ncc(t.T, t.tw, t.th, tgC, 4) || [];
    for (const p of ps) if (p.score >= threshold * 0.8) cands.push({ ...p, s, w: t.tw, h: t.th });
    if (onProgress) onProgress((0.6 * (i + 1)) / steps);
    if (i % 3 === 2) await tick();
  }
  cands.sort((a, b) => b.score - a.score);
  const iou = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    const I = w * h;
    return I / Math.min(a.w * a.h, b.w * b.h);
  };
  const picked = [];
  for (const c of cands) {
    if (picked.length >= maxMatches) break;
    if (picked.some((p) => iou(p, c) > 0.3)) continue;
    picked.push(c);
  }
  // 2) 細かい解像度で、候補の周辺だけを詰める
  const results = [];
  for (let n = 0; n < picked.length; n++) {
    const c = picked[n];
    const m = 24;
    const wx0 = Math.max(0, Math.floor((c.x / tc.k) * tf.k) - m), wy0 = Math.max(0, Math.floor((c.y / tc.k) * tf.k) - m);
    const wx1 = Math.min(tf.w, Math.ceil(((c.x + c.w) / tc.k) * tf.k) + m * 2), wy1 = Math.min(tf.h, Math.ceil(((c.y + c.h) / tc.k) * tf.k) + m * 2);
    const win = { w: wx1 - wx0, h: wy1 - wy0, k: tf.k, data: new Float32Array((wx1 - wx0) * (wy1 - wy0)) };
    for (let y = wy0; y < wy1; y++) win.data.set(tf.data.subarray(y * tf.w + wx0, y * tf.w + wx1), (y - wy0) * win.w);
    const tg = prepTarget(win);
    let fine = null;
    const tryScale = async (s) => {
      const t = cropResize(rf, bx0 * rf.k, by0 * rf.k, (bx1 - bx0) * rf.k, (by1 - by0) * rf.k, (s * tf.k) / rf.k, tmask);
      const r = ncc(t.T, t.tw, t.th, tg);
      if (r && (!fine || r.score > fine.score)) fine = { ...r, s, t };
      await tick();
    };
    for (let i = -3; i <= 3; i++) await tryScale(c.s * Math.pow(1.014, i));
    const s1 = fine ? fine.s : c.s;
    for (const i of [-3, -2, -1, 1, 2, 3]) await tryScale(s1 * Math.pow(1.004, i));
    if (onProgress) onProgress(0.6 + (0.4 * (n + 1)) / picked.length);
    if (!fine || fine.score < threshold) continue;
    const sx = fine.t.sx, sy = fine.t.sy;
    const S = (((sx + sy) / 2) * rf.k) / tf.k;
    const tx = (fine.x + wx0 - sx * bx0 * rf.k) / tf.k;
    const ty = (fine.y + wy0 - sy * by0 * rf.k) / tf.k;
    results.push({ s: S, tx, ty, score: fine.score });
  }
  return results;
}

/**
 * 自動位置合わせ後、参照と背景地図が一致しないマス（表・凡例・別の図が重なっている所）を除外する。
 * 返り値: { x0, y0, cell, cols, rows, bits }（新画像px）
 */
export function computeValidMask(refBmp, refBox, tgtBmp, m, W = 1024) {
  const rf = featureMap(refBmp, W), tf = featureMap(tgtBmp, W);
  const [bx0, by0, bx1, by1] = refBox;
  const X0 = Math.max(0, m.s * bx0 + m.tx), Y0 = Math.max(0, m.s * by0 + m.ty);
  const X1 = Math.min(tgtBmp.width, m.s * bx1 + m.tx), Y1 = Math.min(tgtBmp.height, m.s * by1 + m.ty);
  const cell = Math.max(24, Math.round(Math.max(tgtBmp.width, tgtBmp.height) / 60));
  const cols = Math.max(1, Math.ceil((X1 - X0) / cell)), rows = Math.max(1, Math.ceil((Y1 - Y0) / cell));
  const bits = new Uint8Array(cols * rows);
  const N = 10; // マス内のサンプル数（N×N）
  const a = new Float32Array(N * N), b = new Float32Array(N * N);
  const samp = (F, x, y) => {
    const fx = Math.round(x * F.k), fy = Math.round(y * F.k);
    return fx < 0 || fy < 0 || fx >= F.w || fy >= F.h ? 0 : F.data[fy * F.w + fx];
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let ma = 0, mb = 0;
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const x = X0 + (c + (i + 0.5) / N) * cell, y = Y0 + (r + (j + 0.5) / N) * cell;
          const k = j * N + i;
          b[k] = samp(tf, x, y);
          a[k] = samp(rf, (x - m.tx) / m.s, (y - m.ty) / m.s);
          ma += a[k]; mb += b[k];
        }
      ma /= N * N; mb /= N * N;
      let sab = 0, saa = 0, sbb = 0;
      for (let k = 0; k < N * N; k++) { const da = a[k] - ma, db = b[k] - mb; sab += da * db; saa += da * da; sbb += db * db; }
      const sa = Math.sqrt(saa / (N * N)), sb = Math.sqrt(sbb / (N * N));
      const corr = sab / (Math.sqrt(saa * sbb) + 1e-9);
      let ok;
      if (sa < 0.03 && sb < 0.03) ok = true; // どちらも白地
      else if (sa < 0.03 || sb < 0.03) ok = sb < 0.06 && sa < 0.06; // 片方だけ模様がある＝別物が重なっている
      else ok = corr > 0.08;
      bits[r * cols + c] = ok ? 1 : 0;
    }
  // ノイズ除去：周囲8マスの多数決
  const out = new Uint8Array(bits);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let n = 0, t = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        n++; t += bits[rr * cols + cc];
      }
      out[r * cols + c] = t * 2 >= n ? 1 : 0;
    }
  return { x0: X0, y0: Y0, cell, cols, rows, bits: Array.from(out) };
}

/** 範囲ポリゴンの内側に収まる、できるだけ大きな長方形（画像px） */
export function inscribedRect(poly, W, H, validMask) {
  if (!poly || poly.length < 3) return [0, 0, W, H];
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(W, Math.max(...xs)), y1 = Math.min(H, Math.max(...ys));
  const N = 48, cw = (x1 - x0) / N, ch = (y1 - y0) / N;
  const ok = new Uint8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const cx = x0 + (i + 0.5) * cw, cy = y0 + (j + 0.5) * ch;
      let v = pip(cx, cy, poly);
      if (v && validMask) {
        const c = Math.floor((cx - validMask.x0) / validMask.cell), r = Math.floor((cy - validMask.y0) / validMask.cell);
        if (c >= 0 && r >= 0 && c < validMask.cols && r < validMask.rows && !validMask.bits[r * validMask.cols + c]) v = false;
      }
      ok[j * N + i] = v ? 1 : 0;
    }
  // ヒストグラム法で最大長方形
  const h = new Int32Array(N);
  let best = { a: 0, i0: 0, i1: N, j0: 0, j1: N };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) h[i] = ok[j * N + i] ? h[i] + 1 : 0;
    const st = [];
    for (let i = 0; i <= N; i++) {
      const cur = i < N ? h[i] : 0;
      let start = i;
      while (st.length && st[st.length - 1][1] >= cur) {
        const [si, sh] = st.pop();
        const a = sh * (i - si);
        if (a > best.a) best = { a, i0: si, i1: i, j0: j - sh + 1, j1: j + 1 };
        start = si;
      }
      st.push([start, cur]);
    }
  }
  if (!best.a) return [x0, y0, x1, y1];
  return [x0 + best.i0 * cw, y0 + best.j0 * ch, x0 + best.i1 * cw, y0 + best.j1 * ch];
}
