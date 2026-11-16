// アプリ共通のアイコン（線画SVG、currentColor で着色）
const P = {
  flood: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v5"/><path d="M17.5 10v5"/><path d="M2.5 17.5c1.6 0 1.6 1.2 3.2 1.2s1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3-1.2"/><path d="M2.5 21c1.6 0 1.6 1 3.2 1s1.6-1 3.2-1 1.6 1 3.2 1 1.6-1 3.2-1 1.6 1 3.2 1 1.6-1 3-1"/>',
  naisui: '<path d="M7 14.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 6.6a3.9 3.9 0 0 1 .3 7.9z"/><path d="M8 17.5 7 20"/><path d="M12.5 17.5 11.5 20"/><path d="M17 17.5 16 20"/>',
  dosha: '<path d="M2.5 20 10 7l4.2 7"/><path d="M12.2 10.6 15 6l6.5 14z"/><path d="M2.5 20h19"/><circle cx="17.8" cy="11.3" r="1"/><circle cx="20" cy="15" r="0.8"/>',
  takashio: '<path d="M3 8h9.5a2.5 2.5 0 1 0-2.4-3.2"/><path d="M3 12h14a2.8 2.8 0 1 1-2.7 3.5"/><path d="M2.5 19c1.6 0 1.6 1.2 3.2 1.2s1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3-1.2"/>',
  tsunami: '<path d="M2.5 19.5c3 0 4-1.3 5.5-4.4C9.8 11.4 11.6 6 17 6c2.5 0 4.3 1.6 4.3 3.7 0 1.8-1.4 3-3 3-1.4 0-2.4-.9-2.4-2.1"/><path d="M2.5 22c1.6 0 1.6-1 3.2-1s1.6 1 3.2 1 1.6-1 3.2-1 1.6 1 3.2 1 1.6-1 3.2-1 1.6 1 3 1"/>',
  tameike: '<path d="M12 3.5s-5 5.6-5 9a5 5 0 0 0 10 0c0-3.4-5-9-5-9z"/><path d="M3 20.5c2.5-1.3 5.5-2 9-2s6.5.7 9 2"/>',
  jishin: '<path d="M5 11.5 12 6l7 5.5V20H5z"/><path d="m12 9.5-1.4 3.3 2.6 1.4-1.5 3.6"/><path d="M1.8 9.5v6"/><path d="M22.2 9.5v6"/>',
  chikei: '<path d="M2.5 19h19"/><path d="M2.5 19 8 9.5l3.6 5.6L14.5 11l7 8"/><path d="M6 13.5c1.3.8 2.6.8 4 0"/><circle cx="17.5" cy="5.5" r="2"/>',
  hinan: '<path d="M4 20.5V10l8-5.5 8 5.5v10.5"/><path d="M9.5 20.5v-5.5h5v5.5"/><path d="M12 4.5V2"/><path d="M12 2h4l-1 1.2 1 1.2h-4"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5v10h13v-10"/><circle cx="12" cy="14" r="2.3"/><path d="m13.7 15.7 2 2"/>',
  maps: '<path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13"/><path d="M15 6.5v13"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 3.5v4h4"/><path d="M12 7.5V12l3 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.8-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  warn: '<path d="M12 3.8 2.8 19.5h18.4z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"/>',
  map: '<path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13"/><path d="M15 6.5v13"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  redo: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20.5 3.5v4.5H16"/>',
  doc: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5"/><path d="M9 13h7"/><path d="M9 16.5h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.doc}</svg>`;
}

/** 起動画面のイラスト（街・川・雨雲） */
export const HERO = `<svg class="hero-art" viewBox="0 0 360 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="hw" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
  </defs>
  <g opacity=".95">
    <path d="M250 38a17 17 0 0 1 32-6 13 13 0 1 1 3 26h-33a10 10 0 0 1-2-20z" fill="#fff" opacity=".9"/>
    <g stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"><path d="M262 66l-3 8"/><path d="M274 66l-3 8"/><path d="M286 66l-3 8"/></g>
    <circle cx="58" cy="34" r="14" fill="#fde68a"/>
  </g>
  <path d="M0 112 52 86l38 14 46-30 54 30 44-20 64 26 62-18v82H0z" fill="#d9f99d" opacity=".55"/>
  <g>
    <rect x="96" y="78" width="40" height="38" rx="4" fill="#fff"/>
    <path d="M90 82 116 60l26 22z" fill="#fb7185"/>
    <rect x="110" y="96" width="12" height="20" rx="2" fill="#16a34a"/>
    <rect x="148" y="62" width="30" height="54" rx="4" fill="#fff"/>
    <g fill="#bbf7d0"><rect x="154" y="70" width="7" height="7" rx="1.5"/><rect x="165" y="70" width="7" height="7" rx="1.5"/><rect x="154" y="82" width="7" height="7" rx="1.5"/><rect x="165" y="82" width="7" height="7" rx="1.5"/><rect x="154" y="94" width="7" height="7" rx="1.5"/><rect x="165" y="94" width="7" height="7" rx="1.5"/></g>
    <rect x="190" y="86" width="36" height="30" rx="4" fill="#fff"/>
    <path d="M185 90l23-19 23 19z" fill="#fbbf24"/>
    <rect x="200" y="98" width="9" height="9" rx="1.5" fill="#bbf7d0"/>
  </g>
  <path d="M0 120c20 0 20 6 40 6s20-6 40-6 20 6 40 6 20-6 40-6 20 6 40 6 20-6 40-6 20 6 40 6 20-6 40-6 20 6 40 6v24H0z" fill="url(#hw)"/>
  <path d="M0 132c20 0 20 5 40 5s20-5 40-5 20 5 40 5 20-5 40-5 20 5 40 5 20-5 40-5 20 5 40 5 20-5 40-5 20 5 40 5v13H0z" fill="#0ea5e9" opacity=".6"/>
</svg>`;
