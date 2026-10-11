window.AC = window.AC || {};

/* ============================================================
   原始战报浏览（分页表格）
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;
  const PAGE_SIZE = 50;

  function Table(tableEl, pagerEl, callbacks) {
    this.tableEl = tableEl;
    this.pagerEl = pagerEl;
    this.cb = callbacks || {};
    this.page = 1;
    this.rows = [];
    this._buildHead();
  }

  const COLUMNS = [
    { key: 'time', title: '时间', fmt: function (b) { return b.time ? b.time.replace('T', ' ').slice(5) : '-'; } },
    { key: 'place', title: '地点', fmt: function (b) { return b.place || '-'; } },
    { key: 'result', title: '结果', fmt: function (b) {
        const cls = b.result === 'atk' ? 'tag-win' : b.result === 'def' ? 'tag-lose' : 'tag-draw';
        const txt = b.result === 'atk' ? '攻方胜' : b.result === 'def' ? '守方胜' : '平局';
        return '<span class="tag ' + cls + '">' + txt + '</span>';
      }, html: true },
    { key: 'atk', title: '攻方同盟 / 玩家', fmt: function (b) { return (b.atk.alliance || '-') + ' · ' + (b.atk.player || '-'); } },
    { key: 'atkF', title: '攻方阵型', fmt: function (b) { return b.atk.formation || '-'; } },
    { key: 'atkC', title: '攻方阵容（兵种）', fmt: function (b) { return withTroop(b.atk); } },
    { key: 'atkL', title: '等级', fmt: function (b) { return b.atk.levels.length ? b.atk.levels.join('/') : '-'; } },
    { key: 'atkF2', title: '攻方兵力(开→余)', fmt: function (b) { return forceText(b.atk); } },
    { key: 'atkRD', title: '攻方红度/品级', fmt: function (b) { return redPin(b.atk); } },
    { key: 'atkCost', title: '攻方伤/亡', fmt: function (b) { return U.fmtInt(b.atk.wounded) + ' / ' + U.fmtInt(b.atk.dead); } },
    { key: 'def', title: '守方同盟 / 玩家', fmt: function (b) { return (b.def.alliance || '-') + ' · ' + (b.def.player || '-'); } },
    { key: 'defF', title: '守方阵型', fmt: function (b) { return b.def.formation || '-'; } },
    { key: 'defC', title: '守方阵容（兵种）', fmt: function (b) { return withTroop(b.def); } },
    { key: 'defL', title: '等级', fmt: function (b) { return b.def.levels.length ? b.def.levels.join('/') : '-'; } },
    { key: 'defF2', title: '守方兵力(开→余)', fmt: function (b) { return forceText(b.def); } },
    { key: 'defRD', title: '守方红度/品级', fmt: function (b) { return redPin(b.def); } },
    { key: 'defCost', title: '守方伤/亡', fmt: function (b) { return U.fmtInt(b.def.wounded) + ' / ' + U.fmtInt(b.def.dead); } },
    { key: 'round', title: '回合', fmt: function (b) { return b.round === null ? '-' : b.round; } }
  ];

  /** 兵力文本：开战 → 剩余 */
  function forceText(side) {
    if (!side.origin) return '-';
    return U.fmtInt(side.origin) + ' → ' + U.fmtInt(side.remain || 0);
  }

  /** 阵容 + 兵种（战报表格里用括号形式，紧凑） */
  function withTroop(side) {
    const name = side.compRaw || '-';
    return side.troopSig ? name + '（' + side.troopSig + '）' : name;
  }

  /** 该部队的红度 / 品级（逐武将，如 1·1·0） */
  function redPin(side) {
    const red = side.redDist && side.redDist.length ? side.redDist.join('·') : '';
    const pin = side.pinDist && side.pinDist.length ? side.pinDist.join('·') : '';
    if (!red && !pin) return '-';
    return (red || '-') + ' / ' + (pin || '-');
  }

  Table.prototype._buildHead = function () {
    const thead = this.tableEl.querySelector('thead');
    const tr = U.el('tr', null, COLUMNS.map(function (c) { return U.el('th', { text: c.title }); }));
    thead.innerHTML = '';
    thead.appendChild(tr);
  };

  Table.prototype.setData = function (battles) {
    this.rows = battles.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    this.page = 1;
    this.render();
  };

  Table.prototype.render = function () {
    const tbody = this.tableEl.querySelector('tbody');
    tbody.innerHTML = '';
    const total = this.rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (this.page > pages) this.page = pages;
    const start = (this.page - 1) * PAGE_SIZE;
    const slice = this.rows.slice(start, start + PAGE_SIZE);

    const frag = document.createDocumentFragment();
    slice.forEach(function (b) {
      const tr = U.el('tr', null, COLUMNS.map(function (c) {
        if (c.html) return U.el('td', { html: c.fmt(b) });
        return U.el('td', { text: c.fmt(b) });
      }));
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    // 分页器
    const pager = this.pagerEl;
    pager.innerHTML = '';
    const mkBtn = function (label, page, disabled) {
      const btn = U.el('button', { class: 'btn btn-ghost btn-sm', text: label });
      if (disabled) btn.disabled = true;
      else btn.addEventListener('click', function () { this.page = page; this.render(); }.bind(this));
      return btn;
    }.bind(this);

    pager.appendChild(U.el('span', { text: '共 ' + total + ' 条 · 第 ' + this.page + '/' + pages + ' 页' }));
    pager.appendChild(mkBtn('首页', 1, this.page === 1));
    pager.appendChild(mkBtn('上一页', this.page - 1, this.page === 1));
    pager.appendChild(mkBtn('下一页', this.page + 1, this.page === pages));
    pager.appendChild(mkBtn('末页', pages, this.page === pages));
  };

  AC.Table = Table;
})(window.AC);
