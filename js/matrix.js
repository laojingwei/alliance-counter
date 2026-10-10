window.AC = window.AC || {};

/* ============================================================
   克制矩阵（热力图）
   行 = 列 = 同一批阵容，格子颜色 = 行对列的胜率，格内数字 = 对局数
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;

  function Matrix(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks || {};
    this.keys = [];
    this.labels = [];
    this.map = new Map();
    this.cell = 34;
    this.autoCell = true;
    this.labelW = 0;
    this.labelH = 0;
    this.w = 800; this.h = 600;
    this.off = { x: 0, y: 0 };
    this.hover = null;
    this.selection = null;
    this.animStart = 0;
    this._raf = null;
    this._bind();
  }

  Matrix.prototype.setData = function (result, display) {
    const topN = (display && display.topN) || 30;
    const list = result.nodeList.slice(0, topN);
    this.keys = list.map(function (n) { return n.key; });
    this.labels = list.map(function (n) {
      return n.display.length > 22 ? n.display.slice(0, 21) + '…' : n.display;
    });
    this.fullLabels = list.map(function (n) { return n.display; });
    // 兵种串：画在标签右侧，和网络图保持一致
    this.troopSigs = list.map(function (n) { return n.troopSig || ''; });
    this.counts = list.map(function (n) { return n.n; });
    this.map = new Map();
    const self = this;
    this.keys.forEach(function (k1, i) {
      self.keys.forEach(function (k2, j) {
        if (i === j) return;
        const p = AC.analyzer.getPair(result, k1, k2);
        if (!p) return;
        const rate = p.lo === k1 ? p.rateLo : 1 - p.rateLo;
        self.map.set(i + ':' + j, { pair: p, rate: rate, n: p.n, i: i, j: j, k1: k1, k2: k2 });
      });
    });
    this.labelW = 0;
    this.autoCell = true;
    this.animStart = performance.now();
    this.off = { x: 0, y: 0 };
    this._loop();
  };

  Matrix.prototype.setSelection = function (sel) {
    if (sel && sel.type === 'pair') {
      const i = this.keys.indexOf(sel.k1), j = this.keys.indexOf(sel.k2);
      this.selection = (i >= 0 && j >= 0) ? { i: i, j: j } : null;
      this.highlightKey = null;
    } else if (sel && sel.type === 'node') {
      this.selection = null;
      this.highlightKey = sel.id;
      this._loop();
      return;
    } else {
      // 取消选择时必须一并清掉高亮键，否则矩阵会一直停在压暗状态
      this.selection = null;
      this.highlightKey = null;
    }
    this._loop();
  };

  Matrix.prototype._bind = function () {
    const self = this, cv = this.canvas;

    cv.addEventListener('mousemove', function (ev) {
      const rect = cv.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      const hit = self.hit(sx, sy);
      const changed = (hit && hit.i) !== (self.hover && self.hover.i) || (hit && hit.j) !== (self.hover && self.hover.j);
      self.hover = hit;
      cv.style.cursor = hit ? 'pointer' : 'default';
      if (changed) {
        if (self.cb.onHover) {
          if (hit) {
            self.cb.onHover({
              type: 'pair', key: hit.i + ':' + hit.j,
              html: '<b>' + esc(self.fullLabels[hit.i]) + '</b>' + U.troopHtml(self.troopSigs[hit.i] || '') +
        '<br>对 <b>' + esc(self.fullLabels[hit.j]) + '</b>' + U.troopHtml(self.troopSigs[hit.j] || '') + '<br>' +
                '胜率 ' + U.fmtPct(hit.rate) + ' · 对局 ' + hit.n + ' 场',
              screen: { x: sx, y: sy }
            });
          } else self.cb.onHover(null);
        }
        self._loop();
      }
    });

    cv.addEventListener('mouseleave', function () {
      self.hover = null;
      if (self.cb.onHover) self.cb.onHover(null);
      self._loop();
    });

    cv.addEventListener('click', function (ev) {
      const rect = cv.getBoundingClientRect();
      const hit = self.hit(ev.clientX - rect.left, ev.clientY - rect.top);
      if (hit && self.cb.onSelect) {
        self.cb.onSelect({ type: 'pair', id: hit.k1 + '||' + hit.k2, k1: hit.k1, k2: hit.k2, pair: hit.pair });
      }
    });

    cv.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      const before = self.cell;
      self.autoCell = false;
      self.cell = U.clamp(self.cell * (ev.deltaY < 0 ? 1.1 : 0.91), 12, 70);
      if (before !== self.cell) self._loop();
    }, { passive: false });
  };

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

  /** rateColor 的亮度分量，用于决定格内数字用深色还是浅色 */
  function rateLum(rate) {
    const r = U.clamp(rate, 0, 1);
    return r < 0.5
      ? U.lerp(56, 42, r / 0.5)
      : U.lerp(42, 56, (r - 0.5) / 0.5);
  }

  Matrix.prototype._geom = function () {
    const n = this.keys.length;
    const cell = this.cell;
    // 行标签宽度按最长标签估算
    const ctx = this.ctx;
    ctx.font = '11.5px "Segoe UI","Microsoft YaHei",sans-serif';
    let lw = 0;
    for (let i = 0; i < Math.min(n, 60); i++) lw = Math.max(lw, ctx.measureText(this.labels[i]).width);
    const labelW = Math.min(230, lw + 26);
    const labelH = 118;
    return { n: n, cell: cell, labelW: labelW, labelH: labelH, ox: labelW, oy: labelH };
  };

  Matrix.prototype.hit = function (sx, sy) {
    const g = this._geom();
    const j = Math.floor((sx - g.ox + this.off.x) / g.cell);
    const i = Math.floor((sy - g.oy + this.off.y) / g.cell);
    if (i < 0 || j < 0 || i >= g.n || j >= g.n || i === j) return null;
    if (sx < g.ox || sy < g.oy) return null;
    const rec = this.map.get(i + ':' + j);
    return { i: i, j: j, rate: rec ? rec.rate : null, n: rec ? rec.n : 0, pair: rec ? rec.pair : null, k1: this.keys[i], k2: this.keys[j] };
  };

  Matrix.prototype._loop = function () {
    const self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () {
      self._raf = null;
      self.draw();
      // 入场动画未结束则继续重绘（否则只会留下第一帧的半透明画面）
      if (performance.now() - self.animStart < 1500) self._loop();
    });
  };

  /**
   * 视图重新显示时调用。
   * 画布在隐藏期间可能被浏览器丢弃合成内容，必须主动重绘一次。
   */
  Matrix.prototype.redraw = function (animate) {
    this.autoCell = true;
    if (animate !== false) this.animStart = performance.now();
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this._loop();
  };

  Matrix.prototype.draw = function () {
    const fit = U.fitCanvas(this.canvas);
    this.w = fit.w; this.h = fit.h;
    const ctx = fit.ctx;

    // 自适应格子大小（用户手动缩放后不再自动调整）
    let g = this._geom();
    if (this.autoCell && g.n) {
      const availW = this.w - g.labelW - 8;
      const availH = this.h - g.labelH - 26;
      this.cell = U.clamp(Math.min(availW / g.n, availH / g.n), 13, 56);
      g = this._geom();
    }
    const n = g.n;

    ctx.clearRect(0, 0, this.w, this.h);

    if (!n) {
      ctx.fillStyle = '#5d6f8f';
      ctx.font = '13px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', this.w / 2, this.h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const t = performance.now() - this.animStart;
    const hovering = this.hover;
    const sel = this.selection;
    const hlKey = this.highlightKey;
    const hlIdx = hlKey ? this.keys.indexOf(hlKey) : -1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(g.ox, g.oy, this.w - g.ox, this.h - g.oy);
    ctx.clip();
    ctx.translate(g.ox - this.off.x, g.oy - this.off.y);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = j * g.cell, y = i * g.cell;

        // 逐个淡入
        const delay = (i + j) * 9;
        const a = U.clamp((t - delay) / 260, 0, 1);
        if (a <= 0) continue;

        if (i === j) {
          ctx.globalAlpha = a * 0.5;
          ctx.fillStyle = '#141d33';
          ctx.fillRect(x, y, g.cell - 1, g.cell - 1);
          ctx.globalAlpha = a * 0.5;
          ctx.strokeStyle = '#2a3a55';
          ctx.beginPath();
          ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + g.cell - 4, y + g.cell - 4);
          ctx.moveTo(x + g.cell - 4, y + 3); ctx.lineTo(x + 3, y + g.cell - 4);
          ctx.stroke();
          ctx.globalAlpha = 1;
          continue;
        }

        const rec = this.map.get(i + ':' + j);
        let alpha = a;

        const dim = (hovering && hovering.i !== i && hovering.j !== j) ||
          (sel && sel.i !== i && sel.j !== j) ||
          (hlIdx >= 0 && hlIdx !== i && hlIdx !== j);
        if (dim) alpha *= 0.22;

        if (rec) {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = U.rateColor(rec.rate);
          ctx.fillRect(x, y, g.cell - 1, g.cell - 1);
          if (g.cell >= 24) {
            ctx.globalAlpha = alpha * 0.96;
            // 深色格子用浅字，亮色格子用深字
            ctx.fillStyle = rateLum(rec.rate) >= 52 ? '#08111f' : '#e9f2ff';
            ctx.font = (rec.n >= 3 ? '700 ' : '') + Math.min(12, g.cell * 0.38) + 'px "Segoe UI",sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(rec.n), x + g.cell / 2 - 0.5, y + g.cell / 2 + 0.5);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
          }
        } else {
          ctx.globalAlpha = alpha * 0.55;
          ctx.fillStyle = '#111a2e';
          ctx.fillRect(x, y, g.cell - 1, g.cell - 1);
        }
        ctx.globalAlpha = 1;
      }
    }

    // 高亮十字
    const mk = hovering || sel;
    if (mk) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#7cc0ff';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(mk.j * g.cell - 1, 0, g.cell, n * g.cell);
      ctx.strokeRect(0, mk.i * g.cell - 1, n * g.cell, g.cell);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // ---- 顶部列标签（斜排）----
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.ox, 0, this.w - g.ox, g.oy);
    ctx.clip();
    ctx.translate(g.ox - this.off.x, g.oy - 6);
    ctx.font = '11.5px "Segoe UI","Microsoft YaHei",sans-serif';
    for (let j = 0; j < n; j++) {
      const isHl = (hovering && hovering.j === j) || (sel && sel.j === j) || (hlIdx === j);
      ctx.save();
      ctx.translate(j * g.cell + g.cell / 2, 0);
      ctx.rotate(-Math.PI / 3.4);
      ctx.fillStyle = isHl ? '#ffffff' : '#8fa3c4';
      ctx.fillText(this.labels[j], 0, 0);
      // 兵种（斜排标签后接一小段彩色字符）
      const sigC = this.troopSigs[j] || '';
      if (sigC) {
        let bx = ctx.measureText(this.labels[j]).width + 4;
        for (let t = 0; t < sigC.length; t++) {
          const ch = sigC.charAt(t);
          ctx.fillStyle = U.troopColor(ch);
          ctx.fillText(ch, bx, 0);
          bx += ctx.measureText(ch).width + 0.5;
        }
      }
      ctx.restore();
    }
    ctx.restore();

    // ---- 左侧行标签 ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, g.oy, g.ox, this.h - g.oy);
    ctx.clip();
    ctx.translate(0, g.oy - this.off.y);
    ctx.font = '11.5px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const isHl = (hovering && hovering.i === i) || (sel && sel.i === i) || (hlIdx === i);
      if (isHl) {
        ctx.fillStyle = 'rgba(124,192,255,.14)';
        ctx.fillRect(0, i * g.cell, g.ox - 4, g.cell - 1);
      }
      ctx.fillStyle = isHl ? '#ffffff' : '#8fa3c4';
      const txt = this.labels[i];
      const sig = this.troopSigs[i] || '';
      const sigW = sig ? ctx.measureText(sig).width + 5 : 0;
      const maxW = g.ox - 12 - sigW;
      let out = txt;
      if (ctx.measureText(out).width > maxW) {
        while (out.length > 2 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
        out += '…';
      }
      ctx.fillText(out, 8, i * g.cell + g.cell / 2);
      // 兵种：跟进行标签后面，按兵种配色
      if (sig) {
        let bx = 8 + ctx.measureText(out).width + 5;
        for (let t = 0; t < sig.length; t++) {
          const ch = sig.charAt(t);
          ctx.fillStyle = U.troopColor(ch);
          ctx.fillText(ch, bx, i * g.cell + g.cell / 2);
          bx += ctx.measureText(ch).width + 0.5;
        }
      }
    }
    ctx.restore();

    // ---- 提示行 ----
    ctx.fillStyle = '#5d6f8f';
    ctx.font = '11.5px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.fillText('行 对 列 的胜率 · 格内数字为对局场次 · 滚轮缩放', 8, this.h - 8);
  };

  Matrix.prototype.exportPng = function () {
    return this.canvas.toDataURL('image/png');
  };

  AC.Matrix = Matrix;
})(window.AC);
