window.AC = window.AC || {};

/* ============================================================
   克制网络图
   - 力导向布局（Fruchterman-Reingold 变体），持续退火
   - 有向边：箭头 + 沿边流动的粒子表示克制方向
   - 悬停高亮、点击选中、拖拽节点、滚轮缩放、平移
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;

  function Graph(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks || {};
    this.nodes = [];
    this.edges = [];
    this.nodeIndex = new Map();
    this.alpha = 0.9;
    this.w = 900; this.h = 600;
    this.view = { x: 0, y: 0, k: 1 };
    this.hoverNode = null;
    this.hoverEdge = null;
    this.selection = null;          // { type:'node'|'edge', id }
    this.neighbors = new Map();     // nodeKey -> Set(相关 nodeKey)
    this.showLabels = true;
    this.showParticles = true;
    this.dragNode = null;
    this.panning = null;
    this.mouse = { x: -999, y: -999 };
    this.t0 = performance.now();
    this.running = true;

    /* ---- 3D 模式：z 轴承载「阵容强度」，2D 是它的特例 ---- */
    this.threeD = false;
    this.yaw = 0.62;            // 绕竖轴旋转
    this.pitch = 0.42;          // 俯仰
    this.fov = 1250;            // 透视焦距
    this.rotating = null;       // 拖拽旋转状态
    this.pressAt = null;        // 按下的位置：用来区分「单击选中」与「拖动」
    this.hoverTimer = null;     // 悬停提示的延时器：停住才显示，拖动中不显示
    this.zRange = 260;          // z 轴幅度（世界单位）

    this._frame = this._frame.bind(this);
    this._bindEvents();
    requestAnimationFrame(this._frame);
  }

  /** 切换 2D / 3D（3D 下 z 轴 = 净压制力，强的浮在上层） */
  Graph.prototype.setMode = function (mode) {
    const next = mode === '3d';
    if (next === this.threeD) return;
    this.threeD = next;
    this.alpha = Math.max(this.alpha, 0.7);
    if (next) {
      this.yaw = 0.62; this.pitch = 0.42;
      this.view.k = U.clamp(this.view.k, 0.5, 1.35);
      this.view.x = 0; this.view.y = 0;
    } else {
      this.nodes.forEach(function (n) { n.z = 0; n.vz = 0; });
      this.view = { x: 0, y: 0, k: 1 };
    }
    this.relayout();
  };

  /* ---------------- 数据装载 ---------------- */

  Graph.prototype.setData = function (result, display) {
    display = display || {};
    const topN = display.topN || 30;
    const list = result.nodeList.slice(0, topN);
    const allowed = new Set(list.map(function (n) { return n.key; }));
    const maxN = list.length ? list[0].n : 1;
    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.34;

    const prev = this.nodeIndex;
    // z 轴目标：净压制力归一化（强的浮在上层）
    let maxPower = 0;
    list.forEach(function (nd) { maxPower = Math.max(maxPower, Math.abs(nd.netPower || 0)); });
    maxPower = maxPower || 1;
    const zRange = this.zRange;

    this.nodes = list.map(function (nd, i) {
      const old = prev.get(nd.key);
      const ang = (i / Math.max(1, list.length)) * Math.PI * 2 + 0.6;
      const zTarget = ((nd.netPower || 0) / maxPower) * zRange;
      return {
        id: nd.key,
        data: nd,
        label: nd.display,
        n: nd.n,
        rate: nd.rate,
        netPower: nd.netPower || 0,
        r: 8 + 15 * Math.sqrt(nd.n / maxN),
        x: old ? old.x : cx + Math.cos(ang) * R * (0.55 + 0.45 * Math.random()),
        y: old ? old.y : cy + Math.sin(ang) * R * (0.55 + 0.45 * Math.random()),
        z: old ? old.z : zTarget * (0.4 + 0.6 * Math.random()),
        zTarget: zTarget,
        vx: 0, vy: 0, vz: 0,
        fixed: false
      };
    });

    this.nodeIndex = new Map(this.nodes.map(function (n) { return [n.id, n]; }));

    this.edges = result.edges
      .filter(function (e) { return allowed.has(e.source) && allowed.has(e.target); })
      .map(function (e) {
        return {
          id: e.source + '||' + e.target,
          source: e.source,
          target: e.target,
          data: e,
          n: e.n,
          rate: e.rate,
          score: e.score,
          width: U.clamp(0.9 + Math.log2(1 + e.n) * 0.9, 1, 5.5),
          particles: []
        };
      });

    const pnum = function (e) { return U.clamp(Math.round(1 + e.n / 2.5), 1, 6); };
    this.edges.forEach(function (e) {
      const c = pnum(e);
      for (let i = 0; i < c; i++) e.particles.push({ t: Math.random(), sp: 0.0016 + e.score * 0.006 });
    });

    // 邻接表
    this.neighbors = new Map();
    this.edges.forEach(function (e) {
      if (!this.neighbors.has(e.source)) this.neighbors.set(e.source, new Set());
      if (!this.neighbors.has(e.target)) this.neighbors.set(e.target, new Set());
      this.neighbors.get(e.source).add(e.target);
      this.neighbors.get(e.target).add(e.source);
    }, this);

    this.alpha = 1;
    if (this.cb.onLayoutChange) this.cb.onLayoutChange(this.nodes.length, this.edges.length);
  };

  Graph.prototype.relayout = function () {    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.34;
    this.nodes.forEach(function (n, i) {
      const a = (i / Math.max(1, this.nodes.length)) * Math.PI * 2;
      n.x = cx + Math.cos(a) * R * (0.6 + 0.4 * Math.random());
      n.y = cy + Math.sin(a) * R * (0.6 + 0.4 * Math.random());
      n.z = this.threeD ? n.zTarget * 0.85 : 0;
      n.vx = n.vy = 0;
      n.vz = 0;
    }, this);
    this.alpha = 1;
  };

  /** 视图重新显示时调用：轻微回暖物理，避免画布因隐藏丢失内容而空白 */
  Graph.prototype.refresh = function () {
    if (this.nodes.length) this.alpha = Math.max(this.alpha, 0.06);
  };

  Graph.prototype.setSelection = function (sel) {
    this.selection = sel || null;
  };

  Graph.prototype.focusNode = function (key) {
    const n = this.nodeIndex.get(key);
    if (!n) return;
    this.view.x = this.w / 2 - n.x * this.view.k;
    this.view.y = this.h / 2 - n.y * this.view.k;
    this.setSelection({ type: 'node', id: key });
  };

  /* ---------------- 事件 ---------------- */

  /** 是否正处在拖动状态（拖节点 / 旋转视角 / 平移画布） */
  Graph.prototype._dragging = function () {
    return !!(this.dragNode || this.rotating || this.panning);
  };

  /** 取消待显示的悬停提示 */
  Graph.prototype._cancelTip = function () {
    if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
  };

  /** 立即收起提示面板 */
  Graph.prototype._hideTip = function () {
    this._cancelTip();
    if (this.cb.onHover) this.cb.onHover(null);
  };

  /**
   * 安排一次悬停提示：鼠标停住 HOVER_DELAY 毫秒才真正弹出。
   * 拖动中（或拖动刚结束还按着）不显示——这时鼠标只是"经过"，不是"悬停"。
   */
  Graph.prototype._scheduleTip = function () {
    const self = this;
    const DELAY = 160;
    this._cancelTip();
    if (this._dragging()) return;

    const n = this.hoverNode, e = this.hoverEdge;
    if (!n && !e) { if (this.cb.onHover) this.cb.onHover(null); return; }

    this.hoverTimer = setTimeout(function () {
      self.hoverTimer = null;
      if (self._dragging()) return;                     // 这期间又开始拖了
      if (self.cb.onHover) {
        const payload = n
          ? { type: 'node', id: n.id, screen: { x: self.mouse.x, y: self.mouse.y } }
          : { type: 'edge', id: e.id, screen: { x: self.mouse.x, y: self.mouse.y } };
        self.cb.onHover(payload);
      }
    }, DELAY);
  };

  Graph.prototype._bindEvents = function () {
    const self = this;
    const cv = this.canvas;

    cv.addEventListener('mousemove', function (ev) {
      const rect = cv.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      self.mouse.x = sx; self.mouse.y = sy;

      // 只要移动超过几个像素，就认为这次是「拖动」而不是「单击」
      if (self.pressAt && !self.pressAt.moved) {
        if (Math.abs(sx - self.pressAt.x) > 4 || Math.abs(sy - self.pressAt.y) > 4) self.pressAt.moved = true;
      }

      if (self.rotating) {
        // 3D：拖拽空白 = 旋转视角（以按下时的角度为基准，手感稳定）
        const nx = self.rotating.x, ny = self.rotating.y;
        self.yaw = self.rotating.yaw + (sx - nx) * 0.008;
        // 俯仰限制在 ±1.5 弧度（约 ±86°）：够看到接近正上/正下，又不触及万向节死锁
        self.pitch = U.clamp(self.rotating.pitch + (sy - ny) * 0.0065, -1.5, 1.5);
        return;
      }
      if (self.dragNode) {
        if (self.threeD) {
          // 3D：把屏幕位移换算成世界位移（忽略旋转带来的形变，够用）
          self.dragNode.x += (sx - self.mouse.x) / self.view.k;
          self.dragNode.y += (sy - self.mouse.y) / self.view.k;
        } else {
          const p = self.toWorld(sx, sy);
          self.dragNode.x = p.x; self.dragNode.y = p.y;
        }
        self.dragNode.vx = self.dragNode.vy = 0;
        self.dragNode.vz = 0;
        self.alpha = Math.max(self.alpha, 0.45);
        return;
      }
      if (self.panning) {
        self.view.x += sx - self.panning.x;
        self.view.y += sy - self.panning.y;
        self.panning.x = sx; self.panning.y = sy;
        return;
      }

      const p = self.toWorld(sx, sy);
      const node = self.hitNode(p.x, p.y);
      const edge = node ? null : self.hitEdge(p.x, p.y);
      const changed = node !== self.hoverNode || edge !== self.hoverEdge;
      self.hoverNode = node;
      self.hoverEdge = edge;
      cv.style.cursor = node ? 'pointer' : (edge ? 'crosshair' : 'grab');
      if (changed) {
        self.needsGlow = true;
        self._scheduleTip();          // 停住才弹面板；拖动中不会走到这里
      }
    });

    cv.addEventListener('mouseleave', function () {
      self.hoverNode = null; self.hoverEdge = null;
      self._hideTip();
    });

    // 右键用于拖动画布，屏蔽浏览器右键菜单
    cv.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    cv.addEventListener('mousedown', function (ev) {
      const rect = cv.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      self.pressAt = { x: sx, y: sy, moved: false };
      self._hideTip();          // 一按下就先收起提示面板

      // 3D：左键拖动 = 旋转视角（节点上也可以，方便随时转视角）；
      //     右键拖动 = 平移整个画布
      // 想选中节点就单击（拖动超过阈值就不算点击了，见 click 处理）
      if (self.threeD) {
        if (ev.button === 2) {
          self.panning = { x: sx, y: sy };
          cv.style.cursor = 'grabbing';
        } else {
          self.rotating = { x: sx, y: sy, yaw: self.yaw, pitch: self.pitch };
          cv.style.cursor = 'move';
        }
        return;
      }

      const p = self.toWorld(sx, sy);
      const node = self.hitNode(p.x, p.y);
      if (node) { self.dragNode = node; node.fixed = true; cv.style.cursor = 'grabbing'; }
      else self.panning = { x: sx, y: sy };
    });

    window.addEventListener('mouseup', function () {
      const wasDragging = self._dragging();
      if (self.dragNode) { self.dragNode.fixed = false; self.dragNode = null; }
      self.panning = null;
      self.rotating = null;
      // 光标交回给悬停状态决定（停在节点上就还是 pointer）
      cv.style.cursor = self.hoverNode ? 'pointer' : 'grab';
      // 拖动结束后如果鼠标仍停在节点上，重新计时再弹面板
      if (wasDragging && self.pressAt && self.pressAt.moved) self._scheduleTip();
    });

    cv.addEventListener('click', function (ev) {
      // 刚才是拖动（旋转 / 平移 / 拖节点），不当作点击——避免拖完顺手选中一个节点
      if (self.pressAt && self.pressAt.moved) { self.pressAt = null; return; }
      self.pressAt = null;

      const rect = cv.getBoundingClientRect();
      const p = self.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      const node = self.hitNode(p.x, p.y);
      let sel = null;
      if (node) sel = { type: 'node', id: node.id };
      else {
        const edge = self.hitEdge(p.x, p.y);
        if (edge) sel = { type: 'edge', id: edge.id, edge: edge };
      }
      const same = sel && self.selection && sel.type === self.selection.type && sel.id === self.selection.id;
      self.selection = same ? null : sel;
      if (self.cb.onSelect) self.cb.onSelect(same ? null : sel);
    });

    cv.addEventListener('dblclick', function () {
      if (self.threeD) { self.yaw = 0.62; self.pitch = 0.42; self.view.k = 1; self.view.x = 0; self.view.y = 0; }
      else self.view = { x: 0, y: 0, k: 1 };
      self.relayout();
    });

    cv.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.12 : 0.89;
      if (self.threeD) {
        // 3D：缩放只需改整体比例，透视会自己处理远近
        self.view.k = U.clamp(self.view.k * factor, 0.3, 3);
        return;
      }
      const rect = cv.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      const before = self.toWorld(sx, sy);
      self.view.k = U.clamp(self.view.k * factor, 0.28, 3.2);
      const after = self.toWorld(sx, sy);
      self.view.x += (after.x - before.x) * self.view.k;
      self.view.y += (after.y - before.y) * self.view.k;
    }, { passive: false });
  };

  Graph.prototype.toWorld = function (sx, sy) {
    // 3D 下拾取直接在屏幕空间进行（反投影没必要，投影后的坐标比较更准）
    if (this.threeD) return { x: sx, y: sy };
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  };

  Graph.prototype.hitNode = function (wx, wy) {
    if (this.threeD) {
      let best = null, bestD = Infinity;
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i];
        const d = Math.hypot(wx - n.px, wy - n.py);
        const rr = n.r * n.ps + 3;
        if (d <= rr && d < bestD) { bestD = d; best = n; }
      }
      return best;
    }
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = wx - n.x, dy = wy - n.y;
      if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
    }
    return null;
  };

  Graph.prototype.hitEdge = function (wx, wy) {
    if (this.threeD) {
      let best = null, bestD = 9;
      for (let i = 0; i < this.edges.length; i++) {
        const g = this.edges[i]._draw;
        if (!g) continue;
        const d = distToSegment(wx, wy, g.x1, g.y1, g.x2, g.y2);
        if (d < bestD) { bestD = d; best = this.edges[i]; }
      }
      return best;
    }
    let best = null, bestD = 8;
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      const a = this.nodeIndex.get(e.source), b = this.nodeIndex.get(e.target);
      if (!a || !b) continue;
      const d = distToSegment(wx, wy, a.x, a.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  };

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = U.clamp(t, 0, 1);
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  /* ---------------- 物理模拟 ---------------- */

  Graph.prototype._step = function () {
    const nodes = this.nodes, edges = this.edges;
    const n = nodes.length;
    if (!n) return;

    const k = Math.sqrt((this.w * this.h) / n) * 0.82;
    const cx = this.w / 2, cy = this.h / 2;
    const alpha = this.alpha;
    const three = this.threeD;

    // 斥力
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dz = three ? (a.z - b.z) * 1.7 : 0;
        let d2 = dx * dx + dy * dy + dz * dz;
        let d = Math.sqrt(d2) || 0.01;
        const minD = a.r + b.r + 10;
        if (d < minD) { d = minD; d2 = d * d; }
        const f = (k * k) / d2 * 1.35;
        const inv = f / d;
        a.vx += dx * inv; a.vy += dy * inv;
        b.vx -= dx * inv; b.vy -= dy * inv;
        if (three) { a.vz += dz * inv; b.vz -= dz * inv; }
      }
    }

    // 弹簧（克制越强，节点靠得越近，形成「克制簇」）
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = this.nodeIndex.get(e.source), b = this.nodeIndex.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dz = three ? (b.z - a.z) : 0;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const want = U.lerp(265, 155, U.clamp(e.score, 0, 1)) * (1 + (a.r + b.r) / 240);
      const f = (d - want) * 0.014 * U.clamp(0.6 + Math.log2(1 + e.n) * 0.25, 0.6, 1.8);
      const inv = f / d;
      a.vx += dx * inv; a.vy += dy * inv;
      b.vx -= dx * inv; b.vy -= dy * inv;
      if (three) { a.vz += dz * inv; b.vz -= dz * inv; }
    }

    // 向心引力 + 位移应用
    let ke = 0;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      a.vx += (cx - a.x) * 0.0072;
      a.vy += (cy - a.y) * 0.0072;
      a.vx *= 0.82; a.vy *= 0.82;
      if (three) {
        // z 轴额外弹簧：把节点拉向「强度」对应的层
        a.vz += (a.zTarget - a.z) * 0.028;
        a.vz *= 0.86;
      }
      if (a.fixed) { a.vx = a.vy = 0; if (three) a.vz = 0; continue; }
      const disp = Math.hypot(a.vx, a.vy);
      const maxDisp = 14 * alpha + 0.4;
      const sc = disp > maxDisp ? maxDisp / disp : 1;
      a.x += a.vx * sc * alpha * 1.6;
      a.y += a.vy * sc * alpha * 1.6;
      if (three) a.z += a.vz * sc * alpha * 1.6;
      ke += disp * disp;
    }

    // 边界软约束（右侧多留出标签空间）
    const padT = 52, padB = 62, padL = 56;
    const padR = Math.min(210, Math.max(120, this.w * 0.2));
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      if (a.x < padL + a.r) { a.x = padL + a.r; a.vx *= -0.3; }
      if (a.y < padT + a.r) { a.y = padT + a.r; a.vy *= -0.3; }
      if (a.x > this.w - padR - a.r) { a.x = this.w - padR - a.r; a.vx *= -0.3; }
      if (a.y > this.h - padB - a.r) { a.y = this.h - padB - a.r; a.vy *= -0.3; }
      if (three) {
        const lim = this.zRange * 1.7;
        if (a.z > lim) { a.z = lim; a.vz *= -0.3; }
        if (a.z < -lim) { a.z = -lim; a.vz *= -0.3; }
      }
    }

    this.alpha = alpha * 0.9855;
    if (this.alpha < 0.0025) this.alpha = 0;
    return ke;
  };

  /* ---------------- 渲染 ---------------- */

  /**
   * 每帧把所有节点投影到屏幕坐标。
   * 2D 是 3D 的特例：无旋转、无透视，只有平移缩放。
   * 投影后统一用 n.px / n.py / n.ps（尺寸缩放）/ n.depth（深度）绘制，
   * 这样两条渲染路径共用同一套绘制代码。
   */
  Graph.prototype._project = function () {
    const view = this.view;
    const cw = this.w / 2, ch = this.h / 2;
    const nodes = this.nodes;
    let i, n;

    if (!this.threeD) {
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n.px = n.x * view.k + view.x;
        n.py = n.y * view.k + view.y;
        n.ps = view.k;
        n.depth = 0;
        n.fog = 1;
      }
      this.depthMin = 0; this.depthMax = 1;
      return;
    }

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fov = this.fov;
    let minD = Infinity, maxD = -Infinity;

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      const wx = n.x - cw, wy = n.y - ch, wz = n.z;
      // 先绕竖轴（yaw），再绕横轴（pitch）
      const x1 = wx * cy - wz * sy;
      const z1 = wx * sy + wz * cy;
      const y1 = wy * cp - z1 * sp;
      const z2 = wy * sp + z1 * cp;

      const persp = fov / Math.max(120, fov + z2);
      // 叠上 view.x / view.y：右键拖动的「平移整个画布」在 3D 下同样生效
      n.px = cw + x1 * persp * view.k + view.x;
      n.py = ch + y1 * persp * view.k + view.y;
      n.ps = persp * view.k;
      n.depth = z2;
      if (z2 < minD) minD = z2;
      if (z2 > maxD) maxD = z2;
    }
    this.depthMin = minD;
    this.depthMax = maxD;

    // 远处的节点雾化：更暗更小，产生空气透视
    const span = Math.max(1, maxD - minD);
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      const t = (n.depth - minD) / span;        // 0 近 → 1 远
      n.fog = U.clamp(1 - t * 0.62, 0.34, 1);
    }
  };

  Graph.prototype._frame = function (now) {
    const dt = Math.min(48, now - this.t0);
    this.t0 = now;

    const fit = U.fitCanvas(this.canvas);
    this.w = fit.w; this.h = fit.h;
    const ctx = fit.ctx;

    if (this.alpha > 0) this._step();
    this._project();

    ctx.clearRect(0, 0, this.w, this.h);
    this._drawBackdrop(ctx);

    const focus = this._focusSet();
    this._drawEdges(ctx, focus, dt);
    if (this.showParticles) this._drawParticles(ctx, focus, dt);
    this._drawNodes(ctx, focus);
    if (this.showLabels) this._drawLabels(ctx, focus);
    if (this.threeD) this._drawViewCube(ctx);

    requestAnimationFrame(this._frame);
  };

  /**
   * 右上角的方向指示器（ViewCube）。
   * 用与主视图完全相同的 yaw / pitch 画一个小立方体：转到哪、翻了多少，一眼能看出来。
   * 三个轴向的面各给一个色系（X 蓝 / Y 绿 / Z 紫），朝向观众的面上色更实。
   */
  Graph.prototype._drawViewCube = function (ctx) {
    const size = 40;
    const h = size / 2;
    const cx = this.w - h - 24;
    const cy = h + 24;

    const cyaw = Math.cos(this.yaw), syaw = Math.sin(this.yaw);
    const cpit = Math.cos(this.pitch), spit = Math.sin(this.pitch);

    // 单位立方体的 8 个顶点
    const V = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
    ];
    const P = V.map(function (v) {
      const x1 = v[0] * cyaw - v[2] * syaw;
      const z1 = v[0] * syaw + v[2] * cyaw;
      const y1 = v[1] * cpit - z1 * spit;
      const z2 = v[1] * spit + z1 * cpit;
      // 与主视图同一套投影（屏幕 y 向下）
      return { x: cx + x1 * h, y: cy + y1 * h, z: z2 };
    });

    // 六个面：顶点按外法线方向排列
    const FACES = [
      { idx: [1, 2, 6, 5], n: [1, 0, 0], on: 'rgba(78,168,255,.50)', off: 'rgba(78,168,255,.10)' },
      { idx: [0, 4, 7, 3], n: [-1, 0, 0], on: 'rgba(78,168,255,.24)', off: 'rgba(78,168,255,.05)' },
      { idx: [2, 3, 7, 6], n: [0, 1, 0], on: 'rgba(53,196,107,.50)', off: 'rgba(53,196,107,.10)' },
      { idx: [0, 1, 5, 4], n: [0, -1, 0], on: 'rgba(53,196,107,.24)', off: 'rgba(53,196,107,.05)' },
      { idx: [4, 5, 6, 7], n: [0, 0, 1], on: 'rgba(124,92,255,.55)', off: 'rgba(124,92,255,.10)' },
      { idx: [0, 3, 2, 1], n: [0, 0, -1], on: 'rgba(124,92,255,.24)', off: 'rgba(124,92,255,.05)' }
    ];
    // 法线旋转后的 z 分量：小于 0 表示这个面朝向观众
    const nz = function (n) {
      const z1 = n[0] * syaw + n[2] * cyaw;
      return n[1] * spit + z1 * cpit;
    };

    const list = FACES.map(function (f) {
      const z = nz(f.n);
      return { f: f, z: z, vis: z < 0 };
    }).sort(function (a, b) { return a.z - b.z; });   // 远的先画

    ctx.save();
    // 底板
    ctx.beginPath();
    ctx.arc(cx, cy, h + 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,14,26,.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(78,168,255,.20)';
    ctx.lineWidth = 1;
    ctx.stroke();

    list.forEach(function (it) {
      ctx.beginPath();
      it.f.idx.forEach(function (vi, k) {
        const p = P[vi];
        if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = it.vis ? it.f.on : it.f.off;
      ctx.fill();
      ctx.strokeStyle = it.vis ? 'rgba(150,200,255,.55)' : 'rgba(120,150,190,.20)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // 底座上的「左 / 右」小字，便于对方向
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(140,170,210,.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('指向', cx, cy + h + 22);
    ctx.restore();
  };

  /** 计算高亮集合：选中/悬停的节点及其邻居 */
  Graph.prototype._focusSet = function () {
    const sel = this.selection;
    let key = null;
    if (sel && sel.type === 'node') key = sel.id;
    else if (this.hoverNode) key = this.hoverNode.id;

    if (sel && sel.type === 'edge') {
      const e = this.edges.find(function (x) { return x.id === sel.id; });
      if (e) return { edges: new Set([e.id]), nodes: new Set([e.source, e.target]), mode: 'edge' };
    }
    if (!key) return null;
    const nb = this.neighbors.get(key) || new Set();
    const nodes = new Set([key]);
    nb.forEach(function (x) { nodes.add(x); });
    const edges = new Set();
    this.edges.forEach(function (e) {
      if (e.source === key || e.target === key) edges.add(e.id);
    });
    return { edges: edges, nodes: nodes, mode: 'node', center: key };
  };

  Graph.prototype._drawBackdrop = function (ctx) {
    const s = 44 * this.view.k;
    const ox = this.view.x % s, oy = this.view.y % s;
    ctx.save();
    ctx.strokeStyle = 'rgba(78,128,200,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < this.w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, this.h); }
    for (let y = oy; y < this.h; y += s) { ctx.moveTo(0, y); ctx.lineTo(this.w, y); }
    ctx.stroke();
    ctx.restore();
  };

  Graph.prototype._drawEdges = function (ctx, focus, dt) {
    ctx.lineCap = 'round';
    // 3D：按深度从远到近画，让近处的边盖住远处的
    let list = this.edges;
    if (this.threeD) {
      this.edges.forEach(function (e) {
        const a = this.nodeIndex.get(e.source), b = this.nodeIndex.get(e.target);
        e._depth = (a && b) ? (a.depth + b.depth) / 2 : 0;
      }, this);
      list = this.edges.slice().sort(function (x, y) { return y._depth - x._depth; });
    }

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const a = this.nodeIndex.get(e.source), b = this.nodeIndex.get(e.target);
      if (!a || !b) continue;

      let alpha = U.clamp(0.25 + e.score * 1.35, 0.16, 0.9);
      let width = e.width;
      if (focus) {
        const on = focus.edges.has(e.id);
        alpha = on ? Math.min(0.95, alpha + 0.32) : alpha * 0.1;
        if (on) width = e.width + 0.8;
      }
      const avgPs = (a.ps + b.ps) / 2;
      if (this.threeD) alpha *= (a.fog + b.fog) / 2;    // 空气透视
      if (alpha < 0.02) continue;

      const ra = a.r * a.ps, rb = b.r * b.ps;
      const dx = b.px - a.px, dy = b.py - a.py;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const x1 = a.px + ux * (ra + 1), y1 = a.py + uy * (ra + 1);
      const x2 = b.px - ux * (rb + 9), y2 = b.py - uy * (rb + 9);

      const col = U.rateColor(e.rate);
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(0.4, width * avgPs);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // 箭头
      const ang = Math.atan2(dy, dx);
      const ah = (6.5 + width) * avgPs;
      const tipX = b.px - ux * (rb + 1), tipY = b.py - uy * (rb + 1);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(ang - 0.36) * ah, tipY - Math.sin(ang - 0.36) * ah);
      ctx.lineTo(tipX - Math.cos(ang + 0.36) * ah, tipY - Math.sin(ang + 0.36) * ah);
      ctx.closePath();
      ctx.fill();

      e._draw = { x1: x1, y1: y1, x2: x2, y2: y2, col: col, alpha: alpha, ps: avgPs };
      ctx.globalAlpha = 1;
    }
  };

  Graph.prototype._drawParticles = function (ctx, focus, dt) {
    const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 420);
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      const g = e._draw;
      if (!g) continue;
      let alpha = U.clamp(g.alpha * 1.25, 0.15, 1);
      if (focus) alpha = focus.edges.has(e.id) ? 1 : alpha * 0.08;
      if (alpha < 0.03) continue;

      for (let j = 0; j < e.particles.length; j++) {
        const p = e.particles[j];
        p.t += p.sp * (dt / 16.7) * (focus ? 2.1 : 1);
        if (p.t > 1) p.t -= 1;
        const x = U.lerp(g.x1, g.x2, p.t);
        const y = U.lerp(g.y1, g.y2, p.t);
        const fade = Math.sin(p.t * Math.PI);         // 两端淡出
        const rr = (1.6 + e.score * 2.2) * (g.ps || 1);

        ctx.globalAlpha = alpha * fade * pulse;
        ctx.fillStyle = g.col;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = alpha * fade * 0.28;
        ctx.beginPath();
        ctx.arc(x, y, rr * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };

  Graph.prototype._drawNodes = function (ctx, focus) {
    const maxN = this.nodes.length ? this.nodes[0].n : 1;
    // 3D：按深度从远到近画
    const list = this.threeD
      ? this.nodes.slice().sort(function (a, b) { return b.depth - a.depth; })
      : this.nodes;

    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const t = Math.sqrt(n.n / maxN);
      let dim = false;
      if (focus && focus.mode === 'node' && !focus.nodes.has(n.id)) dim = true;

      const isSel = this.selection && this.selection.type === 'node' && this.selection.id === n.id;
      const isHover = this.hoverNode && this.hoverNode.id === n.id;
      const base = U.nodeColor(t);
      const r = Math.max(2.2, n.r * n.ps);
      const fog = this.threeD ? n.fog : 1;

      ctx.globalAlpha = (dim ? 0.16 : 1) * fog;

      // 光晕
      const glowR = r * (isSel || isHover ? 2.5 : 1.9);
      const grd = ctx.createRadialGradient(n.px, n.py, r * 0.5, n.px, n.py, glowR);
      grd.addColorStop(0, 'rgba(120,180,255,.34)');
      grd.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(n.px, n.py, glowR, 0, Math.PI * 2);
      ctx.fill();

      // 球体
      const body = ctx.createRadialGradient(n.px - r * 0.32, n.py - r * 0.36, r * 0.15, n.px, n.py, r);
      body.addColorStop(0, 'rgba(255,255,255,.92)');
      body.addColorStop(0.32, base);
      body.addColorStop(1, 'rgba(10,16,30,.92)');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(n.px, n.py, r, 0, Math.PI * 2);
      ctx.fill();

      // 描边
      ctx.lineWidth = (isSel ? 2.6 : (isHover ? 2 : 1.1)) * Math.max(0.6, n.ps);
      ctx.strokeStyle = isSel ? '#ffd35c' : (isHover ? '#ffffff' : 'rgba(150,200,255,.5)');
      ctx.beginPath();
      ctx.arc(n.px, n.py, r, 0, Math.PI * 2);
      ctx.stroke();

      // 内部胜率环
      ctx.lineWidth = 2.4 * Math.max(0.6, n.ps);
      ctx.strokeStyle = U.rateColor(n.rate, (dim ? 0.2 : 0.95) * fog);
      ctx.beginPath();
      ctx.arc(n.px, n.py, Math.max(1, r - 3.5 * n.ps), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * U.clamp(n.rate, 0, 1));
      ctx.stroke();

      ctx.globalAlpha = 1;
    }
  };

  Graph.prototype._drawLabels = function (ctx, focus) {
    const placed = [];
    const k = this.view.k;
    const font = 12;
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + font + 'px "Segoe UI","Microsoft YaHei",sans-serif';

    // 重要的先画：选中 > 悬停 > 出场多；3D 下近的先画（远的被遮挡时自然让位）
    const order = this.nodes.slice().sort(function (a, b) {
      const pa = (this.selection && this.selection.id === a.id) || (this.hoverNode && this.hoverNode.id === a.id) ? 1 : 0;
      const pb = (this.selection && this.selection.id === b.id) || (this.hoverNode && this.hoverNode.id === b.id) ? 1 : 0;
      if (pb !== pa) return pb - pa;
      if (this.threeD) return a.depth - b.depth;
      return b.n - a.n;
    }.bind(this));

    const visR = this.w - 4;

    for (let i = 0; i < order.length; i++) {
      const n = order[i];
      const isKey = (this.selection && this.selection.id === n.id) || (this.hoverNode && this.hoverNode.id === n.id);
      const inFocus = !focus || focus.mode !== 'node' || focus.nodes.has(n.id);
      const rr = n.r * n.ps;
      const important = rr > 15 || isKey;
      if (!important && k < 0.85) continue;
      if (!inFocus && !isKey) continue;

      const sig = (n.data && n.data.troopSig) ? n.data.troopSig : '';
      const text = n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label;
      const tw = ctx.measureText(text).width;
      const sigW = sig ? ctx.measureText(sig).width + 7 : 0;
      let rx = n.px + rr + 7;
      if (rx + tw + sigW + 8 > visR) rx = n.px - rr - 7 - tw - sigW;      // 右侧放不下就翻到左侧
      if (rx < 4) rx = 4;
      const ry = n.py - 9;
      const box = { x: rx - 5, y: ry - 3, w: tw + sigW + 11, h: 20 };

      let overlap = false;
      for (let j = 0; j < placed.length; j++) {
        const p = placed[j];
        if (box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) { overlap = true; break; }
      }
      if (overlap && !isKey) continue;
      placed.push(box);

      const fog = this.threeD ? n.fog : 1;
      ctx.globalAlpha = (isKey ? 1 : (inFocus ? 0.9 : 0.25)) * fog;
      ctx.fillStyle = 'rgba(8,12,24,.72)';
      U.roundRect(ctx, box.x, box.y, box.w, box.h, 5);
      ctx.fill();
      ctx.fillStyle = isKey ? '#ffffff' : '#d5e3f7';
      ctx.fillText(text, rx + 1, ry + 9);
      // 兵种：紧跟在阵容名后面，按兵种配色（canvas 里用彩色文字代替 HTML 徽章）
      if (sig) {
        let bx = rx + tw + 7;
        for (let t = 0; t < sig.length; t++) {
          const ch = sig.charAt(t);
          ctx.fillStyle = U.troopColor(ch);
          ctx.fillText(ch, bx, ry + 9);
          bx += ctx.measureText(ch).width + 0.5;
        }
      }
      ctx.globalAlpha = 1;
    }
  };

  AC.Graph = Graph;
})(window.AC);
