window.AC = window.AC || {};

/* ============================================================
   强度排行：按「综合强度分」排序的阵容列表
   强度分 = 打击面 + 胜率 + 连胜 + 战损 + 劣势 五项加权（0~100）
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;

  // 分项定义：键、名称、权重、悬浮说明
  const PARTS = [
    { key: 'sSpan', label: '打击面', w: 32, tip: '打赢过多少支不同队伍（赢面 > 50% 且交手 ≥ 3 场才算赢过）' },
    { key: 'sWin', label: '胜率', w: 26, tip: '公平胜率：只认势均力敌与以少打多的场次，堆兵刷的不算' },
    { key: 'sStreak', label: '连胜', w: 15, tip: '这套阵容打出的最高连赢：一次出战用剩余兵力接着打，连赢几场（只按当前筛选后的场次统计）' },
    { key: 'sLoss', label: '战损', w: 12, tip: '赢的时候省不省兵：我方掉兵 / 双方掉兵，越小越省' },
    { key: 'sDis', label: '劣势', w: 12, tip: '兵力比对方少时还能赢——以少打多能力' }
  ];

  function Rank(host, callbacks) {
    this.host = host;
    this.cb = callbacks || {};
  }

  /** 综合强度分（0~100）：analyzer 统一口径 */
  function scoreOf(nd) {
    return AC.analyzer && AC.analyzer.strengthOf ? AC.analyzer.strengthOf(nd) : 0;
  }

  function partTip(nd) {
    const p = [];
    p.push('综合强度分 ' + scoreOf(nd).toFixed(1) + '（满分 100，共 ' + nd.n + ' 场）');
    PARTS.forEach(function (d) {
      p.push(d.label + ' ' + (nd[d.key] || 0).toFixed(0) + ' 分（权重 ' + d.w + '%）：' + d.tip);
    });
    return p.join('\n');
  }
  AC.rankPartTip = partTip;

  Rank.prototype.render = function (result) {
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

    const byScore = nodes.slice().sort(function (a, b) { return scoreOf(b) - scoreOf(a); });

    const head = U.el('div', { class: 'rank-row', style: { animation: 'none', opacity: 1, transform: 'none', background: 'transparent', border: 'none', cursor: 'default', fontWeight: '600', color: '#8fa3c4', fontSize: '11.5px' } }, [
      U.el('div', { class: 'rank-idx', text: '#' }),
      U.el('div', { class: 'rank-name', text: '阵容（综合强度分 = 打击面 + 胜率 + 连胜 + 战损 + 劣势）' }),
      U.el('div', { class: 'rank-val', text: '出场 / 胜率' }),
      U.el('div', { class: 'rank-score', text: '强度分 / 五维' }),
      U.el('div', { class: 'rank-val', text: '赢过' }),
      U.el('div', { class: 'rank-val', text: '连胜' }),
      U.el('div', { class: 'rank-val', text: '战损' })
    ]);
    host.appendChild(head);

    byScore.forEach(function (nd, i) {
      const score = scoreOf(nd);
      // 综合分条：0~100 直接映射
      const barW = Math.max(0, Math.min(100, score));
      const barColor = score >= 65 ? 'linear-gradient(90deg,#ff7a5c,#ff3d6e)'
        : score >= 45 ? 'linear-gradient(90deg,#ffb347,#ff7a5c)'
          : 'linear-gradient(90deg,#3ad2ff,#2f7fe0)';

      const row = U.el('div', { class: 'rank-row', style: { animationDelay: Math.min(360, i * 26) + 'ms' } }, [
        U.el('div', { class: 'rank-idx', text: String(i + 1) }),
        U.el('div', { class: 'rank-name' }, [
          U.compWithTroop(nd.display, nd.troopSig),
          nd.mainFormation ? U.el('span', { class: 'tag', style: { marginLeft: '6px', fontSize: '10px', color: '#8fa3c4' }, text: nd.mainFormation }) : null,
          nd.n < 15 ? U.el('span', { class: 'tag', style: { marginLeft: '6px', fontSize: '10px', color: '#e9b26b' }, text: '样本少' }) : null
        ]),
        U.el('div', { class: 'rank-val' }, [
          U.el('span', { text: nd.n + ' 场 · ' + U.fmtPct(nd.rate, 0) }),
          nd.nFair > 0
            ? U.el('span', { class: 'rank-fair', style: { color: U.rateColor(nd.rateFair) }, text: '公平 ' + U.fmtPct(nd.rateFair, 0) })
            : U.el('span', { class: 'rank-fair off', text: '无公平样本' })
        ]),
        // 强度分 + 五个分项（紧凑条）
        U.el('div', { class: 'rank-score' }, [
          U.el('div', { class: 'rank-bar' }, [
            U.el('i', { style: { left: '0', width: barW + '%', background: barColor } })
          ]),
          U.el('div', { class: 'rank-parts' }, PARTS.map(function (d) {
            const v = Math.max(0, Math.min(100, nd[d.key] || 0));
            return U.el('span', { class: 'rp', title: d.label + ' ' + v.toFixed(0) + ' 分（权重 ' + d.w + '%）' }, [
              U.el('span', { class: 'rp-label', text: d.label }),
              U.el('span', { class: 'rp-bar' }, [
                U.el('i', { style: { width: v + '%', background: v >= 70 ? '#ff7a5c' : (v >= 45 ? '#ffb347' : '#3ad2ff') } })
              ]),
              U.el('span', { class: 'rp-num', text: v.toFixed(0) })
            ]);
          }))
        ]),
        U.el('div', { class: 'rank-val' }, [
          U.el('span', { text: (nd.beatKinds || 0) + '/' + (nd.oppTypes || 0) + ' 支' }),
          U.el('span', { class: 'rank-fair off', text: '有效 ' + (nd.effBeat === undefined ? '-' : nd.effBeat.toFixed(1)) })
        ]),
        U.el('div', { class: 'rank-val' }, [
          // 「最高 N 连」可直接点开这一段连赢的战报（不影响整行点击进详情）
          nd.streakBestRun && nd.streakBest >= 2
            ? U.el('span', {
              class: 'rank-streak-link', text: '最高 ' + (nd.streakBest || 0) + ' 连',
              title: '点击查看这段连赢的战报（' + nd.streakBestRun.player + '，' + (nd.streakBestRun.wuxun || 0) + ' 武勋）',
              onclick: function (ev) {
                ev.stopPropagation();
                if (self.cb.onStreakLog) self.cb.onStreakLog(nd, nd.streakBestRun);
              }
            })
            : U.el('span', { text: '最高 ' + (nd.streakBest || 0) + ' 连' }),
          // 武勋成色：几千几百 = 打残兵/低等级，光看连赢场数会被骗
          U.el('span', {
            class: 'rank-fair off',
            title: '连赢段的平均单场武勋（含金量）',
            text: nd.streakWuxunAvg > 0
              ? '成色 ' + Math.round(nd.streakWuxunAvg) + ' · 3 连以上 ' + (nd.streakStrong || 0) + ' 次'
              : '3 连以上 ' + (nd.streakStrong || 0) + ' 次'
          })
        ]),
        U.el('div', { class: 'rank-val' }, [
          U.el('span', { text: nd.fairLoss === null || nd.fairLoss === undefined ? '-' : (nd.fairLoss * 100).toFixed(0) + '%' }),
          U.el('span', { class: 'rank-fair off', text: nd.exchange === null ? '-' : '战损比 ' + nd.exchange.toFixed(2) })
        ])
      ]);

      row.__node = nd;      // 便于调试 / 自动化测试核对
      row.addEventListener('click', function () {
        if (self.cb.onSelect) self.cb.onSelect({ type: 'node', id: nd.key });
      });
      host.appendChild(row);
    });

    // 底部：强度分口径说明（玩家看完排行会问「这分怎么来的」）
    host.appendChild(U.el('div', { class: 'rank-note' }, [
      U.el('b', { text: '强度分怎么算：' }),
      U.el('span', { text: '打击面 32%（赢过多少支不同队伍）+ 胜率 26%（只认均势与以少打多）+ 连胜 18%（一次出战连赢几场）+ 战损 12%（赢时掉兵省不省）+ 劣势 12%（以少打多能不能赢），加权后 0~100 分；样本不足会往中间压，避免几场数据刷榜。' })
    ]));
  };

  AC.Rank = Rank;
})(window.AC);
