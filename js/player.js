/* ============================================================
   玩家分析
   ------------------------------------------------------------
   同盟分析看的是整体，玩家分析看的是「具体某个人」：
     · 他常用的队伍有哪些，每套队伍的具体武将、红度、品级是什么水平；
     · 要克制他，该用哪些阵容（复用同盟那套反制算法，只是把口径换成这个玩家）。
   ============================================================ */
window.AC = window.AC || {};

(function (AC) {
  'use strict';

  const U = AC.util;

  function num(v) { return (v === null || v === undefined || v === '' || isNaN(v)) ? null : Number(v); }

  /** 一堆武将的均值（忽略空值） */
  function avg(heroes, field) {
    const vals = heroes.map(function (h) { return num(h[field]); })
      .filter(function (v) { return v !== null; });
    return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
  }

  /** 每个阵容里「每名武将」的配置快照：取该阵容出现次数最多的那一套 */
  function heroSnapshots(battles) {
    const byHero = new Map();
    battles.forEach(function (b) {
      (b.heroes || []).forEach(function (h) {
        if (!h.name) return;
        let o = byHero.get(h.name);
        if (!o) {
          o = { name: h.name, troop: h.troop || '', n: 0, red: [], pin: [], level: [], equip: new Map(), horse: new Map() };
          byHero.set(h.name, o);
        }
        o.n++;
        if (num(h.red) !== null) o.red.push(num(h.red));
        if (num(h.pin) !== null) o.pin.push(num(h.pin));
        if (num(h.level) !== null) o.level.push(num(h.level));
        if (h.equip) o.equip.set(h.equip, (o.equip.get(h.equip) || 0) + 1);
        if (h.horse) o.horse.set(h.horse, (o.horse.get(h.horse) || 0) + 1);
      });
    });
    const mean = function (arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; };
    const top = function (map) {
      let best = '', bestN = -1;
      map.forEach(function (v, k) { if (v > bestN) { bestN = v; best = k; } });
      return best;
    };
    return Array.from(byHero.values()).map(function (o) {
      return {
        name: o.name, troop: o.troop, n: o.n,
        red: mean(o.red), pin: mean(o.pin), level: mean(o.level),
        redMax: o.red.length ? Math.max.apply(null, o.red) : null,
        pinMax: o.pin.length ? Math.max.apply(null, o.pin) : null,
        equip: top(o.equip), horse: top(o.horse)
      };
    }).sort(function (a, b) { return b.n - a.n; });
  }

  /* 活跃时段：按战斗发生的小时归到四个时段。
     小时的来源是战斗时间戳（battle.t），战报里每场都带。 */
  const HOUR_BANDS = [
    { key: 'night', label: '深夜 0~6', lo: 0, hi: 6 },
    { key: 'morning', label: '上午 6~12', lo: 6, hi: 12 },
    { key: 'afternoon', label: '下午 12~18', lo: 12, hi: 18 },
    { key: 'evening', label: '晚上 18~24', lo: 18, hi: 24 }
  ];

  function hourBandOf(t) {
    if (t === null || t === undefined) return null;
    const d = new Date(t);
    if (isNaN(d.getTime())) return null;
    const h = d.getHours();
    return HOUR_BANDS.filter(function (b) { return h >= b.lo && h < b.hi; })[0] || null;
  }

  /** 玩家 -> 他常用队伍（含逐武将红度） */
  function build(result) {
    const map = new Map();

    result.battles.forEach(function (b) {
      [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
        const role = pair[0], side = pair[1];
        const name = side.player;
        if (!name) return;
        let p = map.get(name);
        if (!p) {
          p = {
            name: name, n: 0, wins: 0, draws: 0,
            alliances: new Map(), compMap: new Map(),
            redSum: 0, redN: 0,
            hourMap: new Map()   // 时段 -> 场次
          };
          map.set(name, p);
        }
        p.n++;
        if (b.result === role) p.wins++;
        else if (b.result === 'draw') p.draws++;
        if (side.alliance) p.alliances.set(side.alliance, (p.alliances.get(side.alliance) || 0) + 1);
        const band = hourBandOf(b.ts);
        if (band) p.hourMap.set(band.key, (p.hourMap.get(band.key) || 0) + 1);

        const key = side.key;
        let c = p.compMap.get(key);
        if (!c) {
          c = {
            key: key, display: side.display || side.compRaw || key, troopSig: side.troopSig || '',
            n: 0, wins: 0, draws: 0, battles: []
          };
          p.compMap.set(key, c);
        }
        c.n++;
        if (b.result === role) c.wins++;
        else if (b.result === 'draw') c.draws++;
        c.battles.push(side);
      });
    });

    const players = Array.from(map.values()).map(function (p) {
      const compList = Array.from(p.compMap.values())
        .sort(function (a, b) { return b.n - a.n; })
        .map(function (c) {
          return {
            key: c.key,
            display: c.display,
            troopSig: c.troopSig,
            n: c.n,
            winLo: c.wins,
            draw: c.draws,
            rate: c.n ? (c.wins + c.draws * 0.5) / c.n : 0.5,
            heroes: heroSnapshots(c.battles)
          };
        });
      // 玩家整体红度（用于列表排序与概览）
      let redSum = 0, redN = 0;
      compList.forEach(function (c) {
        c.heroes.forEach(function (h) { if (h.red !== null) { redSum += h.red; redN++; } });
      });
      return {
        name: p.name,
        n: p.n,
        wins: p.wins,
        draws: p.draws,
        rate: p.n ? (p.wins + p.draws * 0.5) / p.n : 0.5,
        alliance: (function () {
          let best = '', bestN = -1;
          p.alliances.forEach(function (v, k) { if (v > bestN) { bestN = v; best = k; } });
          return best;
        })(),
        avgRed: redN ? redSum / redN : null,
        // 活跃时段：找出场次最多的一档，并保留各档分布
        hours: HOUR_BANDS.map(function (b) {
          return { key: b.key, label: b.label, n: p.hourMap.get(b.key) || 0 };
        }),
        peakHour: (function () {
          let best = null, bestN = 0;
          p.hourMap.forEach(function (v, k) {
            if (v > bestN) { bestN = v; best = k; }
          });
          const b = HOUR_BANDS.filter(function (x) { return x.key === best; })[0];
          return b ? b.label : null;
        })(),
        compList: compList
      };
    }).sort(function (a, b) { return b.n - a.n; });

    return { players: players };
  }

  /* ---------------- 渲染 ---------------- */

  function section(title, note) {
    return U.el('div', { class: 'ally-section' }, [
      U.el('h3', {}, [
        U.el('span', { text: title }),
        note ? U.el('span', { class: 'ally-note', text: note }) : null
      ])
    ]);
  }

  function metric(k, v, sub) {
    return U.el('div', { class: 'insp-cell' }, [
      U.el('div', { class: 'k', text: k }),
      U.el('div', { class: 'v', text: String(v) }),
      sub ? U.el('div', { class: 'k', style: { marginTop: '2px' }, text: sub }) : null
    ]);
  }

  /** 红度小圆点：红 0~5 */
  function redDots(v) {
    const wrap = U.el('span', { class: 'red-dots' });
    const full = Math.round(v === null ? 0 : v);
    for (let i = 0; i < 5; i++) {
      wrap.appendChild(U.el('i', { class: 'red-dot' + (i < full ? ' on' : '') }));
    }
    return wrap;
  }

  /** 一个阵容的武将红度表 */
  function compCard(c) {
    const box = U.el('div', { class: 'pc-box' });
    box.appendChild(U.el('div', { class: 'pc-head' }, [
      U.el('div', { class: 'pc-name' }, [U.compWithTroop(c.display, c.troopSig)]),
      U.el('div', { class: 'pc-meta' }, [
        U.el('span', { text: c.n + ' 场' }),
        U.el('span', { style: { color: U.rateColor(c.rate) }, text: '胜率 ' + U.fmtPct(c.rate, 0) })
      ])
    ]));

    const head = U.el('div', { class: 'pc-row pc-row-h' }, [
      U.el('div', { text: '武将' }),
      U.el('div', { text: '红度' }),
      U.el('div', { text: '品级' }),
      U.el('div', { text: '等级' }),
      U.el('div', { text: '装备 / 战马' })
    ]);
    box.appendChild(head);

    c.heroes.forEach(function (h) {
      box.appendChild(U.el('div', { class: 'pc-row' }, [
        U.el('div', { class: 'pc-hn' }, [
          U.el('span', { text: h.name }),
          h.troop ? U.troopBadges(h.troop) : null
        ]),
        U.el('div', { class: 'pc-red' }, [
          redDots(h.red),
          U.el('span', { class: 'pc-red-n', text: h.red === null ? '-' : h.red.toFixed(1) })
        ]),
        U.el('div', { class: 'pc-pin', text: h.pin === null ? '-' : h.pin.toFixed(1) }),
        U.el('div', { class: 'pc-lv', text: h.level === null ? '-' : Math.round(h.level) }),
        U.el('div', { class: 'pc-eq', title: h.equip + ' / ' + h.horse, text: (h.equip || '-') + ' / ' + (h.horse || '-') })
      ]));
    });

    // 该阵容的红度均值
    const rAvg = (function () {
      const vals = c.heroes.map(function (h) { return h.red; }).filter(function (v) { return v !== null; });
      return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
    })();
    const pAvg = (function () {
      const vals = c.heroes.map(function (h) { return h.pin; }).filter(function (v) { return v !== null; });
      return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
    })();
    box.appendChild(U.el('div', { class: 'pc-row pc-row-sum' }, [
      U.el('div', { class: 'pc-hn', text: '平均' }),
      U.el('div', { class: 'pc-red', text: rAvg === null ? '-' : rAvg.toFixed(1) }),
      U.el('div', { class: 'pc-pin', text: pAvg === null ? '-' : pAvg.toFixed(1) }),
      U.el('div', { class: 'pc-lv', text: '' }),
      U.el('div', { class: 'pc-eq', text: '' })
    ]));
    return box;
  }

  function PlayerView(listHost, detailHost, callbacks) {
    this.listHost = listHost;
    this.detailHost = detailHost;
    this.cb = callbacks || {};
    this.data = null;
    this.selected = null;
    // 筛选条件：同盟 / 红度 / 活跃度 / 活跃时段 / 关键词
    this.filter = { alliance: 'all', red: 'all', active: 'all', hour: 'all', kw: '' };
  }

  /** 红度分档 */
  function redTier(v) {
    if (v === null || v === undefined) return 'unknown';
    if (v < 1.5) return 'low';
    if (v < 2.5) return 'mid';
    return 'high';
  }

  /** 活跃度分档（按有效出场次数） */
  function activeTier(n) {
    if (n >= 30) return 'high';
    if (n >= 10) return 'mid';
    return 'low';
  }

  /** 应用筛选 */
  PlayerView.prototype.applyFilter = function () {
    const f = this.filter;
    return this.data.players.filter(function (p) {
      if (f.alliance !== 'all') {
        if (f.alliance === '(无同盟)') { if (p.alliance) return false; }
        else if (p.alliance !== f.alliance) return false;
      }
      if (f.red !== 'all' && redTier(p.avgRed) !== f.red) return false;
      if (f.active !== 'all' && activeTier(p.n) !== f.active) return false;
      if (f.hour !== 'all' && p.peakHour !== f.hour) return false;
      if (f.kw) {
        const kw = f.kw.toLowerCase();
        const hit = p.name.toLowerCase().indexOf(kw) >= 0 ||
          (p.alliance || '').toLowerCase().indexOf(kw) >= 0 ||
          p.compList.some(function (c) { return (c.display || '').toLowerCase().indexOf(kw) >= 0; });
        if (!hit) return false;
      }
      return true;
    });
  };

  PlayerView.prototype.render = function (result) {
    this.result = result;
    if (!result || !result.battles || !result.battles.length) {
      this.listHost.innerHTML = '';
      this.detailHost.innerHTML = '';
      this.detailHost.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '60px 0' } }, [
        U.el('h3', { text: '还没有可分析的玩家数据' }),
        U.el('p', { text: '先导入战报，或在筛选条件里放宽限制（当前过滤结果为空时这一页也会是空的）。' })
      ]));
      return;
    }
    this.data = build(result);
    if (!this.data.players.length) {
      this.listHost.innerHTML = '';
      this.detailHost.innerHTML = '';
      this.detailHost.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '60px 0' } }, [
        U.el('h3', { text: '当前数据里没有玩家信息' }),
        U.el('p', { text: '这一页需要武将级明细表（含「玩家」列）。导入这种表后即可看到每个玩家的队伍与武将红度。' })
      ]));
      return;
    }
    const keep = this.selected && this.data.players.some(function (p) { return p.name === this.selected; }, this);
    this.renderList();
    this.select(keep ? this.selected : this.data.players[0].name);
  };

  /** 只更新计数与列表项，不重建筛选栏（避免输入框失焦） */
  PlayerView.prototype.refreshList = function () {
    const list = this.applyFilter();
    const c = this.listHost.querySelector('.pf-count span');
    if (c) c.textContent = '匹配 ' + list.length + ' / ' + this.data.players.length + ' 个玩家';
    Array.prototype.slice.call(this.listHost.querySelectorAll('.ally-item, .hint')).forEach(function (n) { n.remove(); });
    if (!list.length) {
      this.listHost.appendChild(U.el('div', { class: 'hint', style: { padding: '12px 4px' }, text: '没有符合筛选条件的玩家。' }));
      return;
    }
    this.renderItems(list);
  };

  /** 顶部筛选栏 */
  PlayerView.prototype.renderFilters = function () {
    const self = this;
    const host = this.listHost;
    Array.prototype.slice.call(host.querySelectorAll('.pf-bar')).forEach(function (n) { n.remove(); });

    const alliances = Array.from(new Set(this.data.players.map(function (p) { return p.alliance; }).filter(Boolean))).sort();
    const hourOptions = AC.playerAnalysis.HOUR_BANDS.map(function (b) { return b.label; });

    function select(label, key, options, current) {
      const wrap = U.el('label', { class: 'pf-item' }, [U.el('span', { class: 'pf-label', text: label })]);
      const sel = U.el('select', { class: 'pf-select' });
      options.forEach(function (o) {
        const opt = U.el('option', { value: o.v, text: o.t });
        if (o.v === current) opt.setAttribute('selected', 'selected');
        sel.appendChild(opt);
      });
      sel.value = current;
      sel.addEventListener('change', function () {
        self.filter[key] = sel.value;
        const list = self.applyFilter();
        if (self.selected && !list.some(function (p) { return p.name === self.selected; })) self.selected = null;
        self.refreshList();
        if (!self.selected && list.length) self.select(list[0].name);
      });
      wrap.appendChild(sel);
      return wrap;
    }

    const bar = U.el('div', { class: 'pf-bar' });
    bar.appendChild(select('同盟', 'alliance',
      [{ v: 'all', t: '全部' }].concat(alliances.map(function (a) { return { v: a, t: a }; })), this.filter.alliance));
    bar.appendChild(select('红度', 'red', [
      { v: 'all', t: '全部' }, { v: 'low', t: '低（<1.5）' },
      { v: 'mid', t: '中（1.5~2.5）' }, { v: 'high', t: '高（≥2.5）' }
    ], this.filter.red));
    bar.appendChild(select('活跃度', 'active', [
      { v: 'all', t: '全部' }, { v: 'high', t: '高（≥30 场）' },
      { v: 'mid', t: '中（10~29 场）' }, { v: 'low', t: '低（<10 场）' }
    ], this.filter.active));
    bar.appendChild(select('活跃时段', 'hour',
      [{ v: 'all', t: '全部' }].concat(hourOptions.map(function (h) { return { v: h, t: h }; })), this.filter.hour));

    const kw = U.el('input', { class: 'pf-input', type: 'text', placeholder: '玩家 / 同盟 / 阵容' });
    kw.value = this.filter.kw;
    kw.addEventListener('input', function () {
      self.filter.kw = kw.value.trim();
      self.refreshList();
    });
    bar.appendChild(U.el('label', { class: 'pf-item pf-item-kw' }, [
      U.el('span', { class: 'pf-label', text: '搜索' }), kw
    ]));
    bar.appendChild(U.el('div', { class: 'pf-count' }, [
      U.el('span', { text: '匹配 ' + this.applyFilter().length + ' / ' + this.data.players.length + ' 个玩家' })
    ]));

    host.insertBefore(bar, host.firstChild);
  };

  PlayerView.prototype.renderList = function () {
    const self = this;
    this.listHost.innerHTML = '';
    this.renderFilters();
    this.renderItems(this.applyFilter());
  };

  PlayerView.prototype.renderItems = function (list) {
    const self = this;
    if (!list.length) {
      this.listHost.appendChild(U.el('div', { class: 'hint', style: { padding: '12px 4px' }, text: '没有符合筛选条件的玩家。' }));
      return;
    }
    list.forEach(function (p) {
      const item = U.el('div', { class: 'ally-item', 'data-name': p.name }, [
        U.el('div', { class: 'ai-top' }, [
          U.el('div', { class: 'ai-name', title: p.name, text: p.name }),
          U.el('div', { class: 'ai-rate', text: p.n + ' 场' })
        ]),
        U.el('div', { class: 'ai-meta' }, [
          U.el('span', { text: '胜率 ' + U.fmtPct(p.rate, 0) }),
          U.el('span', { text: p.compList.length + ' 套队伍' }),
          p.avgRed === null ? null : U.el('span', { text: '均红 ' + p.avgRed.toFixed(1) })
        ])
      ]);
      item.addEventListener('click', function () { self.select(p.name); });
      self.listHost.appendChild(item);
    });
  };

  PlayerView.prototype.select = function (name) {
    this.selected = name;
    Array.prototype.forEach.call(this.listHost.children, function (node) {
      node.classList.toggle('active', node.dataset.name === name);
    });
    const p = this.data.players.filter(function (x) { return x.name === name; })[0];
    if (p) this.renderDetail(p);
  };

  PlayerView.prototype.renderDetail = function (p) {
    const host = this.detailHost;
    host.innerHTML = '';

    host.appendChild(U.el('div', { class: 'ally-head' }, [
      U.el('h2', { text: p.name }),
      U.el('div', { class: 'ally-head-meta', text:
        (p.alliance ? '同盟 ' + p.alliance + ' · ' : '') + p.n + ' 场有效对局 · ' + p.compList.length + ' 套常用队伍' })
    ]));

    host.appendChild(U.el('div', { class: 'ally-metrics' }, [
      metric('出场', p.n + ' 场'),
      metric('胜率', U.fmtPct(p.rate), p.wins + ' 胜 / ' + p.draws + ' 平'),
      metric('队伍数', p.compList.length + ' 套', '按出场次数排序'),
      metric('平均红度', p.avgRed === null ? '-' : p.avgRed.toFixed(1), '该玩家全部武将')
    ]));

    /* ---- 各队伍的武将红度 ---- */
    const s1 = section('各队伍的武将红度', '每套队伍里具体是哪几名武将、红度 / 品级 / 等级 / 装备战马各是什么水平');
    p.compList.slice(0, 8).forEach(function (c) { s1.appendChild(compCard(c)); });
    if (p.compList.length > 8) {
      s1.appendChild(U.el('p', { class: 'hint', text: '（只列出前 8 套，共 ' + p.compList.length + ' 套）' }));
    }
    host.appendChild(s1);

    /* ---- 如何克制 ---- */
    const s2 = section('如何克制他', '按他各队伍的出场频率加权，算出哪些阵容打他最有效；并提醒要小心他的哪些队伍');
    const ally = { name: p.name, n: p.n, compList: p.compList };
    const advice = AC.allianceAnalysis.counterAdvice(this.result, ally, {});
    if (!advice.length) {
      s2.appendChild(U.el('div', { class: 'hint', text: '交手样本不足，暂时给不出克制建议（可以多导入几批战报）。' }));
    } else {
      advice.slice(0, 6).forEach(function (a, i) {
        const box = U.el('div', { class: 'adv-item' });
        box.appendChild(U.el('div', { class: 'adv-head' }, [
          U.el('span', { class: 'adv-rank', text: '#' + (i + 1) }),
          U.el('span', { class: 'adv-comp' }, [U.compWithTroop(a.display, a.troopSig)]),
          U.el('span', { class: 'adv-rate', style: { color: U.rateColor(a.expRate) }, text: '期望胜率 ' + U.fmtPct(a.expRate, 0) }),
          U.el('span', { class: 'adv-cov', text: '覆盖 ' + U.fmtPct(a.coverage, 0) })
        ]));
        if (a.reason) box.appendChild(U.el('div', { class: 'adv-reason', text: a.reason }));
        if (a.risks && a.risks.length) {
          box.appendChild(U.el('div', { class: 'adv-risks' }, [
            U.el('span', { class: 'adv-risks-t', text: '要小心：' }),
            U.el('span', { text: a.risks.map(function (r) { return r.comp + '（占其 ' + U.fmtPct(r.share, 0) + '，他只赢 ' + U.fmtPct(1 - r.rate, 0) + '）'; }).join('、') })
          ]));
        }
        s2.appendChild(box);
      });
    }
    host.appendChild(s2);
  };

  AC.PlayerView = PlayerView;
  AC.playerAnalysis = { build: build, heroSnapshots: heroSnapshots, HOUR_BANDS: HOUR_BANDS, hourBandOf: hourBandOf };
})(window.AC);
