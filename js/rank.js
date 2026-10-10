window.AC = window.AC || {};

/* ============================================================
   强度排行：按「净压制力」排序的阵容列表
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;

  function Rank(host, callbacks) {
    this.host = host;
    this.cb = callbacks || {};
  }

  Rank.prototype.render = function (result, opts) {
    const host = this.host;
    const self = this;
    host.innerHTML = '';

    const nodes = result.nodeList.slice();
    if (!nodes.length) {
      host.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '40px 0' } }, [
        U.el('h3', { text: '没有符合条件的数据' }),
        U.el('p', { text: '试试调低「最少出场次数」或更换分析维度。' })
      ]));
      return;
    }

    const byPower = nodes.slice().sort(function (a, b) { return b.netPower - a.netPower; });
    const maxAbs = Math.max.apply(null, nodes.map(function (n) { return Math.abs(n.netPower); })) || 1;

    const head = U.el('div', { class: 'rank-row', style: { animation: 'none', opacity: 1, transform: 'none', background: 'transparent', border: 'none', cursor: 'default', fontWeight: '600', color: '#8fa3c4', fontSize: '11.5px' } }, [
      U.el('div', { class: 'rank-idx', text: '#' }),
      U.el('div', { class: 'rank-name', text: '阵容（按净压制力排序）' }),
      U.el('div', { class: 'rank-val', text: '出场 / 胜率' }),
      U.el('div', { text: '压制力' }),
      U.el('div', { class: 'rank-val', text: '均红度' }),
      U.el('div', { class: 'rank-val', text: '平均战损' }),
      U.el('div', { class: 'rank-val', text: '战损比' })
    ]);
    host.appendChild(head);

    byPower.forEach(function (nd, i) {
      const pct = Math.max(0, nd.netPower) / maxAbs;
      const negPct = Math.max(0, -nd.netPower) / maxAbs;
      const barColor = nd.netPower >= 0 ? 'linear-gradient(90deg,#ff7a5c,#ff3d6e)' : 'linear-gradient(90deg,#3ad2ff,#2f7fe0)';

      const row = U.el('div', { class: 'rank-row', style: { animationDelay: Math.min(360, i * 26) + 'ms' } }, [
        U.el('div', { class: 'rank-idx', text: String(i + 1) }),
        U.el('div', { class: 'rank-name', title: nd.display }, [
          U.compWithTroop(nd.display, nd.troopSig),
          nd.mainFormation ? U.el('span', { class: 'tag', style: { marginLeft: '6px', fontSize: '10px', color: '#8fa3c4' }, text: nd.mainFormation }) : null
        ]),
        U.el('div', { class: 'rank-val', text: nd.n + ' 场 · ' + U.fmtPct(nd.rate, 0) }),
        U.el('div', { class: 'rank-bar' }, [
          U.el('i', {
            style: {
              left: nd.netPower >= 0 ? '50%' : (50 - negPct * 50) + '%',
              width: (nd.netPower >= 0 ? pct * 50 : negPct * 50) + '%',
              background: barColor
            }
          }),
          U.el('i', { style: { left: '50%', width: '1px', background: '#3a4a6b' } })
        ]),
        U.el('div', { class: 'rank-val', text: nd.redAvg === null || nd.redAvg === undefined ? '-' : nd.redAvg.toFixed(2) }),
        U.el('div', { class: 'rank-val', text: U.fmtShort(nd.avgCostOut) }),
        U.el('div', { class: 'rank-val', text: nd.exchange === null ? '-' : nd.exchange.toFixed(2) })
      ]);

      row.addEventListener('click', function () {
        if (self.cb.onSelect) self.cb.onSelect({ type: 'node', id: nd.key });
      });

      host.appendChild(row);
    });
  };

  AC.Rank = Rank;
})(window.AC);
