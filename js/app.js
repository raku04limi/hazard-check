import { CATEGORIES, LEVELS, NATIONAL_LAYERS, evaluateNational, geocode } from './hazard.js';
import { db, uid, requestPersist } from './db.js';
import { ImageViewer } from './viewer.js';
import {
  MAP_CATEGORIES, templatesFor, isVisualOnly, openPdf, renderPage, renderThumb, loadImageFile,
  getBitmap, dropBitmap, pickColor, rgbHex, evalMap, snippet, transformOf, parseDepth,
  setBlobLoader, imageIdOf, catGroup,
} from './pdfmaps.js';
import { findMatches, findMatchesTiled, computeValidMask, inscribedRect } from './register.js';
import { mapToImage } from './geo.js';

const VERSION = '1.2.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lvClass = (n) => (n == null ? 'lvn' : 'lv' + n);
const lvLabel = (n) => (n == null ? '不明' : LEVELS[n].short);
const badge = (n) => `<span class="badge ${lvClass(n)}">${lvLabel(n)}</span>`;
const fmtDist = (m) => (m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km');
const catName = (k) => (MAP_CATEGORIES.find((c) => c.key === k) || {}).name || k;

const GSI_STD = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_PALE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const GSI_PHOTO = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>';
const DP_ATTR = '<a href="https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html" target="_blank">ハザードマップポータルサイト</a>';
const DEFAULT_CENTER = [35.17, 136.88]; // 名古屋周辺

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------------- タブ ----------------
function showView(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'maps') renderMapList();
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------------- 物件チェック ----------------
const floorSel = $('#floor');
floorSel.innerHTML = Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${i + 1}階</option>`).join('');
floorSel.value = localStorage.getItem('floor') || '2';

$('#checkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#addr').value.trim();
  if (!q) return;
  $('#addr').blur();
  $('#result').innerHTML = '';
  const box = $('#candidates');
  box.innerHTML = '<div class="card loading"><div class="spin"></div>住所を検索中…</div>';
  try {
    const list = await geocode(q);
    if (!list.length) {
      box.innerHTML = '<div class="card">住所が見つかりませんでした。番地を省く、表記を変える、または「地図で場所を指定」を試してください。</div>';
      return;
    }
    // 完全一致または候補 1 件ならそのまま判定
    const exact = list.find((c) => c.title === q);
    if (list.length === 1 || exact) {
      box.innerHTML = '';
      runCheck({ ...(exact || list[0]), query: q });
      return;
    }
    box.innerHTML = `<div class="card"><h3>候補を選んでください</h3>${list.slice(0, 8).map((c, i) => `<button class="cand" data-i="${i}">${esc(c.title)}</button>`).join('')}</div>`;
    $$('.cand', box).forEach((b) => b.addEventListener('click', () => {
      box.innerHTML = '';
      runCheck({ ...list[+b.dataset.i], query: q });
    }));
  } catch (err) {
    box.innerHTML = `<div class="card ng">${esc(err.message)}<br><span class="muted">通信状態を確認するか、「地図で場所を指定」を使ってください。</span></div>`;
  }
});

$('#pickOnMap').addEventListener('click', () => openMapView({ mode: 'pick' }));

let lastResult = null;

async function runCheck(loc, opts = {}) {
  const floor = opts.floor || +floorSel.value;
  const memo = opts.memo ?? $('#memo').value.trim();
  localStorage.setItem('floor', String(floor));
  const out = $('#result');
  const total = NATIONAL_LAYERS.length;
  let done = 0;
  out.innerHTML = `<div class="card loading"><div class="spin"></div><span id="prog">判定中…</span></div>`;
  const prog = () => { const p = $('#prog'); if (p) p.textContent = `判定中… 国のデータ ${done}/${total}`; };

  const maps = await db.all('maps');
  const [nat, pdfs] = await Promise.all([
    evaluateNational(loc.lat, loc.lon, () => { done++; prog(); }),
    Promise.all(maps.map(async (m) => ({ m, r: await evalMap(m, loc.lat, loc.lon).catch((e) => ({ covered: false, reason: 'エラー: ' + e.message })) }))),
  ]);
  const cats = buildCategories(nat, pdfs, floor, loc);
  const overall = Math.max(...Object.values(cats).map((c) => (c.level == null ? -1 : c.level)));
  lastResult = { loc, floor, memo, nat, cats, overall: overall < 0 ? null : overall };
  await renderResult(lastResult, pdfs);
  if (!opts.noSave) saveHistory(lastResult);
}

function floorAdjust(item, floor) {
  if (item.depth == null || floor <= 1 || item.level == null || item.level < 3) return item;
  const roomFloorH = (floor - 1) * 2.8 + 0.5; // 部屋の床の高さ（目安）
  if (item.depth <= roomFloorH) {
    return { ...item, level: 2, note: (item.note ? item.note + ' / ' : '') + `${floor}階の部屋の床（地上約${roomFloorH.toFixed(1)}m）より低い想定のため「注意」に。建物の孤立・停電・断水の恐れあり` };
  }
  return { ...item, note: (item.note ? item.note + ' / ' : '') + `${floor}階の部屋まで浸水する恐れ` };
}

function buildCategories(nat, pdfs, floor, loc) {
  const cats = {};
  for (const c of CATEGORIES) cats[c.key] = { ...c, items: [], extra: [], pdfOut: 0 };

  for (const r of nat.layers) {
    const L = r.layer;
    let it;
    if (r.error) it = { src: 'gov', name: L.name, level: null, text: '取得できませんでした', note: r.error };
    else if (r.here) it = { src: 'gov', name: L.name, level: r.here.level, text: r.here.label, color: r.here.color, depth: r.here.depth };
    else it = { src: 'gov', name: L.name, level: 0, text: '区域外' };
    if (r.near) it.near = `周辺${r.nearM}m以内に「${r.near.label}」`;
    if (r.here && r.here.unknown) it.note = '色が凡例と一致しないため深さ不明。地図で確認してください';
    cats[L.cat].items.push(floorAdjust(it, floor));
  }

  // 地形・標高
  const ch = cats.chikei;
  if (nat.elev) {
    const h = nat.elev.elevation;
    const lv = h < 0 ? 3 : h < 2 ? 2 : h < 5 ? 1 : 0;
    const t = h < 0 ? '（海抜ゼロメートル地帯）' : h < 2 ? '（低い土地）' : '';
    ch.items.push({ src: 'gov', name: '標高', level: lv, text: `${h}m${t}`, note: nat.elev.source });
  } else ch.items.push({ src: 'gov', name: '標高', level: null, text: '取得できませんでした' });
  if (nat.land.items.length) {
    for (const f of nat.land.items) ch.items.push({ src: 'gov', name: '地形分類（' + f.kind + '）', level: f.level, text: f.name || '（分類名なし）', note: f.desc });
  } else {
    ch.items.push({ src: 'gov', name: '地形分類', level: null, text: nat.land.error ? '取得できませんでした' : 'この地点のデータなし', note: nat.land.error || 'データ未整備の地域の可能性があります' });
  }

  // 避難場所
  const hn = cats.hinan;
  const anyFound = nat.shel.byType.some((t) => t.nearest.length);
  if (!anyFound && (nat.shel.error || !nat.shel.byType.length)) {
    hn.items.push({ src: 'gov', name: '指定緊急避難場所', level: null, text: '取得できませんでした', note: nat.shel.error });
  } else {
    for (const t of nat.shel.byType) {
      const s = t.nearest[0];
      let lv = null;
      if (t.type.id === '01') lv = !s ? 3 : s.dist > 2000 ? 3 : s.dist > 1000 ? 2 : s.dist > 500 ? 1 : 0;
      hn.items.push({ src: 'gov', name: `${t.type.name}のときの避難場所`, level: lv, text: s ? `${s.name}（約${fmtDist(s.dist)}）` : '3km以内に見つかりません', shelters: t.nearest });
    }
  }

  // PDF
  const other = () => (cats.other ||= { key: 'other', name: 'その他（PDF）', icon: '📄', items: [], extra: [], pdfOut: 0 });
  const unaligned = [];
  for (const { m, r } of pdfs) {
    const target = cats[m.category] || other();
    if (!r.covered) {
      if (r.reason === '範囲外') target.pdfOut++;
      else unaligned.push(m.name + (m.frameLabel ? '・' + m.frameLabel : ''));
      continue;
    }
    const nm = m.name + (m.frameLabel ? '（' + m.frameLabel + '）' : '');
    let it;
    if (isVisualOnly(m.category) || !(m.legend && m.legend.length)) {
      it = { src: 'pdf', name: nm, level: null, text: '周辺の地図（目視で確認）', snip: { m, r, meters: m.category === 'hinan' ? 1500 : 500 }, visual: true };
    } else if (r.here) {
      it = { src: 'pdf', name: nm, level: r.here.level, text: r.here.label, color: rgbHex(r.here.rgb), depth: parseDepth(r.here.label), snip: { m, r, meters: 400 } };
    } else {
      it = { src: 'pdf', name: nm, level: 0, text: '凡例の色なし（区域外の可能性）', snip: { m, r, meters: 400 }, note: '地図の文字や線の上の場合もあるので、下の図で確認してください' };
    }
    if (m.auto) it.note = (it.note ? it.note + ' / ' : '') + '自動で位置合わせした地図です';
    if (r.near) it.near = `周辺${r.nearM}m以内に「${r.near.label}」`;
    target.items.push(floorAdjust(it, floor));
  }
  cats.__unaligned = unaligned;

  const un = cats.__unaligned;
  delete cats.__unaligned;
  for (const c of Object.values(cats)) {
    const lv = c.items.map((i) => i.level).filter((v) => v != null);
    c.level = lv.length ? Math.max(...lv) : null;
    if ((c.key === 'other' || c.pdfOnly) && !c.items.length) delete cats[c.key];
  }
  Object.defineProperty(cats, 'unaligned', { value: un, enumerable: false });
  return cats;
}

function worstText(c) {
  const w = c.items.filter((i) => i.level === c.level && i.level > 0)[0];
  return w ? w.text : '';
}

async function renderResult(res, pdfs) {
  const { loc, floor, cats, overall, memo } = res;
  const out = $('#result');
  const list = Object.values(cats);
  const high = list.filter((c) => c.level >= 3 && c.key !== 'hinan');
  const gmap = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}`;
  let html = `<div class="card summary b-${lvClass(overall)}">
    <div class="big">総合 ${badge(overall)}</div>
    <div style="margin-top:6px"><b>${esc(loc.title || loc.query || '指定地点')}</b>${memo ? ' <span class="muted">' + esc(memo) + '</span>' : ''}</div>
    <div class="muted">${floor}階の部屋として判定 / ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}</div>
    ${overall == null ? '<p class="warn">データを取得できませんでした。通信状態を確認して、もう一度判定してください。</p>'
      : high.length ? `<p class="warn">要確認：${high.map((c) => esc(c.name) + '（' + esc(worstText(c)) + '）').join('、')}</p>` : '<p class="note">大きなリスクは見つかりませんでした。</p>'}
    ${overall != null && list.some((c) => c.level == null) ? '<p class="note">「不明」の項目は、データが取れなかったか未整備です。下の詳細を確認してください。</p>' : ''}
    <div class="catgrid">${list.map((c) => `<a href="#cat-${c.key}" class="catchip ${lvClass(c.level)}"><span>${c.icon} ${esc(c.name)}</span><b>${lvLabel(c.level)}</b></a>`).join('')}</div>
    <div class="btns"><button type="button" id="openMap" class="ghost sm">地図で見る</button><a class="filebtn ghost sm" style="font-size:13px;padding:6px 10px" href="${gmap}" target="_blank" rel="noopener">Googleマップ</a></div>
  </div>`;
  for (const c of list) {
    html += `<div class="card cat" id="cat-${c.key}"><h3><span>${c.icon} ${esc(c.name)}</span>${badge(c.level)}</h3>`;
    c.items.forEach((it, i) => {
      html += `<div class="item">
        <div class="ihead"><span class="iname"><span class="src ${it.src}">${it.src === 'gov' ? '国' : 'PDF'}</span>${esc(it.name)}</span>${it.visual ? '' : badge(it.level)}</div>
        <div class="itext">${it.color ? `<span class="swatch" style="background:${it.color}"></span>` : ''}${esc(it.text)}</div>
        ${it.near ? `<div class="warn">⚠ ${esc(it.near)}</div>` : ''}
        ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
        ${it.shelters && it.shelters.length > 1 ? `<div class="note">ほか：${it.shelters.slice(1).map((s) => esc(s.name) + '（' + fmtDist(s.dist) + '）').join('、')}</div>` : ''}
        ${it.shelters && it.shelters[0] ? `<div class="shelter"><a href="https://www.google.com/maps/dir/?api=1&origin=${loc.lat},${loc.lon}&destination=${it.shelters[0].lat},${it.shelters[0].lon}&travelmode=walking" target="_blank" rel="noopener">徒歩ルートを見る</a></div>` : ''}
        ${it.snip ? `<div class="snip" data-snip="${c.key}:${i}"></div>` : ''}
      </div>`;
    });
    if (c.pdfOut) html += `<div class="note">※ この地点が載っていないPDF ${c.pdfOut}件は対象外にしました</div>`;
    html += '</div>';
  }
  if (cats.unaligned && cats.unaligned.length) html += `<div class="card warn">⚠ 位置合わせが済んでいないため使えなかったPDF：${cats.unaligned.map(esc).join('、')}<br><span class="note">「PDFマップ」タブで位置合わせしてください。</span></div>`;
  html += '<p class="muted">判定は目安です。契約前に自治体の最新ハザードマップで必ず確認してください。</p>';
  out.innerHTML = html;
  $('#openMap').addEventListener('click', () => openMapView({ mode: 'view', loc, shelters: res.nat.shel }));
  // 切り抜き画像
  for (const c of list) c.items.forEach(async (it, i) => {
    if (!it.snip) return;
    const el = out.querySelector(`[data-snip="${c.key}:${i}"]`);
    try { el.appendChild(await snippet(it.snip.m, it.snip.r.x, it.snip.r.y, it.snip.r.T, it.snip.meters)); }
    catch (e) { el.textContent = '画像を表示できません'; }
  });
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveHistory(res) {
  const cats = {};
  for (const [k, c] of Object.entries(res.cats)) cats[k] = { name: c.name, level: c.level, text: worstText(c) };
  await db.put('history', {
    id: uid(), date: Date.now(), title: res.loc.title || res.loc.query || '指定地点', query: res.loc.query || '',
    lat: res.loc.lat, lon: res.loc.lon, floor: res.floor, memo: res.memo, overall: res.overall, cats,
  });
}

// ---------------- 履歴 ----------------
async function renderHistory() {
  const list = (await db.all('history')).sort((a, b) => b.date - a.date);
  const el = $('#historyList');
  if (!list.length) { el.innerHTML = '<div class="card muted">まだ判定履歴はありません。</div>'; return; }
  el.innerHTML = list.map((h) => `<div class="card">
    <div class="ihead" style="display:flex;justify-content:space-between;gap:8px"><b>${esc(h.title)}</b>${badge(h.overall)}</div>
    <div class="muted">${new Date(h.date).toLocaleString('ja-JP')} / ${h.floor}階${h.memo ? ' / ' + esc(h.memo) : ''}</div>
    <div class="catgrid">${Object.values(h.cats).map((c) => `<span class="catchip ${lvClass(c.level)}"><span>${esc(c.name)}</span><b>${lvLabel(c.level)}</b></span>`).join('')}</div>
    <div class="btns"><button class="ghost sm" data-re="${h.id}">もう一度判定</button><button class="ghost sm" data-del="${h.id}">削除</button></div>
  </div>`).join('') + '<button class="ghost sm" id="histClear">履歴をすべて削除</button>';
  $$('[data-re]', el).forEach((b) => b.addEventListener('click', () => {
    const h = list.find((x) => x.id === b.dataset.re);
    showView('check');
    $('#addr').value = h.query || h.title; $('#memo').value = h.memo || ''; floorSel.value = h.floor;
    runCheck({ lat: h.lat, lon: h.lon, title: h.title, query: h.query }, { floor: h.floor, memo: h.memo, noSave: true });
  }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => { await db.del('history', b.dataset.del); renderHistory(); }));
  $('#histClear').addEventListener('click', async () => { if (confirm('履歴をすべて削除しますか？')) { await db.clear('history'); renderHistory(); } });
}

// ---------------- 地図表示 / 地点指定 ----------------
let mv = null;
function openMapView({ mode, loc, shelters }) {
  const ov = $('#mapView');
  ov.hidden = false;
  if (!mv) {
    mv = { map: L.map('mvMap', { zoomControl: true }).setView(DEFAULT_CENTER, 12) };
    L.tileLayer(GSI_PALE, { maxZoom: 19, maxNativeZoom: 18, attribution: GSI_ATTR }).addTo(mv.map);
    mv.group = L.layerGroup().addTo(mv.map);
    const sel = $('#mvLayer');
    sel.innerHTML = '<option value="">重ねる地図：なし</option>' + NATIONAL_LAYERS.map((l) => `<option value="${l.key}">${esc(l.name)}</option>`).join('');
    sel.addEventListener('change', () => {
      if (mv.overlay) mv.map.removeLayer(mv.overlay);
      mv.overlay = null;
      const l = NATIONAL_LAYERS.find((x) => x.key === sel.value);
      if (l) mv.overlay = L.tileLayer(l.url, { maxNativeZoom: 17, maxZoom: 19, opacity: 0.65, attribution: DP_ATTR }).addTo(mv.map);
    });
    mv.map.on('click', (e) => {
      if (mv.mode !== 'pick') return;
      mv.group.clearLayers();
      mv.pick = e.latlng;
      L.marker(e.latlng).addTo(mv.group);
      $('#mvPickOk').disabled = false;
    });
    $('#mvClose').addEventListener('click', () => { $('#mapView').hidden = true; });
    $('#mvPickOk').addEventListener('click', () => {
      if (!mv.pick) return;
      $('#mapView').hidden = true;
      $('#candidates').innerHTML = '';
      runCheck({ lat: mv.pick.lat, lon: mv.pick.lng, title: `地図で指定した地点`, query: '' });
    });
  }
  mv.mode = mode;
  mv.group.clearLayers();
  mv.pick = null;
  $('#mvPickBar').hidden = mode !== 'pick';
  $('#mvHint').hidden = mode !== 'pick';
  $('#mvHint').textContent = '物件の場所をタップしてください';
  $('#mvPickOk').disabled = true;
  setTimeout(() => {
    mv.map.invalidateSize();
    if (loc) {
      mv.map.setView([loc.lat, loc.lon], 16);
      L.marker([loc.lat, loc.lon]).addTo(mv.group).bindPopup(esc(loc.title || '物件'));
      const seen = new Set();
      for (const t of (shelters && shelters.byType) || []) for (const s of t.nearest) {
        const k = s.lat + ',' + s.lon;
        if (seen.has(k)) continue; seen.add(k);
        L.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#2e7d32', fillOpacity: 1 })
          .addTo(mv.group).bindPopup(`${esc(s.name)}<br>${t.type.name}など / 約${fmtDist(s.dist)}`);
      }
      $('#mvLayer').value = 'flood_l2';
      $('#mvLayer').dispatchEvent(new Event('change'));
    }
  }, 50);
}

// ---------------- PDF マップ一覧 ----------------
function areaBox(m) {
  if (m.area && m.area.length >= 3) {
    const xs = m.area.map((p) => p[0]), ys = m.area.map((p) => p[1]);
    return [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(m.width, Math.max(...xs)), Math.min(m.height, Math.max(...ys))];
  }
  return [0, 0, m.width, m.height];
}

const templateRect = (m) => inscribedRect(m.area, m.width, m.height, m.validMask);

function mapStatus(m) {
  const T = transformOf(m);
  const parts = [];
  if (!isVisualOnly(m.category)) parts.push(m.legend?.length ? `<span class="ok">凡例 ${m.legend.length}件</span>` : '<span class="ng">凡例 未登録（目視用）</span>');
  const n = (m.points || []).length;
  if (!T) parts.push('<span class="ng">位置合わせ 未設定</span>');
  else if (m.auto) parts.push(`<span class="ok">位置合わせ 自動（一致度 ${Math.round(m.auto.score * 100)}%）</span>`);
  else parts.push(`<span class="${n < 3 || T.rms < 30 ? 'ok' : 'ng'}">位置合わせ ${n}点${n >= 3 ? `（誤差 約${Math.round(T.rms)}m）` : ''}</span>`);
  parts.push(m.area && m.area.length >= 3 ? '<span class="ok">範囲 設定済み</span>' : '<span class="ng">範囲 未設定</span>');
  return parts.join(' ・ ');
}

const thumbUrls = new Map();
async function renderMapList() {
  const all = await db.all('maps');
  const roots = all.filter((m) => !m.imageId || m.imageId === m.id).sort((a, b) => a.created - b.created);
  const el = $('#mapList');
  if (!all.length) { el.innerHTML = '<div class="card muted">まだ登録がありません。PDFが無くても国のデータだけで判定できます。</div>'; return; }
  const ordered = [];
  for (const r of roots) { ordered.push(r); ordered.push(...all.filter((m) => m.imageId === r.id && m.id !== r.id).sort((a, b) => a.created - b.created)); }
  const pending = roots.filter((m) => !transformOf(m)).length;
  const aligned = all.some((m) => transformOf(m));
  el.innerHTML = (pending && aligned ? `<div class="card"><b>位置合わせ未設定のマップが${pending}件あります</b><div class="btns" style="margin-top:6px"><button class="primary sm" id="bulkAlign">まとめて自動位置合わせ</button></div></div>` : '') +
    ordered.map((m) => {
      if (!thumbUrls.has(m.id) && m.thumb) thumbUrls.set(m.id, URL.createObjectURL(m.thumb));
      const child = m.imageId && m.imageId !== m.id;
      return `<div class="card mapitem ${child ? 'child' : ''}" data-id="${m.id}">
        <img src="${thumbUrls.get(m.id) || ''}" alt="">
        <div class="mi"><b>${child ? '└ ' + esc(m.frameLabel || '別の地図') : esc(m.name) + (m.frameLabel ? '（' + esc(m.frameLabel) + '）' : '')}</b><div class="muted">${esc(catName(m.category))}</div><div class="status">${mapStatus(m)}</div></div>
        <button class="ghost sm">編集</button></div>`;
    }).join('');
  $$('.mapitem', el).forEach((d) => d.addEventListener('click', () => openEditor(d.dataset.id)));
  const bb = $('#bulkAlign');
  if (bb) bb.addEventListener('click', async () => {
    const log = importLog();
    for (const r of roots.filter((m) => !transformOf(m))) await autoAlignRoot(r, log);
    log.done();
    renderMapList();
  });
}

async function makeThumb(blob) {
  const bmp = await createImageBitmap(blob);
  const k = 160 / Math.max(bmp.width, bmp.height);
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.8));
}

function guessCategory(name) {
  const n = (name || '').toLowerCase();
  if (/naisui/.test(n)) return 'naisui';
  if (/takashio/.test(n)) return 'takashio';
  if (/tsunami/.test(n)) return 'tsunami';
  if (/tameike/.test(n)) return 'tameike';
  if (/jishin|ekijyo|ekijo/.test(n)) return 'jishin';
  if (/hinan/.test(n)) return 'hinan';
  if (/dosha|dosya/.test(n)) return 'dosha';
  if (/kozui|kouzui/.test(n)) return 'flood';
  if (/ため池|溜池/.test(n)) return 'tameike';
  if (/地震|震度|液状化/.test(n)) return 'jishin';
  if (/内水|雨水|下水/.test(n)) return 'naisui';
  if (/土砂|がけ|崖/.test(n)) return 'dosha';
  if (/高潮/.test(n)) return 'takashio';
  if (/津波/.test(n)) return 'tsunami';
  if (/避難/.test(n)) return 'hinan';
  if (/地形|標高/.test(n)) return 'chikei';
  if (/洪水|浸水|水害|河川/.test(n)) return 'flood';
  return 'flood';
}

const CAT_JA = { flood: '洪水', naisui: '内水氾濫', takashio: '高潮', tsunami: '津波', tameike: 'ため池', jishin: '地震', hinan: '避難所', dosha: '土砂災害', chikei: '地形' };
function niceName(base, cat) {
  // 名古屋市の「a1hm-kozui14midori」のようなファイル名を読みやすくする
  const m = base.match(/^([\x00-\x7f]+)(（p\.\d+）)?$/);
  if (m && CAT_JA[cat]) return `${CAT_JA[cat]}（${m[1]}）${m[2] ? m[2].replace(/[（）]/g, ' ').trim() : ''}`;
  return base;
}

async function addMapRecord({ blob, width, height }, name) {
  const category = guessCategory(name);
  const rec = {
    id: uid(), created: Date.now(), name: niceName(name, category), category, note: '',
    blob, width, height, thumb: await makeThumb(blob), legend: [], points: [], tolerance: 40,
  };
  copyLegend(rec, await db.all('maps'));
  await db.put('maps', rec);
  requestPersist();
  return rec;
}

// ---- 取り込みログ ----
function importLog() {
  const el = $('#importLog');
  el.innerHTML = '<div class="card importlog"><b>取り込み中…</b><div class="progress"><i></i></div><div class="lines"></div></div>';
  const lines = $('.lines', el), bar = $('.progress i', el), title = $('b', el);
  return {
    line(t, cls = '') { const d = document.createElement('div'); d.className = cls; d.textContent = t; lines.appendChild(d); return d; },
    progress(f) { bar.style.width = Math.round(f * 100) + '%'; },
    done(msg = '完了しました') { title.textContent = msg; bar.style.width = '100%'; },
  };
}

function choosePage(pdf) {
  return new Promise((resolve) => {
    const grid = $('#pageGrid');
    grid.innerHTML = '';
    $('#pageDlg').hidden = false;
    for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span>p.${i}</span>`;
      b.addEventListener('click', () => { $('#pageDlg').hidden = true; resolve(i); });
      grid.appendChild(b);
      renderThumb(pdf, i, 200).then((cv) => b.prepend(cv)).catch(() => {});
    }
    const all = document.createElement('button');
    all.type = 'button'; all.className = 'primary';
    all.textContent = `全${pdf.numPages}ページを取り込む`;
    all.addEventListener('click', () => { $('#pageDlg').hidden = true; resolve('all'); });
    grid.prepend(all);
    $('[data-close]').onclick = () => { $('#pageDlg').hidden = true; resolve(null); };
  });
}

$('#addFile').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  // 種類の順（洪水→内水→…）に並べると、凡例のコピーが効きやすい
  const order = ['flood', 'naisui', 'takashio', 'tsunami', 'tameike', 'dosha', 'jishin', 'hinan', 'chikei'];
  files.sort((a, b) => order.indexOf(guessCategory(a.name)) - order.indexOf(guessCategory(b.name)));
  const log = importLog();
  let lastId = null, nAuto = 0, nNew = 0;
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const base = file.name.replace(/\.(pdf|png|jpe?g|webp|gif)$/i, '');
    const ln = log.line(`${file.name}：読み込み中…`);
    try {
      const imgs = [];
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const pdf = await openPdf(file);
        const sel = pdf.numPages === 1 ? 1 : await choosePage(pdf);
        if (!sel) { ln.textContent = `${file.name}：取り込みをやめました`; continue; }
        const pages = sel === 'all' ? Array.from({ length: Math.min(pdf.numPages, 20) }, (_, i) => i + 1) : [sel];
        for (const pg of pages) {
          ln.textContent = `${file.name}：画像化しています…${pages.length > 1 ? `（${pg}/${pages.length}ページ）` : ''}`;
          const img = await renderPage(pdf, pg);
          if (pdf.numPages > 1) img.page = pg;
          imgs.push(img);
        }
      } else imgs.push(await loadImageFile(file));
      ln.textContent = `${file.name}：取り込みました`;
      for (const img of imgs) {
        const rec = await addMapRecord(img, img.page ? `${base}（p.${img.page}）` : base);
        lastId = rec.id; nNew++;
        const n = await autoAlignRoot(rec, log, (f) => log.progress((fi + 0.3 + 0.7 * f) / files.length));
        if (n) nAuto++;
      }
    } catch (err) {
      console.error(err);
      ln.textContent = `${file.name}：失敗しました（${err.message || err}）`;
      ln.className = 'ng';
    }
    log.progress((fi + 1) / files.length);
  }
  log.done(`${nNew}件を取り込みました${nAuto ? `（うち${nAuto}件は自動で位置合わせ済み）` : ''}`);
  await renderMapList();
  if (nNew === 1 && !nAuto && lastId) openEditor(lastId, 'legend');
  else if (nNew && !nAuto) log.line('まず1件を「編集」→「位置合わせ」と「範囲」で設定し、上の「まとめて自動位置合わせ」を押してください。');
});

// ---- 自動位置合わせ ----
function normBox(m) { const b = areaBox(m); return [b[0] / m.width, b[1] / m.height, b[2] / m.width, b[3] / m.height]; }
function boxIoU(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const I = w * h, A = (a[2] - a[0]) * (a[3] - a[1]), B = (b[2] - b[0]) * (b[3] - b[1]);
  return I / (A + B - I);
}

/** 同じシリーズ・同じ位置の地図枠から凡例をコピー */
function copyLegend(frame, all) {
  if (frame.legend && frame.legend.length) return false;
  const fb = normBox(frame);
  const ar = frame.width / frame.height;
  let best = null, bs = 0;
  for (const c of all) {
    if (c.id === frame.id || !(c.legend && c.legend.length)) continue;
    if (catGroup(c.category) !== catGroup(frame.category)) continue;
    if (Math.abs(c.width / c.height - ar) > 0.02) continue;
    const s = boxIoU(fb, normBox(c));
    if (s > bs) { bs = s; best = c; }
  }
  if (!best || bs < 0.6) return false;
  frame.legend = best.legend.map((l) => ({ ...l }));
  frame.tolerance = best.tolerance || 40;
  if (!frame.frameLabel && best.frameLabel) frame.frameLabel = best.frameLabel;
  frame.legendFrom = best.name;
  return true;
}

async function makeThumbCrop(bmp, box) {
  const [x0, y0, x1, y1] = box;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const k = 160 / Math.max(w, h);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
  cv.getContext('2d').drawImage(bmp, x0, y0, w, h, 0, 0, cv.width, cv.height);
  return new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.8));
}

/** 見つかった一致を地図枠として保存（items: [{ ref, refBmp, box, m }]） */
async function applyMatches(root, items, tgtBmp, { sameImage = false } = {}) {
  const all = await db.all('maps');
  const existing = all.filter((m) => imageIdOf(m) === root.id);
  const tbox = ({ box, m }) => [m.s * box[0] + m.tx, m.s * box[1] + m.ty, m.s * box[2] + m.tx, m.s * box[3] + m.ty];
  const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  items = [...items].sort((x, y) => area(tbox(y)) - area(tbox(x)));
  const saved = [];
  for (let i = 0; i < items.length; i++) {
    const { ref, refBmp, box, m } = items[i];
    const tb = tbox(items[i]);
    const nb = [tb[0] / root.width, tb[1] / root.height, tb[2] / root.width, tb[3] / root.height];
    if (existing.some((e) => transformOf(e) && boxIoU(normBox(e), nb) > 0.4)) continue;
    let frame;
    if (!sameImage && !transformOf(root)) frame = root;
    else frame = { id: uid(), created: Date.now() + i, imageId: root.id, name: root.name, category: root.category, note: '', width: root.width, height: root.height, legend: [], tolerance: 40, frameLabel: '' };
    frame.points = ref.points.map((p) => ({ ...p, px: m.s * p.px + m.tx, py: m.s * p.py + m.ty }));
    frame.area = ref.area && ref.area.length >= 3
      ? ref.area.map(([x, y]) => [m.s * x + m.tx, m.s * y + m.ty])
      : [[tb[0], tb[1]], [tb[2], tb[1]], [tb[2], tb[3]], [tb[0], tb[3]]];
    frame.validMask = items[i].mask || computeValidMask(refBmp, box, tgtBmp, m);
    frame.auto = { score: m.score, from: ref.name + (ref.frameLabel ? '（' + ref.frameLabel + '）' : ''), date: Date.now() };
    if (frame !== root) frame.thumb = await makeThumbCrop(tgtBmp, areaBox(frame));
    copyLegend(frame, all);
    await db.put('maps', frame);
    existing.push(frame);
    saved.push(frame);
  }
  return saved;
}

const MIN_VALID_FRAC = 0.8;
/** 重なる一致は一致度の高い方だけ残す */
function dedupeItems(items) {
  const tb = ({ box, m }) => [m.s * box[0] + m.tx, m.s * box[1] + m.ty, m.s * box[2] + m.tx, m.s * box[3] + m.ty];
  const ov = (a, b) => {
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    return w <= 0 || h <= 0 ? 0 : (w * h) / Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  };
  const out = [];
  for (const it of [...items].sort((x, y) => y.m.score - x.m.score)) if (!out.some((o) => ov(tb(o), tb(it)) > 0.3)) out.push(it);
  return out;
}

/** ある参照ページの全地図枠を使って、対象ページから一致を探す */
async function searchWithFrames(frames, tgtBmp, opts = {}, onProgress) {
  const items = [];
  for (let i = 0; i < frames.length; i++) {
    const ref = frames[i];
    const refBmp = await getBitmap(ref);
    const box = templateRect(ref);
    const prog = (f) => onProgress && onProgress((i + f) / frames.length);
    let ms = await findMatches(refBmp, box, ref.area, tgtBmp, { ...opts, onProgress: prog });
    if (!ms.length && opts.tiles) {
      // 一部しか写っていないページ用（縮尺違い・複数区の合同マップなど）
      ms = await findMatchesTiled(refBmp, box, ref.area, tgtBmp, { onProgress: prog, levels: opts.tileLevels || 3 });
    }
    for (const m of ms) {
      // 背景地図がマスごとに一致するかで検証（たまたま似ていただけの一致を除く）
      const mask = computeValidMask(refBmp, box, tgtBmp, m);
      const frac = mask.bits.reduce((a, b) => a + b, 0) / mask.bits.length;
      if (window.__debugMatch) window.__debugMatch.push([ref.name, ref.frameLabel, +m.s.toFixed(3), +m.score.toFixed(3), +frac.toFixed(2)]);
      if (!m.partial && frac < MIN_VALID_FRAC) continue;
      items.push({ ref, refBmp, box, m, mask });
    }
  }
  return dedupeItems(items);
}

/** 他の位置合わせ済みマップを手がかりに、新しいページを自動で位置合わせ */
async function autoAlignRoot(root, log, onProgress) {
  const all = await db.all('maps');
  const byImg = new Map();
  for (const m of all) {
    if (imageIdOf(m) === root.id || !transformOf(m)) continue;
    const k = imageIdOf(m);
    if (!byImg.has(k)) byImg.set(k, []);
    byImg.get(k).push(m);
  }
  const ar = root.width / root.height;
  const size = (m) => { const b = areaBox(m); return (b[2] - b[0]) * (b[3] - b[1]); };
  const groups = [...byImg.values()].map((fs) => fs.sort((a, b) => size(b) - size(a)))
    .sort((a, b) => (Math.abs(a[0].width / a[0].height - ar) < 0.02 ? 0 : 1) - (Math.abs(b[0].width / b[0].height - ar) < 0.02 ? 0 : 1)
      || (a.some((m) => !m.auto) ? 0 : 1) - (b.some((m) => !m.auto) ? 0 : 1) || b[0].created - a[0].created)
    .slice(0, 5);
  if (!groups.length) { log && log.line(`${root.name}：位置合わせ済みのマップがまだ無いため、手動で設定してください`, 'note'); return 0; }
  const tgtBmp = await getBitmap(root);
  const ln = log && log.line(`${root.name}：自動で位置合わせ中…`);
  for (let i = 0; i < groups.length; i++) {
    // まず一番大きい地図枠で当たりを付け、見つかったら同じページの他の地図枠でも探す
    // 部分一致（タイル）探索は時間がかかるので、最有力の参照ページだけで行う
    const first = await searchWithFrames([groups[i][0]], tgtBmp, { tiles: i === 0 }, (f) => onProgress && onProgress((i + f * 0.5) / groups.length));
    if (!first.length) continue;
    const rest = groups[i].length > 1 ? await searchWithFrames(groups[i].slice(1), tgtBmp, { tiles: first.some((it) => it.m.partial), tileLevels: 2 }, (f) => onProgress && onProgress((i + 0.5 + f * 0.5) / groups.length)) : [];
    const items = dedupeItems([...first, ...rest]);
    const saved = await applyMatches(root, items, tgtBmp);
    if (ln) { ln.textContent = `${root.name}：自動で位置合わせしました（地図${saved.length}枚、一致度 ${Math.round(Math.max(...items.map((it) => it.m.score)) * 100)}%）`; ln.className = 'ok'; }
    return saved.length;
  }
  if (ln) { ln.textContent = `${root.name}：自動では位置合わせできませんでした。手動で設定してください`; ln.className = 'ng'; }
  return 0;
}

function fail(err) { console.error(err); toast('読み込みに失敗しました：' + (err.message || err), 6000); }

// ---------------- マップ編集 ----------------
const ed = { rec: null, bmp: null, legViewer: null, geoViewer: null, map: null, pendingPdf: null, check: false, picked: null };

$('#edCat').innerHTML = MAP_CATEGORIES.map((c) => `<option value="${c.key}">${esc(c.name)}</option>`).join('');
$('#legLevel').innerHTML = LEVELS.map((l) => `<option value="${l.n}">危険度：${l.short}</option>`).join('');

async function saveRec() {
  ed.saving = db.put('maps', ed.rec);
  await ed.saving;
  $('#edStatus').innerHTML = mapStatus(ed.rec);
}

async function openEditor(id, pane = 'basic') {
  const rec = await db.get('maps', id);
  if (!rec) return;
  ed.rec = rec;
  ed.pendingPdf = null; ed.check = false; ed.picked = null;
  $('#editor').hidden = false;
  $('#edTitle').textContent = rec.name;
  $('#edName').value = rec.name;
  $('#edFrame').value = rec.frameLabel || '';
  $('#edAutoMsg').textContent = rec.auto ? `「${rec.auto.from}」をもとに自動で位置合わせしました（一致度 ${Math.round(rec.auto.score * 100)}%）。「位置合わせ」の確認モードでずれていないか確認してください。` : '';
  $('#edCat').value = rec.category;
  $('#edNote').value = rec.note || '';
  $('#edTol').value = rec.tolerance || 40;
  $('#edTolV').textContent = rec.tolerance || 40;
  $('#edStatus').innerHTML = mapStatus(rec);
  ed.bmp = await getBitmap(rec);
  showPane(pane);
}

function showPane(p) {
  $$('#edSeg button').forEach((b) => b.classList.toggle('active', b.dataset.pane === p));
  $$('#editor .ed-pane').forEach((el) => el.classList.toggle('active', el.dataset.pane === p));
  if (p === 'legend') initLegend();
  if (p === 'geo') initGeo();
  if (p === 'area') initArea();
}

// --- 範囲 ---
function drawArea() {
  const polys = [];
  const m = ed.rec.validMask;
  if (m && $('#areaMaskReset')) {
    const rects = [];
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (!m.bits[r * m.cols + c]) rects.push([m.x0 + c * m.cell, m.y0 + r * m.cell, m.cell, m.cell]);
    polys.push({ rects, fill: 'rgba(229,57,53,.35)' });
  }
  if (ed.rec.area && ed.rec.area.length) polys.push({ pts: ed.rec.area, color: '#1f5fa8', fill: 'rgba(31,95,168,.12)', closed: ed.rec.area.length >= 3, dots: true });
  ed.areaViewer.setPolys(polys);
  const n = (ed.rec.area || []).length;
  $('#areaHint').innerHTML = (n < 3
    ? `<b>判定に使う地図の範囲</b>を、PDF上で角を順にタップして囲んでください（${n}点）。区の境界のまわりや、地図の枠の内側をおおまかに囲めばOKです。表・凡例・別の小さな地図は範囲の外にしてください。`
    : `範囲を設定しました（${n}点）。続けてタップすると角を追加できます。`) +
    (m ? '<br><span class="ng">赤いマス</span>は、自動位置合わせで「背景の地図が一致しない（表などが重なっている）」と判断して判定から外した所です。' : '');
  $('#areaMaskReset').hidden = !m;
}
function initArea() {
  if (!ed.areaViewer) {
    ed.areaViewer = new ImageViewer($('#areaViewer'), {
      onTap: (p) => { (ed.rec.area ||= []).push([p.x, p.y]); saveRec(); drawArea(); },
    });
    $('#areaUndo').addEventListener('click', () => { if (ed.rec.area) ed.rec.area.pop(); saveRec(); drawArea(); });
    $('#areaClear').addEventListener('click', () => { ed.rec.area = []; saveRec(); drawArea(); });
    $('#areaMaskReset').addEventListener('click', () => { ed.rec.validMask = null; saveRec(); drawArea(); });
  }
  if (ed.areaViewer.img !== ed.bmp) ed.areaViewer.setImage(ed.bmp);
  drawArea();
}
$$('#edSeg button').forEach((b) => b.addEventListener('click', () => showPane(b.dataset.pane)));
$('#edClose').addEventListener('click', async () => { $('#editor').hidden = true; await ed.saving; renderMapList(); });
$('#edName').addEventListener('change', (e) => { ed.rec.name = e.target.value.trim() || ed.rec.name; $('#edTitle').textContent = ed.rec.name; saveRec(); });
$('#edCat').addEventListener('change', (e) => { ed.rec.category = e.target.value; saveRec(); });
$('#edFrame').addEventListener('change', (e) => { ed.rec.frameLabel = e.target.value.trim(); saveRec(); });
async function reloadEd() { ed.rec = await db.get('maps', ed.rec.id); $('#edStatus').innerHTML = mapStatus(ed.rec); }
$('#edAutoAlign').addEventListener('click', async () => {
  const root = await db.get('maps', imageIdOf(ed.rec));
  if (transformOf(root)) { $('#edAutoMsg').textContent = 'このページはすでに位置合わせ済みです。別の地図は「このページ内の別の地図を探す」で探せます。'; return; }
  $('#edAutoMsg').textContent = '自動で位置合わせ中…（10〜30秒）';
  const msgs = [];
  const n = await autoAlignRoot(root, { line: (t) => { msgs.push(t); return {}; } });
  await reloadEd();
  $('#edAutoMsg').textContent = n ? `自動で位置合わせしました（地図${n}枚）。確認モードでずれていないか確認してください。` : '自動では位置合わせできませんでした。「位置合わせ」で2点以上を手動で設定してください。';
});
$('#edFindFrames').addEventListener('click', async () => {
  if (!transformOf(ed.rec)) { $('#edAutoMsg').textContent = '先にこの地図の位置合わせ（2点以上）をしてください。'; return; }
  $('#edAutoMsg').textContent = '同じページ内を探しています…（10〜30秒）';
  const root = await db.get('maps', imageIdOf(ed.rec));
  const bmp = await getBitmap(ed.rec);
  const items = await searchWithFrames([ed.rec], bmp, { sameImage: true });
  const saved = await applyMatches(root, items, bmp, { sameImage: true });
  $('#edAutoMsg').textContent = saved.length
    ? `別の地図を${saved.length}枚見つけて登録しました。一覧で「└」の付いた項目を開き、地図枠の名前と凡例を設定してください。`
    : '別の地図は見つかりませんでした。';
});
$('#edNote').addEventListener('change', (e) => { ed.rec.note = e.target.value; saveRec(); });
$('#edTol').addEventListener('input', (e) => { $('#edTolV').textContent = e.target.value; });
$('#edTol').addEventListener('change', (e) => { ed.rec.tolerance = +e.target.value; saveRec(); });
$('#edDelete').addEventListener('click', async () => {
  const isRoot = imageIdOf(ed.rec) === ed.rec.id;
  const kids = isRoot ? (await db.all('maps')).filter((m) => m.imageId === ed.rec.id && m.id !== ed.rec.id) : [];
  if (!confirm(`「${ed.rec.name}${ed.rec.frameLabel ? '・' + ed.rec.frameLabel : ''}」を削除しますか？${kids.length ? `\n同じページの地図${kids.length}枚も削除されます。` : ''}`)) return;
  for (const k of kids) await db.del('maps', k.id);
  await db.del('maps', ed.rec.id);
  if (isRoot) dropBitmap(ed.rec.id);
  $('#editor').hidden = true;
  renderMapList();
});

// --- 凡例 ---
function initLegend() {
  if (!ed.legViewer) {
    ed.legViewer = new ImageViewer($('#legViewer'), {
      onTap: (p) => {
        const rgb = pickColor(ed.bmp, p.x, p.y);
        ed.picked = { rgb, x: p.x, y: p.y };
        $('#legSwatch').style.background = rgbHex(rgb);
        $('#legForm').hidden = false;
        $('#legHint').hidden = true;
        $('#legLabel').value = '';
        ed.legViewer.setMarkers([{ x: p.x, y: p.y, cross: true, color: '#e00' }]);
      },
    });
  }
  if (ed.legViewer.img !== ed.bmp) ed.legViewer.setImage(ed.bmp);
  ed.legViewer.setMarkers([]);
  $('#legForm').hidden = true;
  $('#legHint').hidden = false;
  $('#legHint').textContent = isVisualOnly(ed.rec.category)
    ? 'この種類（目視用）は凡例の登録は不要です。「位置合わせ」だけ行ってください。'
    : '凡例の色見本（例：0.5〜3m の色）をタップしてください。２本指で拡大できます。';
  const tpl = templatesFor(ed.rec.category);
  $('#legTpl').innerHTML = tpl.map(([t, lv]) => `<button type="button" data-t="${esc(t)}" data-lv="${lv}">${esc(t)}</button>`).join('');
  $$('#legTpl button').forEach((b) => b.addEventListener('click', () => { $('#legLabel').value = b.dataset.t; $('#legLevel').value = b.dataset.lv; }));
  $('#legLevel').value = '3';
  renderLegendList();
}

function renderLegendList() {
  const L = ed.rec.legend || [];
  $('#legList').innerHTML = L.length
    ? '<h3 style="margin-top:8px">登録済みの凡例</h3>' + L.map((l, i) => `<div class="legitem"><span class="swatch big" style="width:26px;height:26px;background:${rgbHex(l.rgb)}"></span><span class="t">${esc(l.label)}</span>${badge(l.level)}<button class="ghost sm" data-del="${i}">削除</button></div>`).join('')
    : '';
  if (L.length) $('#legList').insertAdjacentHTML('beforeend', '<div class="btns" style="margin-top:8px"><button type="button" class="ghost sm" id="legCopy">この凡例を同じ形式の他のマップにもコピー</button></div><div class="note" id="legCopyMsg"></div>');
  $$('#legList [data-del]').forEach((b) => b.addEventListener('click', () => { ed.rec.legend.splice(+b.dataset.del, 1); saveRec(); renderLegendList(); }));
  const cb = $('#legCopy');
  if (cb) cb.addEventListener('click', async () => {
    await ed.saving;
    const all = await db.all('maps');
    const fb = normBox(ed.rec), ar = ed.rec.width / ed.rec.height;
    let n = 0;
    for (const m of all) {
      if (m.id === ed.rec.id || (m.legend && m.legend.length)) continue;
      if (catGroup(m.category) !== catGroup(ed.rec.category) || Math.abs(m.width / m.height - ar) > 0.02) continue;
      if (boxIoU(fb, normBox(m)) < 0.6) continue;
      m.legend = ed.rec.legend.map((l) => ({ ...l }));
      m.tolerance = ed.rec.tolerance || 40;
      if (!m.frameLabel && ed.rec.frameLabel) m.frameLabel = ed.rec.frameLabel;
      await db.put('maps', m);
      n++;
    }
    $('#legCopyMsg').textContent = n ? `${n}件のマップに凡例をコピーしました（同じ種類のグループで、ページ内の同じ位置にある地図）。` : 'コピー先（凡例が未登録で、同じ位置にある同じ種類の地図）が見つかりませんでした。';
  });
}
$('#legAdd').addEventListener('click', () => {
  const label = $('#legLabel').value.trim();
  if (!label) { toast('意味（例：0.5〜3m）を入力してください'); return; }
  (ed.rec.legend ||= []).push({ rgb: ed.picked.rgb, label, level: +$('#legLevel').value });
  saveRec();
  $('#legForm').hidden = true; $('#legHint').hidden = false;
  ed.legViewer.setMarkers([]);
  renderLegendList();
  toast(`「${label}」を追加しました`);
});
$('#legCancel').addEventListener('click', () => { $('#legForm').hidden = true; $('#legHint').hidden = false; ed.legViewer.setMarkers([]); });

// --- 位置合わせ ---
let baseIsPhoto = false;
function initGeo() {
  if (!ed.geoViewer) {
    ed.geoViewer = new ImageViewer($('#geoViewer'), {
      onTap: (p) => {
        if (ed.check) return;
        ed.pendingPdf = p;
        drawGeo();
        toast('次に、下の地図で同じ場所をタップ');
      },
    });
    ed.map = L.map('geoMap').setView(DEFAULT_CENTER, 12);
    ed.base = L.tileLayer(GSI_STD, { maxZoom: 19, maxNativeZoom: 18, attribution: GSI_ATTR }).addTo(ed.map);
    ed.mk = L.layerGroup().addTo(ed.map);
    ed.map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      if (ed.check) {
        const T = transformOf(ed.rec);
        if (!T) { toast('2点以上の位置合わせが必要です'); return; }
        const p = mapToImage(T, lat, lng);
        ed.checkPt = { pdf: p, lat, lon: lng };
        drawGeo();
        ed.geoViewer.centerOn(p.x, p.y, 0.5);
        return;
      }
      if (!ed.pendingPdf) { toast('先に上のPDFで目印をタップしてください'); return; }
      ed.rec.points.push({ px: ed.pendingPdf.x, py: ed.pendingPdf.y, lat, lon: lng });
      ed.rec.auto = null;
      ed.pendingPdf = null;
      saveRec();
      drawGeo();
    });
    $('#geoSearch').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = e.target.querySelector('input').value.trim();
      if (!q) return;
      try {
        const r = await geocode(q);
        if (!r.length) return toast('見つかりませんでした');
        ed.map.setView([r[0].lat, r[0].lon], 17);
      } catch (err) { toast(err.message); }
    });
    $('#geoCheck').addEventListener('click', () => {
      ed.check = !ed.check;
      ed.checkPt = null;
      ed.pendingPdf = null;
      drawGeo();
    });
    $('#geoBase').addEventListener('click', () => {
      baseIsPhoto = !baseIsPhoto;
      ed.map.removeLayer(ed.base);
      ed.base = L.tileLayer(baseIsPhoto ? GSI_PHOTO : GSI_STD, { maxZoom: 19, maxNativeZoom: 18, attribution: GSI_ATTR }).addTo(ed.map);
      $('#geoBase').textContent = baseIsPhoto ? '地図' : '写真';
    });
    $('#geoListBtn').addEventListener('click', () => { $('#geoList').hidden = !$('#geoList').hidden; });
  }
  if (ed.geoViewer.img !== ed.bmp) ed.geoViewer.setImage(ed.bmp);
  ed.check = false; ed.checkPt = null; ed.pendingPdf = null;
  setTimeout(() => {
    ed.map.invalidateSize();
    const pts = ed.rec.points;
    if (pts.length) ed.map.fitBounds(pts.map((p) => [p.lat, p.lon]), { maxZoom: 16, padding: [30, 30] });
  }, 60);
  drawGeo();
}

function numIcon(n, cls = '') {
  return L.divIcon({ className: '', html: `<div class="numicon ${cls}" style="width:24px;height:24px">${n}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
}

function drawGeo() {
  const pts = ed.rec.points;
  const T = transformOf(ed.rec);
  const markers = pts.map((p, i) => ({ x: p.px, y: p.py, label: String(i + 1), color: '#e53935' }));
  if (ed.pendingPdf) markers.push({ ...ed.pendingPdf, cross: true, color: '#ff6d00', label: String(pts.length + 1) });
  if (ed.checkPt) markers.push({ ...ed.checkPt.pdf, cross: true, color: '#2e7d32', label: '確認' });
  ed.geoViewer.setMarkers(markers);
  ed.mk.clearLayers();
  pts.forEach((p, i) => L.marker([p.lat, p.lon], { icon: numIcon(i + 1) }).addTo(ed.mk));
  if (ed.checkPt) L.marker([ed.checkPt.lat, ed.checkPt.lon], { icon: numIcon('✓', 'chk') }).addTo(ed.mk);
  $('#geoCheck').classList.toggle('on', ed.check);
  let hint;
  if (ed.check) hint = '確認モード：地図をタップすると、PDF上の対応する位置に緑の十字が出ます。ずれていれば点を追加・削除してください。';
  else if (ed.pendingPdf) hint = `<b>② 下の地図で同じ場所をタップ</b>（点${pts.length + 1}）`;
  else hint = `<b>① PDF上で目印（交差点・駅・橋など）をタップ</b> → ② 地図で同じ場所をタップ。現在 ${pts.length}点${pts.length < 2 ? '（あと' + (2 - pts.length) + '点。3点以上だとより正確）' : ''}`;
  if (ed.rec.auto && !ed.check) hint += ' / <span class="ok">自動で位置合わせ済み</span>（確認モードで確認できます）';
  else if (T && !ed.check && pts.length >= 3) hint += ` / 誤差 約${Math.round(T.rms)}m${T.rms > 30 ? ' <span class="ng">（大きめ：ずれている点を削除）</span>' : ' <span class="ok">良好</span>'}`;
  $('#geoHint').innerHTML = hint;
  $('#geoList').innerHTML = pts.length
    ? pts.map((p, i) => `<div class="gp"><span class="n">${i + 1}</span><span class="t">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${T ? ' / ずれ ' + Math.round(T.errors[i]) + 'm' : ''}</span><button class="ghost sm" data-del="${i}">削除</button></div>`).join('')
    : '<div class="muted">まだありません</div>';
  $$('#geoList [data-del]').forEach((b) => b.addEventListener('click', () => { ed.rec.points.splice(+b.dataset.del, 1); ed.rec.auto = null; saveRec(); drawGeo(); }));
}

// ---------------- バックアップ ----------------
const blobToDataURL = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
const dataURLToBlob = async (u) => (await fetch(u)).blob();

$('#exportBtn').addEventListener('click', async () => {
  toast('書き出し中…');
  const maps = await db.all('maps');
  const out = { app: 'hazard-check', version: 1, exported: new Date().toISOString(), maps: [], history: await db.all('history') };
  for (const m of maps) out.maps.push({ ...m, blob: m.blob ? await blobToDataURL(m.blob) : null, thumb: m.thumb ? await blobToDataURL(m.thumb) : null });
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hazard-check-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
});
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'hazard-check') throw new Error('このアプリのバックアップではありません');
    for (const m of data.maps || []) await db.put('maps', { ...m, blob: m.blob ? await dataURLToBlob(m.blob) : undefined, thumb: m.thumb ? await dataURLToBlob(m.thumb) : null });
    for (const h of data.history || []) await db.put('history', h);
    toast(`読み込みました（マップ ${(data.maps || []).length}件）`);
    renderMapList();
  } catch (err) { toast('読み込めませんでした：' + err.message, 5000); }
});

// ---------------- 起動 ----------------
$('#ver').textContent = 'バージョン ' + VERSION;
setBlobLoader(async (id) => { const r = await db.get('maps', id); if (!r || !r.blob) throw new Error('画像が見つかりません'); return r.blob; });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// テスト・デバッグ用
window.__app = { runCheck, openEditor, db, buildCategories, autoAlignRoot, renderMapList };
