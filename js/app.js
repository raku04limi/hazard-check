import { CATEGORIES, LEVELS, NATIONAL_LAYERS, evaluateNational, geocode } from './hazard.js';
import { db, uid } from './db.js';
import { MAP_CATEGORIES, isVisualOnly, loadIndex, framesAt, evalFrame, snippet, parseDepth, rgbHex } from './remotemaps.js';
const VERSION = '2.1.0';
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

  const frames = await framesAt(loc.lat, loc.lon);
  const [nat, pdfs] = await Promise.all([
    evaluateNational(loc.lat, loc.lon, () => { done++; prog(); }),
    Promise.all(frames.map(async (m) => ({ m, r: await evalFrame(m, loc.lat, loc.lon).catch((e) => ({ covered: false, error: e.message })) }))),
  ]);
  const cats = buildCategories(nat, pdfs, floor, loc);
  const overall = Math.max(...Object.values(cats).map((c) => (c.levelOverall == null ? -1 : c.levelOverall)));
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

  // 自治体のハザードマップ
  for (const { m, r } of pdfs) {
    if (!r.covered) continue;
    const target = cats[m.category] || cats.hinan;
    const nm = m.name + (m.label ? '（' + m.label + '）' : '');
    let it;
    if (isVisualOnly(m)) {
      it = { src: 'pdf', name: nm, level: null, text: '周辺の地図（目視で確認）', snip: { m, r, meters: m.category === 'hinan' ? 1500 : 600 }, visual: true };
    } else if (r.here) {
      it = { src: 'pdf', name: nm, level: r.here.level, text: r.here.label, color: rgbHex(r.here.rgb), depth: parseDepth(r.here.label), snip: { m, r, meters: 400 } };
    } else {
      it = { src: 'pdf', name: nm, level: 0, text: '色の塗られた区域の外', snip: { m, r, meters: 400 }, note: '文字や線の上で判定できなかった可能性もあるので、下の図でも確認してください' };
    }
    if (r.near) it.near = `周辺${r.nearM}m以内に「${r.near.label}」`;
    if (m.label === '震度') {
      it.regional = true;
      it.note = (it.note ? it.note + ' / ' : '') + '震度は市内の広い範囲で同程度の想定のため、総合評価には含めていません';
    }
    it = floorAdjust(it, floor);
    // 区の境目では隣の区の地図も重なるので、同じ種類の地図は危険度が最も高い1件にまとめる
    const gkey = m.category + '|' + (m.label || '');
    const prev = target.items.find((x) => x.gkey === gkey);
    if (prev) {
      prev.dup = (prev.dup || 0) + 1;
      if ((it.level ?? -1) > (prev.level ?? -1)) { Object.assign(it, { gkey, dup: prev.dup }); target.items[target.items.indexOf(prev)] = it; }
    } else { it.gkey = gkey; target.items.push(it); }
    target.city = true;
  }
  for (const c of Object.values(cats)) for (const it of c.items) if (it.dup) it.note = (it.note ? it.note + ' / ' : '') + `隣接区の地図${it.dup}枚とも照合（最も危険度の高い結果を表示）`;

  for (const c of Object.values(cats)) {
    const lv = c.items.map((i) => i.level).filter((v) => v != null);
    c.level = lv.length ? Math.max(...lv) : null;
    const lo = c.items.filter((i) => !i.regional).map((i) => i.level).filter((v) => v != null);
    c.levelOverall = lo.length ? Math.max(...lo) : null;
    if (c.pdfOnly && !c.items.length) delete cats[c.key];
  }
  return cats;
}

function worstText(c) {
  const w = c.items.filter((i) => !i.regional && i.level === c.levelOverall && i.level > 0)[0] || c.items.filter((i) => i.level === c.level && i.level > 0)[0];
  return w ? w.text : '';
}

async function renderResult(res, pdfs) {
  const { loc, floor, cats, overall, memo } = res;
  const out = $('#result');
  const list = Object.values(cats);
  const high = list.filter((c) => c.levelOverall >= 3 && c.key !== 'hinan');
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
        <div class="ihead"><span class="iname"><span class="src ${it.src}">${it.src === 'gov' ? '国' : '市'}</span>${esc(it.name)}</span>${it.visual ? '' : badge(it.level)}</div>
        <div class="itext">${it.color ? `<span class="swatch" style="background:${it.color}"></span>` : ''}${esc(it.text)}</div>
        ${it.near ? `<div class="warn">⚠ ${esc(it.near)}</div>` : ''}
        ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
        ${it.shelters && it.shelters.length > 1 ? `<div class="note">ほか：${it.shelters.slice(1).map((s) => esc(s.name) + '（' + fmtDist(s.dist) + '）').join('、')}</div>` : ''}
        ${it.shelters && it.shelters[0] ? `<div class="shelter"><a href="https://www.google.com/maps/dir/?api=1&origin=${loc.lat},${loc.lon}&destination=${it.shelters[0].lat},${it.shelters[0].lon}&travelmode=walking" target="_blank" rel="noopener">徒歩ルートを見る</a></div>` : ''}
        ${it.snip ? `<div class="snip" data-snip="${c.key}:${i}"></div>` : ''}
      </div>`;
    });
    html += '</div>';
  }
  if (!list.some((c) => c.city)) html += '<div class="card note">この地点の自治体ハザードマップはまだ収録していません（国のデータのみで判定）。「収録マップ」タブで収録済みのエリアを確認できます。</div>';
  html += '<p class="muted">判定は目安です。契約前に自治体の最新ハザードマップで必ず確認してください。</p>';
  out.innerHTML = html;
  $('#openMap').addEventListener('click', () => openMapView({ mode: 'view', loc, shelters: res.nat.shel }));
  // 切り抜き画像
  for (const c of list) c.items.forEach(async (it, i) => {
    if (!it.snip) return;
    const el = out.querySelector(`[data-snip="${c.key}:${i}"]`);
    try { el.appendChild(await snippet(it.snip.m, it.snip.r, it.snip.meters)); }
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

// ---------------- 収録マップ ----------------
const CAT_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.icon]));
async function renderMapList() {
  const idx = await loadIndex();
  const el = $('#mapList');
  const wards = Object.entries(idx.wards || {});
  if (!wards.length) { el.innerHTML = '<div class="card muted">まだ収録したマップはありません。</div>'; return; }
  el.innerHTML = wards.map(([key, w]) => {
    const fr = idx.frames.filter((f) => f.ward === key);
    const pages = [...new Set(fr.map((f) => f.page))];
    return `<div class="card">
      <h3>${esc(w.name)}</h3>
      <p class="muted">出典：<a href="${esc(w.source)}" target="_blank" rel="noopener">${esc(w.name)}のハザードマップ（自治体の公式サイト）</a></p>
      ${pages.map((pid) => {
        const pg = idx.pages[pid];
        const fs = fr.filter((f) => f.page === pid);
        return `<div class="item"><div class="itext"><a href="${esc(pg.source)}" target="_blank" rel="noopener">${esc(pg.title)}</a></div>
          <div class="note">${fs.map((f) => `${CAT_ICON[f.category] || '📄'} ${esc(f.label || catName(f.category))}${f.legend.length ? '' : '（目視用）'}`).join(' ・ ')}</div>
          <div class="note">位置のずれ：約${Math.max(...fs.map((f) => f.accuracy_m || 0)).toFixed(0)}m（地理院地図と照合）</div></div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ---------------- 起動 ----------------
$('#ver').textContent = 'バージョン ' + VERSION;
loadIndex();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// テスト・デバッグ用
window.__app = { runCheck, buildCategories, loadIndex };
