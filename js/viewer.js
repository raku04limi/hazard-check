// スマホ向け 画像ビューア（ドラッグで移動、ピンチで拡大、タップで座標取得）
export class ImageViewer {
  constructor(container, { onTap } = {}) {
    this.el = container;
    this.onTap = onTap;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'iv-canvas';
    this.el.appendChild(this.canvas);
    const ctrl = document.createElement('div');
    ctrl.className = 'iv-ctrl';
    ctrl.innerHTML = '<button type="button" data-z="1.6" aria-label="拡大">＋</button><button type="button" data-z="0.625" aria-label="縮小">－</button><button type="button" data-fit aria-label="全体表示">⤢</button>';
    ctrl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.fit !== undefined) this.fit();
      else this.zoomAt(parseFloat(b.dataset.z), this.w / 2, this.h / 2);
    });
    this.el.appendChild(ctrl);
    this.img = null;
    this.markers = [];
    this.s = 1; this.ox = 0; this.oy = 0;
    this.ptrs = new Map();
    this._bind();
    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(this.el);
  }

  setImage(img) {
    this.img = img;
    this._resize();
    this.fit();
  }

  setMarkers(m) { this.markers = m || []; this.draw(); }

  fit() {
    if (!this.img || !this.w) return;
    this.s = Math.min(this.w / this.img.width, this.h / this.img.height);
    this.ox = (this.w - this.img.width * this.s) / 2;
    this.oy = (this.h - this.img.height * this.s) / 2;
    this.draw();
  }

  centerOn(x, y, minScale) {
    if (minScale && this.s < minScale) this.s = minScale;
    this.ox = this.w / 2 - x * this.s;
    this.oy = this.h / 2 - y * this.s;
    this.draw();
  }

  zoomAt(f, sx, sy) {
    const ns = Math.max(0.02, Math.min(this.s * f, 8));
    const k = ns / this.s;
    this.ox = sx - (sx - this.ox) * k;
    this.oy = sy - (sy - this.oy) * k;
    this.s = ns;
    this.draw();
  }

  toImage(sx, sy) { return { x: (sx - this.ox) / this.s, y: (sy - this.oy) / this.s }; }

  _resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const first = !this.w;
    this.w = r.width; this.h = r.height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (first && this.img) this.fit(); else this.draw();
  }

  draw() {
    const c = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#888';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.img) return;
    c.setTransform(dpr * this.s, 0, 0, dpr * this.s, dpr * this.ox, dpr * this.oy);
    c.imageSmoothingEnabled = this.s < 2;
    c.drawImage(this.img, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const m of this.markers) {
      const x = m.x * this.s + this.ox, y = m.y * this.s + this.oy;
      c.lineWidth = 3;
      c.strokeStyle = '#fff';
      if (m.cross) {
        c.beginPath(); c.moveTo(x - 16, y); c.lineTo(x + 16, y); c.moveTo(x, y - 16); c.lineTo(x, y + 16); c.stroke();
        c.lineWidth = 1.5; c.strokeStyle = m.color || '#e00';
        c.beginPath(); c.moveTo(x - 16, y); c.lineTo(x + 16, y); c.moveTo(x, y - 16); c.lineTo(x, y + 16); c.stroke();
      } else {
        c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2);
        c.fillStyle = m.color || '#e00'; c.fill(); c.stroke();
      }
      if (m.label) {
        c.font = 'bold 12px system-ui, sans-serif';
        c.fillStyle = m.cross ? (m.color || '#e00') : '#fff';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        if (m.cross) { c.lineWidth = 3; c.strokeStyle = '#fff'; c.strokeText(m.label, x + 24, y - 14); c.fillText(m.label, x + 24, y - 14); }
        else c.fillText(m.label, x, y + 0.5);
      }
    }
  }

  _bind() {
    const cv = this.canvas;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let start = null, moved = false, last = null, lastPinch = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, pos(e));
      if (this.ptrs.size === 1) { start = { ...pos(e), t: Date.now() }; moved = false; last = pos(e); }
      else { moved = true; lastPinch = null; }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.set(e.pointerId, pos(e));
      if (this.ptrs.size === 1) {
        const p = pos(e);
        if (start && Math.hypot(p.x - start.x, p.y - start.y) > 8) moved = true;
        if (moved && last) { this.ox += p.x - last.x; this.oy += p.y - last.y; this.draw(); }
        last = p;
      } else if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (lastPinch) {
          this.ox += mid.x - lastPinch.mid.x; this.oy += mid.y - lastPinch.mid.y;
          this.zoomAt(d / lastPinch.d, mid.x, mid.y);
        }
        lastPinch = { d, mid };
      }
    });
    const up = (e) => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size === 0) {
        if (!moved && start && Date.now() - start.t < 600 && this.onTap && this.img) {
          const p = this.toImage(start.x, start.y);
          if (p.x >= 0 && p.y >= 0 && p.x < this.img.width && p.y < this.img.height) this.onTap(p);
        }
        start = null; lastPinch = null;
      } else if (this.ptrs.size === 1) {
        last = [...this.ptrs.values()][0]; lastPinch = null;
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });
  }
}
