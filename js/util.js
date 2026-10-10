/* ============================================================
   通用工具
   ============================================================ */
window.AC = window.AC || {};

(function (AC) {
  'use strict';

  /* ---------------- 旧内核兼容（360 兼容模式 / IE 内核） ----------------
     不依赖任何新语法，缺失的原生方法就补一个最小实现。 */
  if (!Array.from) {
    Array.from = function (obj, fn) {
      var out = [], i;
      try {
        if (typeof Symbol !== 'undefined' && Symbol.iterator && obj && typeof obj[Symbol.iterator] === 'function') {
          var it = obj[Symbol.iterator](), r = it.next();
          while (!r.done) { out.push(r.value); r = it.next(); }
        } else {
          for (i = 0; i < (obj.length || 0); i++) out.push(obj[i]);
        }
      } catch (e) {
        out = [];
        for (i = 0; i < (obj && obj.length || 0); i++) out.push(obj[i]);
      }
      return fn ? out.map(fn) : out;
    };
  }
  if (!Object.assign) {
    Object.assign = function (target) {
      for (var i = 1; i < arguments.length; i++) {
        var src = arguments[i];
        if (!src) continue;
        for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
      }
      return target;
    };
  }
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (len, pad) {
      var s = String(this);
      pad = pad === undefined ? ' ' : String(pad);
      while (s.length < len) s = pad + s;
      return s;
    };
  }
  if (!Array.prototype.find) {
    Array.prototype.find = function (fn, thisArg) {
      for (var i = 0; i < this.length; i++) if (fn.call(thisArg, this[i], i, this)) return this[i];
      return undefined;
    };
  }
  if (!Array.prototype.includes) {
    Array.prototype.includes = function (v) { return this.indexOf(v) >= 0; };
  }
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function (fn, thisArg) {
      var out = [];
      for (var i = 0; i < this.length; i++) {
        var r = fn.call(thisArg, this[i], i, this);
        if (Array.isArray(r)) out.push.apply(out, r); else out.push(r);
      }
      return out;
    };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function (v) { return this.indexOf(v) >= 0; };
  }
  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (v) { return this.indexOf(v) === 0; };
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    return Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return '-';
    return (v * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function fmtSigned(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return '-';
    const s = (v * 100).toFixed(digits === undefined ? 1 : digits);
    return (v > 0 ? '+' : '') + s + '%';
  }

  /** 千分位缩写：12345 -> 1.2万 */
  function fmtShort(n) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(Math.round(n));
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 120);
    };
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /** 数字滚动动画 */
  function countTo(node, to, ms) {
    const from = parseFloat(String(node.textContent).replace(/[^\d.-]/g, '')) || 0;
    if (from === to) { node.textContent = fmtInt(to); return; }
    const t0 = performance.now();
    const dur = ms || 620;
    function step(now) {
      const t = clamp((now - t0) / dur, 0, 1);
      node.textContent = fmtInt(lerp(from, to, easeOutCubic(t)));
      if (t < 1) requestAnimationFrame(step);
      else node.textContent = fmtInt(to);
    }
    requestAnimationFrame(step);
  }

  /** 胜率配色：0 -> 冷蓝，0.5 -> 中性灰，1 -> 热红 */
  function rateColor(rate, alpha) {
    const a = alpha === undefined ? 1 : alpha;
    const r = clamp(rate, 0, 1);
    let h, s, l;
    if (r < 0.5) {
      const t = r / 0.5;                 // 0..1
      h = lerp(205, 220, t);
      s = lerp(85, 12, t);
      l = lerp(56, 42, t);
    } else {
      const t = (r - 0.5) / 0.5;         // 0..1
      h = lerp(220, 353, t);
      s = lerp(12, 82, t);
      l = lerp(42, 56, t);
    }
    return 'hsla(' + h.toFixed(0) + ',' + s.toFixed(0) + '%,' + l.toFixed(0) + '%,' + a + ')';
  }

  /** 阵容热力色（按出场次数归一化） */
  function nodeColor(t) {
    const x = clamp(t, 0, 1);
    return 'hsl(' + lerp(268, 196, x).toFixed(0) + ',' + lerp(58, 80, x).toFixed(0) + '%,' + lerp(48, 60, x).toFixed(0) + '%)';
  }

  /** 按 DPR 调整画布尺寸，返回逻辑宽高 */
  function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h, ctx: ctx };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  /** 稳定字符串哈希（用于无战斗Key时的兜底去重） */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  /** HTML 转义（拼接 innerHTML 时用） */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg, type, ms) {
    const host = $('#toastHost');
    if (!host) return;
    const t = el('div', { class: 'toast ' + (type || ''), html: msg });
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateX(24px)';
      setTimeout(function () { t.remove(); }, 320);
    }, ms || 3200);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 100);
  }

  function downloadText(filename, text, mime) {
    downloadBlob(filename, new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
  }

  function stamp() {
    const d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ---------- 兵种徽章 ---------- */

  const TROOP_KEY = { '枪': 'qiang', '弓': 'gong', '骑': 'qi', '盾': 'dun', '器': 'qi2', '械': 'xie', '水': 'shui' };
  // canvas 里没法用 CSS 类，这里给同款配色
  const TROOP_COLOR = { '枪': '#ffb547', '弓': '#4ea8ff', '骑': '#c084fc', '盾': '#4ade80', '器': '#22d3ee', '械': '#f472b6', '水': '#38bdf8' };

  function troopKey(name) {
    return TROOP_KEY[String(name || '').charAt(0)] || 'other';
  }

  function troopColor(name) {
    return TROOP_COLOR[String(name || '').charAt(0)] || '#8fa3c4';
  }

  /** 单个兵种徽章（可传「枪兵」或「枪」） */
  function troopBadge(name) {
    const s = String(name || '').trim();
    if (!s) return null;
    const ch = s.charAt(0);
    const node = el('span', { class: 'troop t-' + troopKey(ch), title: s });
    node.textContent = ch;
    return node;
  }

  /** 兵种串（如「枪弓弓」）-> 一排徽章 */
  function troopBadges(sig) {
    const s = String(sig || '').trim();
    if (!s) return null;
    const wrap = el('span', { class: 'troop-set' });
    for (let i = 0; i < s.length; i++) {
      const b = troopBadge(s.charAt(i));
      if (b) wrap.appendChild(b);
    }
    return wrap;
  }

  /** 阵容名 + 兵种徽章：SP周瑜 / 诸葛瑾 / 诸葛亮 [枪][弓][弓] */
  function compWithTroop(name, sig, cls) {
    const wrap = el('span', { class: 'cw' + (cls ? ' ' + cls : '') });
    wrap.appendChild(el('span', { class: 'cw-name', text: name }));
    const badges = troopBadges(sig);
    if (badges) wrap.appendChild(badges);
    return wrap;
  }

  /** innerHTML 版本的兵种串（tooltip 用） */
  function troopHtml(sig) {
    const s = String(sig || '').trim();
    if (!s) return '';
    let out = '<span class="troop-set">';
    for (let i = 0; i < s.length; i++) {
      out += '<span class="troop t-' + troopKey(s.charAt(i)) + '">' + s.charAt(i) + '</span>';
    }
    return out + '</span>';
  }

  AC.util = {
    $: $, $$: $$, el: el, clamp: clamp, lerp: lerp,
    fmtInt: fmtInt, fmtPct: fmtPct, fmtSigned: fmtSigned, fmtShort: fmtShort,
    debounce: debounce, easeOutCubic: easeOutCubic, countTo: countTo,
    rateColor: rateColor, nodeColor: nodeColor, fitCanvas: fitCanvas, roundRect: roundRect,
    hash: hash, toast: toast, downloadBlob: downloadBlob, downloadText: downloadText, stamp: stamp, esc: esc,
    troopKey: troopKey, troopColor: troopColor, troopBadge: troopBadge, troopBadges: troopBadges,
    compWithTroop: compWithTroop, troopHtml: troopHtml
  };
})(window.AC);
