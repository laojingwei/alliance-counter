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

  /** 单个武将的跨场累计器 */
  function newHeroAgg(name, troop) {
    return {
      name: name, troopCounts: {}, n: 0,
      red: [], pin: [], level: [],
      equip: new Map(), horse: new Map(),
      last: null        // 最近一场的快照（按战斗时间），避免赛季中养成提升被历史低值拉平
    };
  }

  /** 把一支部队的武将并入累计器 */
  function aggHero(map, side, ts) {
    (side && side.heroes ? side.heroes : []).forEach(function (h) {
      if (!h || !h.name) return;
      let o = map.get(h.name);
      if (!o) { o = newHeroAgg(h.name, h.troop); map.set(h.name, o); }
      o.n++;
      if (h.troop) o.troopCounts[h.troop] = (o.troopCounts[h.troop] || 0) + 1;
      if (num(h.red) !== null) o.red.push(num(h.red));
      if (num(h.pin) !== null) o.pin.push(num(h.pin));
      if (num(h.level) !== null) o.level.push(num(h.level));
      if (h.equip) o.equip.set(h.equip, (o.equip.get(h.equip) || 0) + 1);
      if (h.horse) o.horse.set(h.horse, (o.horse.get(h.horse) || 0) + 1);
      if (ts && (!o.last || ts >= o.last.ts)) {
        o.last = {
          ts: ts, red: num(h.red), pin: num(h.pin), level: num(h.level),
          equip: h.equip || '', horse: h.horse || ''
        };
      }
    });
  }

  /** 累计器 -> 武将列表（按出场次数排序） */
  function flushHeroAgg(map) {
    const mean = function (arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; };
    const top = function (map) {
      let best = '', bestN = -1;
      map.forEach(function (v, k) { if (v > bestN) { bestN = v; best = k; } });
      return best;
    };
    return Array.from(map.values()).map(function (o) {
      // 兵种取众数：同一武将中途换兵种时，显示最常见的那个
      let troop = '', bestT = -1;
      for (const k in o.troopCounts) { if (o.troopCounts[k] > bestT) { bestT = o.troopCounts[k]; troop = k; } }
      return {
        name: o.name, troop: troop, n: o.n,
        red: mean(o.red), pin: mean(o.pin), level: mean(o.level),
        redMax: o.red.length ? Math.max.apply(null, o.red) : null,
        pinMax: o.pin.length ? Math.max.apply(null, o.pin) : null,
        last: o.last,
        equip: top(o.equip), horse: top(o.horse)
      };
    }).sort(function (a, b) { return b.n - a.n; });
  }

  /**
   * 一堆部队快照 -> 武将配置列表。
   * 口径：红度 / 品级 / 等级取全周期均值，另附 redMax / pinMax 与「最近一场」值；
   *      装备 / 战马取出现次数最多的那一套。
   * @param {Array} list [{ me: side, ts }]，也兼容直接传 side 数组
   */
  function heroSnapshots(list) {
    const map = new Map();
    (list || []).forEach(function (x) {
      const side = x && x.me ? x.me : x;
      aggHero(map, side, x && x.ts ? x.ts : 0);
    });
    return flushHeroAgg(map);
  }

  /* 活跃时段：按战斗发生的小时归到四个时段。
     小时的来源是战斗时间戳（battle.t），战报里每场都带。 */
  const HOUR_BANDS = [
    { key: 'night', label: '深夜 0~6', lo: 0, hi: 6 },
    { key: 'morning', label: '上午 6~12', lo: 6, hi: 12 },
    { key: 'afternoon', label: '下午 12~18', lo: 12, hi: 18 },
    { key: 'evening', label: '晚上 18~24', lo: 18, hi: 24 }
  ];

  /** 筛选「活跃时段」时，该时段至少要占玩家这么多比例的有效对局才算「活跃在该时段」 */
  const HOUR_SHARE = 0.3;

  function hourBandOf(t) {
    if (t === null || t === undefined) return null;
    const d = new Date(t);
    if (isNaN(d.getTime())) return null;
    const h = d.getHours();
    return HOUR_BANDS.filter(function (b) { return h >= b.lo && h < b.hi; })[0] || null;
  }

  /** 玩家 -> 他常用队伍（含逐武将红度） */
  function build(result, allBattles) {
    const map = new Map();
    /* 「被筛选排除」的计数要与统计同口径：优先用 analyze 返回的合并续战全量；
       而战报浮层仍按原始段收集（负责把续战折叠展示），两者在这里分工。
       不合并的话，一次续战会被数成好几场，「另 N 场被筛选排除」会虚高。 */
    const fullSrc = (result && result.allBattles && result.allBattles.length)
      ? result.allBattles
      : ((allBattles && allBattles.length) ? allBattles : null);
    const useAll = !!fullSrc;

    /* 全量场次的「玩家 -> 阵容 -> 场次」预扫描：整体 O(B) 一次搞定，
       供所有玩家共享，用来显示「有几场被筛选条件排除」。
       （旧实现是每个玩家各扫一遍全量数据，O(P×B)，玩家一多主线程会卡死。） */
    const fullCount = new Map();
    if (useAll) {
      fullSrc.forEach(function (b) {
        [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
          const sd = pair[1];
          if (!sd || !sd.player) return;
          let m = fullCount.get(sd.player);
          if (!m) { m = new Map(); fullCount.set(sd.player, m); }
          m.set(sd.key, (m.get(sd.key) || 0) + 1);
        });
      });
    }

    result.battles.forEach(function (b) {
      [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
        const role = pair[0], side = pair[1];
        const name = side.player;
        if (!name) return;
        let p = map.get(name);
        if (!p) {
          p = {
            name: name, n: 0, wins: 0, losses: 0, draws: 0,
            alliances: new Map(), compMap: new Map(),
            redSum: 0, redN: 0,       // 玩家级红度：每场一个样本（side.redAvg），不按武将重复计
            hourMap: new Map(),       // 时段 -> 场次
            pairMap: new Map()        // 他本人的交手记录：pairKey -> 胜负（个人克制口径）
          };
          map.set(name, p);
        }
        p.n++;
        if (b.result === role) p.wins++;
        else if (b.result === 'draw') p.draws++;
        else p.losses++;
        if (side.alliance) p.alliances.set(side.alliance, (p.alliances.get(side.alliance) || 0) + 1);
        if (num(side.redAvg) !== null) { p.redSum += num(side.redAvg); p.redN++; }
        const band = hourBandOf(b.ts);
        if (band) p.hourMap.set(band.key, (p.hourMap.get(band.key) || 0) + 1);

        // 个人交手记录：他用这套阵容打「对方那套」的胜负（忽略同阵容内战）
        const foe = role === 'atk' ? b.def : b.atk;
        if (foe && foe.key && foe.key !== side.key) {
          const pk = AC.analyzer.pairKeyOf(side.key, foe.key);
          let rec = p.pairMap.get(pk);
          if (!rec) { rec = { n: 0, win: 0, loss: 0, draw: 0 }; p.pairMap.set(pk, rec); }
          rec.n++;
          if (b.result === 'draw') rec.draw++;
          else if (b.result === role) rec.win++;
          else rec.loss++;
        }

        const key = side.key;
        let c = p.compMap.get(key);
        if (!c) {
          c = {
            key: key, display: side.display || side.compRaw || key, troopSig: side.troopSig || '',
            n: 0, wins: 0, loss: 0, draws: 0,
            heroAgg: new Map()   // 这套阵容里每名武将的跨场累计
          };
          p.compMap.set(key, c);
        }
        c.n++;
        if (b.result === role) c.wins++;
        else if (b.result === 'draw') c.draws++;
        else c.loss++;
        aggHero(c.heroAgg, side, b.ts || 0);
      });
    });

    const players = Array.from(map.values()).map(function (p) {
      // 该玩家在全量数据里的场次（不受当前筛选影响），比 n 大说明有对局被排除
      const fm = useAll ? fullCount.get(p.name) : null;

      const compList = Array.from(p.compMap.values())
        .sort(function (a, b) { return b.n - a.n; })
        .map(function (c) {
          return {
            key: c.key,
            display: c.display,
            troopSig: c.troopSig,
            n: c.n,
            winLo: c.wins,
            loss: c.loss,
            draw: c.draws,
            rate: c.n ? (c.wins + c.draws * 0.5) / c.n : 0.5,
            heroes: flushHeroAgg(c.heroAgg),
            // 该阵容在全量数据里的场次；比 n 大说明有对局被筛选条件排除
            fullN: (fm && fm.has(c.key)) ? fm.get(c.key) : c.n
          };
        });

      const hourTotal = HOUR_BANDS.reduce(function (s, b) { return s + (p.hourMap.get(b.key) || 0); }, 0);
      return {
        name: p.name,
        n: p.n,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        rate: p.n ? (p.wins + p.draws * 0.5) / p.n : 0.5,
        alliance: (function () {
          let best = '', bestN = -1;
          p.alliances.forEach(function (v, k) { if (v > bestN) { bestN = v; best = k; } });
          return best;
        })(),
        // 平均红度：每场取该部队的 redAvg 求平均。不按武将累加——
        // 他两套阵容都带关羽时，关羽会被重复计入，数值虚高且跨玩家不可比。
        avgRed: p.redN ? p.redSum / p.redN : null,
        // 活跃时段：找出场次最多的一档，并保留各档分布
        hours: HOUR_BANDS.map(function (b) {
          return { key: b.key, label: b.label, n: p.hourMap.get(b.key) || 0 };
        }),
        hourTotal: hourTotal,
        peakHour: (function () {
          let best = null, bestN = 0;
          p.hourMap.forEach(function (v, k) {
            if (v > bestN) { bestN = v; best = k; }
          });
          const b = HOUR_BANDS.filter(function (x) { return x.key === best; })[0];
          return b ? b.label : null;
        })(),
        pairMap: p.pairMap,
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

  /** 一条对局数据的来源说明：个人交手 / 全局 / 两者融合 */
  function srcText(x) {
    if (!x) return '';
    if (x.src === 'player') return '个人交手 ' + x.pn + ' 场';
    if (x.src === 'mix') return '个人 ' + x.pn + ' 场 + 全局 ' + x.n + ' 场';
    return '全局 ' + x.n + ' 场';
  }

  /** 一条建议的证据量说明 */
  function evidenceText(a) {
    let pn = 0;
    (a.detail || []).forEach(function (d) { pn += (d.pn || 0); });
    return (pn ? '含个人交手 ' + pn + ' 场 · ' : '') + '累计依据 ' + a.evidence + ' 场';
  }

  /* ---------------- 战报浮层 ----------------
     展示某位玩家在某套阵容下的全部对战，样式参考游戏内战报：
     时间 / 地点 / 回合 / 攻守 / 双方玩家与同盟 / 双方武将与红度 / 兵力 / 胜负。
     对战多时按页切换；被当前筛选条件排除的场次同样列出，并单独打标。 */
  const BATT_PER_PAGE = 10;

  /** 从全量数据现场收集某玩家某套阵容的对战（含被筛选条件排除的场次） */
  function collectBattles(allBattles, kept, playerName, comp) {
    const out = [];
    (allBattles || []).forEach(function (b) {
      [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
        const role = pair[0], side = pair[1];
        if (!side || side.player !== playerName || side.key !== comp.key) return;
        out.push({
          id: b.id, time: b.time, ts: b.ts, place: b.place, round: b.round,
          result: b.result, role: role,
          me: side, foe: role === 'atk' ? b.def : b.atk,
          filtered: !kept.has(b.id)      // 该场是否被当前筛选条件排除
        });
      });
    });
    return out;
  }

  /**
   * 同一次完整战斗的续战间隔上限：打平后十几秒内就会续战。
   * （兵力量级判定才是主要依据，这里只是防误连的兜底。）
   */
  const CHAIN_GAP_MS = 10 * 60 * 1000;

  /** cur 是否是 prev 这一段的续战：双方兵力都接得上，且时间没有倒挂 */
  function linked(prev, cur) {
    const gap = (cur.ts || 0) - (prev.ts || 0);
    if (gap < 0 || gap > CHAIN_GAP_MS) return false;
    if (!prev.me || !cur.me || !prev.foe || !cur.foe) return false;
    const ends = function (s) {
      return s.origin !== null && s.origin !== undefined &&
        s.remain !== null && s.remain !== undefined;
    };
    if (!ends(prev.me) || !ends(cur.me) || !ends(prev.foe) || !ends(cur.foe)) return false;
    return cur.me.origin === prev.me.remain && cur.foe.origin === prev.foe.remain;
  }

  /**
   * 把多段战报串成「同一次完整战斗」的链。
   * 游戏里打平会续战，同一次交战因此拆成多段记录（时间只差十几秒、双方兵力首尾衔接）。
   * 注意：parent 字段指向的是外部总战报（实测 0 条能对上内部 id），认不出内部链，只能靠兵力衔接。
   * 同秒记录的先后也不可靠，所以接尾之外还会试插链首。
   * @param {Array} list 战报段（含 me / foe 视角）
   * @returns {Array<Array>} 每条链按时间正序，单段链也会保留
   */
  function groupChains(list) {
    const asc = list.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    const buckets = new Map();
    asc.forEach(function (x) {
      // 同一对手 + 同一地点才可能是同一次交战
      const k = ((x.foe && x.foe.player) || '') + '@' + (x.place || '');
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); }
      arr.push(x);
    });

    const chains = [];
    buckets.forEach(function (segs) {
      const active = [];        // 桶内可能并行着几条互不衔接的链
      segs.forEach(function (s) {
        for (let i = 0; i < active.length; i++) {         // 接到某条链的尾部
          const c = active[i];
          if (linked(c[c.length - 1], s)) { c.push(s); return; }
        }
        for (let i = 0; i < active.length; i++) {         // 同秒记录顺序不定：反向插到链首
          const c = active[i];
          if (linked(s, c[0])) { c.unshift(s); return; }
        }
        const c = [s];
        active.push(c);
        chains.push(c);
      });
    });

    // 与列表一致：最新的排前面（按每条链的最终段排序）
    chains.sort(function (a, b) {
      return (b[b.length - 1].ts || 0) - (a[a.length - 1].ts || 0);
    });
    return chains;
  }

  /**
   * 战报浮层（玩家分析与同盟分析共用）
   * @param {Object} o {
   *   result, allBattles, keptIdSet,   // keptIdSet 缺省时按 result.battles 现算
   *   playerName, comp                 // 要看的玩家与其某套阵容（需含 key / display / troopSig）
   * }
   */
  function openBattleLog(o) {
    o = o || {};
    const result = o.result || {};
    const playerName = o.playerName, comp = o.comp || { key: '', display: '' };
    const allBattles = (o.allBattles && o.allBattles.length) ? o.allBattles : (result.battles || []);
    const kept = o.keptIdSet || new Set((result.battles || []).map(function (b) { return b.id; }));
    const list = collectBattles(allBattles, kept, playerName, comp)
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    const hidden = list.filter(function (x) { return x.filtered; }).length;
    // 渲染与分页以「一次完整战斗」为单位：续战的多段折叠成一组，默认只看最终结果
    const chains = groupChains(list);
    let page = 0;
    const totalPages = Math.max(1, Math.ceil(chains.length / BATT_PER_PAGE));

    const mask = U.el('div', { class: 'bl-mask' });
    const panel = U.el('div', { class: 'bl-panel' });
    const body = U.el('div', { class: 'bl-body' });
    const pager = U.el('div', { class: 'bl-pager' });

    function close() {
      mask.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    /** 一排武将卡：卡面 + 等级 + 兵种 + 红度星 + 武将名（仿游戏战报） */
    function heroCards(side) {
      const wrap = U.el('div', { class: 'bl2-cards' });
      (side && side.heroes ? side.heroes : []).slice(0, 3).forEach(function (h) {
        wrap.appendChild(U.el('div', { class: 'bl2-hero' }, [
          AC.heroIcon ? AC.heroIcon(h.name, 'bl2-face') : U.el('div', { class: 'bl2-face' }),
          h.level === null || h.level === undefined ? null
            : U.el('span', { class: 'bl2-lv', text: String(Math.round(h.level)) }),
          h.troop ? U.troopBadge(h.troop) : null,
          redStars(h.red),
          U.el('div', { class: 'bl2-name', title: h.name || '', text: h.name || '-' })
        ]));
      });
      return wrap;
    }

    /** 红度 -> 最多 5 颗星（0 级为暗星占位，对齐游戏卡面） */
    function redStars(red) {
      const n = (red === null || red === undefined || isNaN(Number(red))) ? 0 : Math.round(Number(red));
      const box = U.el('div', { class: 'bl2-stars' });
      for (let k = 0; k < 5; k++) box.appendChild(U.el('i', { class: k < n ? 'on' : '' }));
      return box;
    }

    /** 一方的信息块：玩家 / 同盟 / 兵力条 / 伤亡（兵力条按敌我配色：我方蓝、敌方红） */
    function sideInfo(side, cls, battle) {
      const origin = (side && side.origin) || 0;
      const remain = (side && side.remain) || 0;
      const pct = origin > 0 ? Math.max(0, Math.min(1, remain / origin)) : 0;
      const info = U.el('div', { class: 'bl2-info ' + cls });
      info.appendChild(U.el('div', { class: 'bl2-who' }, [
        U.el('span', { class: 'bl2-pname ' + (cls === 'me' ? 'ally' : 'enemy'), text: (side && side.player) || '-' }),
        (AC.openSideConfig && side && side.heroes && side.heroes.length) ? U.el('button', {
          class: 'bl-detail', text: '配置',
          title: '查看这一方的完整配置（技能 / 兵书 / 装备 / 战马 / 阵型）',
          onclick: function (e) {
            e.stopPropagation();
            AC.openSideConfig(side.player || '-', side, {
              sub: battle && battle.time ? String(battle.time).replace('T', ' ') : ''
            });
          }
        }) : null
      ]));
      if (side && side.alliance) {
        info.appendChild(U.el('div', { class: 'bl2-aname', text: side.alliance }));
      }
      info.appendChild(U.el('div', { class: 'bl2-force' }, [
        U.el('div', { class: 'bl2-force-n', text: U.fmtInt(remain) + ' / ' + U.fmtInt(origin) }),
        U.el('div', { class: 'bl2-bar' }, [U.el('i', { style: { width: (pct * 100).toFixed(1) + '%' } })])
      ]));
      info.appendChild(U.el('div', {
        class: 'bl2-sub',
        text: '伤 ' + U.fmtInt((side && side.wounded) || 0) + ' / 亡 ' + U.fmtInt((side && side.dead) || 0)
      }));
      return info;
    }

    /** 一张战报卡（seqText 为顶部条显示的序号文案） */
    function renderCard(x, seqText) {
      const isDraw = x.result === 'draw';
      const meWin = !isDraw && x.result === x.role;
      const resultText = isDraw ? '平' : (meWin ? '胜' : '败');
      const card = U.el('div', {
        class: 'bl2-card ' + (meWin ? 'is-win' : (isDraw ? 'is-draw' : 'is-loss')) +
          (x.filtered ? ' is-filtered' : '')
      });

      // 顶部条：攻守 + 第几场 + 地点 + 时间
      card.appendChild(U.el('div', { class: 'bl2-top' }, [
        U.el('span', { class: 'bl2-role' }, [
          U.el('i', { class: 'bl2-role-ico', 'aria-hidden': 'true', text: x.role === 'atk' ? '⚔' : '⛨' }),
          U.el('span', { text: x.role === 'atk' ? '进攻' : '防守' })
        ]),
        U.el('span', { class: 'bl2-seq', text: seqText }),
        x.round ? U.el('span', { class: 'bl2-round', text: x.round + ' 回合' }) : null,
        x.place ? U.el('span', { class: 'bl2-place', text: x.place }) : null,
        // 该场获得的武勋（居中显示，宽表没这列就不显示）
        (x.me && x.me.wuxun) ? U.el('span', {
          class: 'bl2-merit', text: '武勋 ' + U.fmtInt(x.me.wuxun)
        }) : null,
        x.filtered ? U.el('span', {
          class: 'bl-filtered-tag', text: '被筛选排除',
          title: '这场没通过左侧的样本筛选条件，不计入统计，但仍属于他的对战记录'
        }) : null,
        U.el('span', {
          class: 'bl2-time',
          text: String(x.time || '').replace('T', ' ').replace(/-/g, '/')
        })
      ]));

      // 主体：我方卡组 | 我方信息 | 印章 | 敌方信息 | 敌方卡组
      const row = U.el('div', { class: 'bl2-body' });
      row.appendChild(heroCards(x.me));
      row.appendChild(sideInfo(x.me, 'me', x));
      const stamp = U.el('div', {
        class: 'bl2-stamp ' + (meWin ? 'win' : (isDraw ? 'draw' : 'loss')), 'aria-hidden': 'true'
      }, [U.el('b', { text: resultText })]);
      if (x.me && x.me.stamina) {
        stamp.appendChild(U.el('div', { class: 'bl2-stam', text: '体力 -' + x.me.stamina }));
      }
      row.appendChild(stamp);
      row.appendChild(sideInfo(x.foe, 'foe', x));
      row.appendChild(heroCards(x.foe));
      card.appendChild(row);
      return card;
    }

    function renderPage() {
      body.innerHTML = '';
      const slice = chains.slice(page * BATT_PER_PAGE, (page + 1) * BATT_PER_PAGE);
      if (!slice.length) {
        body.appendChild(U.el('div', { class: 'hint', text: '这套阵容没有可展示的对战记录。' }));
        return;
      }
      slice.forEach(function (chain, i) {
        const idx = page * BATT_PER_PAGE + i + 1;
        // 单段：直接一张卡
        if (chain.length === 1) {
          body.appendChild(renderCard(chain[0], '第 ' + idx + ' 场'));
          return;
        }
        // 多段（打平后续战）：折叠为一组，默认只显示最终结果
        const box = U.el('div', { class: 'bl2-chain' });
        const more = U.el('div', { class: 'bl2-chain-more' });
        more.hidden = true;
        // 展开区按「由新到旧」排列（与列表一致）；段号仍按发生顺序，第 1 段 = 最早
        const rest = chain.slice(0, -1);
        for (let j = rest.length - 1; j >= 0; j--) {
          more.appendChild(renderCard(rest[j], '第 ' + (j + 1) + ' 段'));
        }
        const toggle = U.el('button', {
          class: 'bl2-chain-toggle',
          text: '展开其余 ' + (chain.length - 1) + ' 段',
          onclick: function () {
            more.hidden = !more.hidden;
            toggle.textContent = more.hidden ? '展开其余 ' + (chain.length - 1) + ' 段' : '收起';
          }
        });
        box.appendChild(U.el('div', { class: 'bl2-chain-bar' }, [
          U.el('span', { class: 'bl2-chain-tag', text: '连续交战 ' + chain.length + ' 段' }),
          U.el('span', { class: 'bl2-chain-note', text: '打平后续战，为同一次交战 · 下方默认显示最终结果' }),
          toggle
        ]));
        box.appendChild(renderCard(chain[chain.length - 1], '第 ' + idx + ' 场（最终）'));
        box.appendChild(more);
        body.appendChild(box);
      });
    }

    function renderPager() {
      pager.innerHTML = '';
      pager.appendChild(U.el('button', {
        class: 'bl-btn', text: '上一页', disabled: page === 0 ? 'disabled' : null,
        onclick: function () { if (page > 0) { page--; renderPage(); renderPager(); } }
      }));
      const folded = chains.length < list.length;
      pager.appendChild(U.el('span', {
        class: 'bl-page',
        text: (page + 1) + ' / ' + totalPages + '  （' +
          (folded ? '共 ' + chains.length + ' 次交战 · ' : '共 ') + list.length + ' 场' +
          (hidden ? '，其中 ' + hidden + ' 场未通过当前筛选、不计入统计' : '') + '）'
      }));
      pager.appendChild(U.el('button', {
        class: 'bl-btn', text: '下一页', disabled: page >= totalPages - 1 ? 'disabled' : null,
        onclick: function () { if (page < totalPages - 1) { page++; renderPage(); renderPager(); } }
      }));
    }

    // 顶部横幅：中间是仿游戏战报的统计（连战场次 / 斩获武勋）
    const wuxun = list.reduce(function (s, x) { return s + ((x.me && x.me.wuxun) || 0); }, 0);
    const summary = wuxun > 0
      ? [U.el('b', { text: '连战 ' + list.length + ' 场' }),
      U.el('span', { text: '斩获武勋 ' + U.fmtInt(wuxun) })]
      : [U.el('b', { text: '共 ' + list.length + ' 场' })];
    panel.appendChild(U.el('div', { class: 'bl-title bl2-title' }, [
      U.el('div', { class: 'bl-title-l' }, [
        U.el('b', { text: playerName }),
        U.el('span', { text: ' · ' }),
        U.el('span', {}, [U.compWithTroop(comp.display, comp.troopSig)])
      ]),
      U.el('div', { class: 'bl2-sum' }, summary),
      U.el('button', { class: 'bl-close', text: '×', title: '关闭（Esc）', onclick: close })
    ]));
    panel.appendChild(body);
    panel.appendChild(pager);
    mask.appendChild(panel);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.body.appendChild(mask);
    document.addEventListener('keydown', onKey);
    renderPage();
    renderPager();
  }

  /** 一个阵容的武将红度表 */
  function compCard(c, playerName, view) {
    const box = U.el('div', { class: 'pc-box' });
    box.appendChild(U.el('div', { class: 'pc-head' }, [
      U.el('div', { class: 'pc-name' }, [U.compWithTroop(c.display, c.troopSig)]),
      U.el('div', { class: 'pc-meta' }, [
        U.el('span', { text: c.n + ' 场' }),
        U.el('span', { class: 'pc-wl', text: c.winLo + ' 胜 ' + (c.loss || 0) + ' 负' + (c.draw ? ' ' + c.draw + ' 平' : '') }),
        U.el('span', { style: { color: U.rateColor(c.rate) }, text: '胜率 ' + U.fmtPct(c.rate, 0) }),
        // 小样本保护：1 场 1 胜显示 100% 会误导
        c.n < 5 ? U.el('span', { class: 'pc-weak', text: '样本少' }) : null,
        (c.fullN && c.fullN > c.n)
          ? U.el('span', { class: 'pc-more', title: '有对局被筛选条件排除，关闭「红度对等」等条件后可见', text: '另 ' + (c.fullN - c.n) + ' 场被筛选排除' })
          : null,
        U.el('button', {
          class: 'pc-log', text: '战报',
          title: '查看这套阵容在全部数据里的对战（含被当前筛选排除的场次）',
          onclick: function (e) {
            e.stopPropagation();
            openBattleLog({
              result: view.result, allBattles: view.allBattles, keptIdSet: view._keptIdSet,
              playerName: playerName, comp: c
            });
          }
        })
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
      // 均值是全周期口径；把「最高 / 最近一场」放进 title，避免赛季中养成提升被历史低值拉平
      const redTip = [h.redMax !== null ? '最高 红' + h.redMax : '',
      h.last && h.last.red !== null && h.last.red !== undefined ? '最近一场 红' + h.last.red : '']
        .filter(Boolean).join(' · ');
      const pinTip = [h.pinMax !== null ? '最高 ' + h.pinMax + ' 品' : '',
      h.last && h.last.pin !== null && h.last.pin !== undefined ? '最近一场 ' + h.last.pin + ' 品' : '']
        .filter(Boolean).join(' · ');
      const lvTip = h.last && h.last.level !== null && h.last.level !== undefined
        ? '最近一场 Lv' + Math.round(h.last.level) : '';
      box.appendChild(U.el('div', { class: 'pc-row' }, [
        U.el('div', { class: 'pc-hn' }, [
          U.el('span', { text: h.name }),
          h.troop ? U.troopBadge(h.troop) : null
        ]),
        U.el('div', { class: 'pc-red', title: redTip || null }, [
          redDots(h.red),
          U.el('span', { class: 'pc-red-n', text: h.red === null ? '-' : h.red.toFixed(1) })
        ]),
        U.el('div', { class: 'pc-pin', title: pinTip || null, text: h.pin === null ? '-' : h.pin.toFixed(1) }),
        U.el('div', { class: 'pc-lv', title: lvTip || null, text: h.level === null ? '-' : Math.round(h.level) }),
        U.el('div', { class: 'pc-eq', title: (h.equip || '-') + ' / ' + (h.horse || '-'), text: (h.equip || '-') + ' / ' + (h.horse || '-') })
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
      // 活跃时段：用「该时段占其有效对局的比例」判定，而不是只认单一峰值——
      // 只比峰值会漏掉「每晚都打、但下午恰好多一场」的人。
      if (f.hour !== 'all') {
        const band = p.hours.filter(function (x) { return x.label === f.hour; })[0];
        if (!band || !p.hourTotal || band.n / p.hourTotal < HOUR_SHARE) return false;
      }
      if (f.kw) {
        const kw = f.kw.toLowerCase();
        const hit = p.name.toLowerCase().indexOf(kw) >= 0 ||
          (p.alliance || '').toLowerCase().indexOf(kw) >= 0 ||
          p.compList.some(function (c) {
            // 阵容名与武将名都能搜：这一页的主角是武将红度
            return (c.display || '').toLowerCase().indexOf(kw) >= 0 ||
              c.heroes.some(function (h) { return h.name.toLowerCase().indexOf(kw) >= 0; });
          });
        if (!hit) return false;
      }
      return true;
    });
  };

  PlayerView.prototype.render = function (result, allBattles) {
    this.result = result;
    this.allBattles = allBattles;
    if (!result || !result.battles || !result.battles.length) {
      this.listHost.innerHTML = '';
      this.detailHost.innerHTML = '';
      this.detailHost.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '60px 0' } }, [
        U.el('h3', { text: '还没有可分析的玩家数据' }),
        U.el('p', { text: '先导入战报，或在筛选条件里放宽限制（当前过滤结果为空时这一页也会是空的）。' })
      ]));
      return;
    }
    // 当前筛选下保留的场次 id：战报浮层用它标出「哪些场次被排除」
    this._keptIdSet = new Set(result.battles.map(function (b) { return b.id; }));
    this.data = build(result, allBattles);
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
    // 列表 DOM 被重建过，选中高亮要补回来（否则一改筛选左侧高亮就丢了）
    if (this.selected) this.markActive(this.selected);
  };

  /** 只做列表高亮，不重绘详情 */
  PlayerView.prototype.markActive = function (name) {
    const host = this.listHost;
    Array.prototype.forEach.call(host.querySelectorAll('.ally-item'), function (node) {
      node.classList.toggle('active', node.dataset.name === name);
    });
  };

  /** 顶部筛选栏 */
  PlayerView.prototype.renderFilters = function () {
    const self = this;
    const host = this.listHost;
    Array.prototype.slice.call(host.querySelectorAll('.pf-bar')).forEach(function (n) { n.remove(); });

    // 无同盟的玩家也要能筛出来（否则 applyFilter 里的「(无同盟)」分支永远走不到）
    const alliances = Array.from(new Set(this.data.players.map(function (p) { return p.alliance || '(无同盟)'; }))).sort();
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
      { v: 'mid', t: '中（1.5~2.5）' }, { v: 'high', t: '高（≥2.5）' },
      { v: 'unknown', t: '未知（宽表无红度列）' }
    ], this.filter.red));
    bar.appendChild(select('活跃度', 'active', [
      { v: 'all', t: '全部' }, { v: 'high', t: '高（≥30 场）' },
      { v: 'mid', t: '中（10~29 场）' }, { v: 'low', t: '低（<10 场）' }
    ], this.filter.active));
    bar.appendChild(select('活跃时段', 'hour',
      // 判定口径是「该时段占其有效对局的比例」，把说明写进选项文案里
      [{ v: 'all', t: '全部' }].concat(hourOptions.map(function (h) {
        return { v: h, t: h + '（占比≥30%）' };
      })), this.filter.hour));

    const kw = U.el('input', { class: 'pf-input', type: 'text', placeholder: '玩家 / 同盟 / 阵容 / 武将' });
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
          // 小样本保护：场次太少时胜率不可信，标出来
          p.n < 5 ? U.el('span', { class: 'ai-weak', text: '样本少' }) : null,
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
    this.markActive(name);
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
      metric('胜率', U.fmtPct(p.rate), p.wins + ' 胜 / ' + p.losses + ' 负 / ' + p.draws + ' 平'),
      metric('队伍数', p.compList.length + ' 套', '按出场次数排序'),
      metric('平均红度', p.avgRed === null ? '-' : p.avgRed.toFixed(1), '按场次平均（每场取该队均红）'),
      metric('被筛选排除', (function () {
        let hidden = 0;
        p.compList.forEach(function (c) { hidden += Math.max(0, (c.fullN || c.n) - c.n); });
        return hidden + ' 场';
      })(), '放宽左侧筛选条件可看到')
    ]));

    /* ---- 各队伍的武将红度 ---- */
    const self = this;
    const s1 = section('各队伍的武将红度', '每套队伍里具体是哪几名武将、红度 / 品级 / 等级 / 装备战马各是什么水平');
    p.compList.slice(0, 8).forEach(function (c) { s1.appendChild(compCard(c, p.name, self)); });
    if (p.compList.length > 8) {
      s1.appendChild(U.el('p', { class: 'hint', text: '（只列出前 8 套，共 ' + p.compList.length + ' 套）' }));
    }
    host.appendChild(s1);

    /* ---- 克制建议：口径优先「他本人」的交手记录 ---- */
    const ally = { name: p.name, n: p.n, compList: p.compList, pairMap: p.pairMap };
    const advice = AC.allianceAnalysis.counterAdvice(this.result, ally, { playerPairs: p.pairMap });

    /* ---- 一句话结论 ---- */
    if (advice.length && p.compList.length) {
      const top = advice[0];
      const main = p.compList[0];
      const T = function (s) { return U.el('span', { text: s }); };
      const hl = function (s, c) { return U.el('span', { class: c, text: s }); };
      const cmp = function (s) { return U.el('span', { class: 'ac-comp', text: '「' + s + '」' }); };
      const lines = [
        U.el('div', {}, [
          T('他的出场有 '), hl(U.fmtPct(main.n / p.n, 0), 'ac-strong'),
          T(' 集中在 '), cmp(main.display),
          T('（他用这套的胜率 ' + U.fmtPct(main.rate, 0) + (main.n < 5 ? '，样本少' : '') + '）')
        ]),
        U.el('div', {}, [
          T('拿 '), cmp(top.display), T(' 打他最稳：期望胜率 '),
          hl(U.fmtPct(top.expRate), top.expRate >= 0.5 ? 'ac-good' : 'ac-warn'),
          T('，能对上他 '), hl(U.fmtPct(top.coverage, 0), 'ac-strong'),
          T(' 的出场（' + evidenceText(top) + '）')
        ])
      ];
      if (top.risks && top.risks.length) {
        lines.push(U.el('div', {}, [
          hl('注意：', 'ac-warn'),
          T('这套也有打不动的——'),
          cmp(top.risks[0].comp),
          T('占他 ' + U.fmtPct(top.risks[0].share, 0) + ' 出场，你对上只有 ' + U.fmtPct(top.risks[0].rate, 0))
        ]));
      }
      host.appendChild(U.el('div', { class: 'ally-conclusion' },
        [U.el('b', { class: 'ac-title', text: '结论' })].concat(lines)));
    }

    /* ---- 如何克制 ---- */
    const s2 = section('如何克制他 · 推荐阵容',
      '优先用他本人的交手记录估算胜率；他没交手过的组合才回落到全服同款阵容的数据，并做融合');
    if (!advice.length) {
      s2.appendChild(U.el('div', { class: 'hint', text: '交手样本不足，暂时给不出克制建议（可以多导入几批战报）。' }));
    } else {
      advice.slice(0, 6).forEach(function (a, i) {
        const box = U.el('div', { class: 'adv-item' });
        box.appendChild(U.el('div', { class: 'adv-head' }, [
          U.el('span', { class: 'adv-rank', text: '#' + (i + 1) }),
          U.el('span', { class: 'adv-comp' }, [U.compWithTroop(a.display, a.troopSig)]),
          U.el('span', { class: 'adv-rate', style: { color: U.rateColor(a.expRate) }, text: '期望胜率 ' + U.fmtPct(a.expRate, 0) }),
          U.el('span', { class: 'adv-cov', text: '覆盖 ' + U.fmtPct(a.coverage, 0) }),
          U.el('span', { class: 'adv-cov', text: evidenceText(a) })
        ]));
        if (a.detail && a.detail.length) {
          box.appendChild(U.el('div', { class: 'adv-detail' }, a.detail.slice(0, 3).map(function (d) {
            return U.el('div', { class: 'adv-detail-row' }, [
              U.el('span', { class: 'adv-d-name' }, [
                U.el('span', { text: '打「' + d.comp + '」' }),
                U.troopBadges(d.troopSig)
              ]),
              U.el('span', { class: 'adv-d-n', text: '占他 ' + U.fmtPct(d.share, 0) }),
              U.el('span', { class: 'adv-d-rate', style: { color: U.rateColor(d.rate) }, text: U.fmtPct(d.rate, 0) }),
              U.el('span', { class: 'adv-d-src', text: srcText(d) })
            ]);
          })));
        }
        if (a.risks && a.risks.length) {
          box.appendChild(U.el('div', { class: 'adv-risks' }, [
            U.el('div', { class: 'adv-risks-t', text: '用它打他时，当心他这几套（他常出、而你打不过）：' }),
            U.el('div', { class: 'risk-list' }, a.risks.slice(0, 3).map(function (r) {
              return U.el('div', { class: 'risk-row' }, [
                U.el('span', { class: 'risk-comp' }, [U.compWithTroop(r.comp, r.troopSig)]),
                U.el('span', { class: 'risk-share', text: '他常用 ' + U.fmtPct(r.share, 0) }),
                U.el('span', {
                  class: 'risk-mine', style: { color: U.rateColor(r.rate) },
                  text: '你对上胜率 ' + U.fmtPct(r.rate, 0) + '（' + srcText(r) + '）'
                })
              ]);
            }))
          ]));
        }
        s2.appendChild(box);
      });
      s2.appendChild(U.el('p', {
        class: 'hint',
        text: '胜率算法：优先取「他用这套阵容打我方该阵容」的个人交手记录；他没交手过的组合才用全服同款阵容的数据，' +
          '并按个人 1 场 ≈ 全局 6 场的权重融合。两边样本都不足的组合直接跳过，不按 50% 填充。'
      }));
    }
    host.appendChild(s2);

    /* ---- 针对他每套队伍的单点克制 ---- */
    const s3 = section('针对他每套队伍的单点克制', '他明显会出某套时，按这套挑应对；同样优先他本人的交手记录');
    const perComp = AC.allianceAnalysis.bestAgainst(this.result, ally, { playerPairs: p.pairMap });
    perComp.slice(0, 4).forEach(function (item) {
      const box = U.el('div', { class: 'pc-box' });
      box.appendChild(U.el('div', { class: 'pc-head' }, [
        U.el('div', { class: 'pc-name' }, [U.compWithTroop(item.comp.display, item.comp.troopSig)]),
        U.el('div', { class: 'pc-meta' }, [
          U.el('span', { text: item.comp.n + ' 场' }),
          U.el('span', { style: { color: U.rateColor(item.comp.rate) }, text: '他用这套胜率 ' + U.fmtPct(item.comp.rate, 0) }),
          item.comp.n < 5 ? U.el('span', { class: 'pc-weak', text: '样本少' }) : null
        ])
      ]));
      if (!item.best.length) {
        box.appendChild(U.el('div', { class: 'hint', text: '暂无足够样本的对手阵容。' }));
      } else {
        item.best.forEach(function (b) {
          box.appendChild(U.el('div', { class: 'pc-xrow' }, [
            U.el('div', { class: 'pc-hn' }, [U.compWithTroop(b.display, b.troopSig)]),
            U.el('div', { class: 'pc-xsrc', text: srcText(b) }),
            U.el('div', { class: 'pc-xrate', style: { color: U.rateColor(b.rate) }, text: U.fmtPct(b.rate, 0) })
          ]));
        });
      }
      s3.appendChild(box);
    });
    if (!perComp.length) s3.appendChild(U.el('p', { class: 'hint', text: '暂无数据。' }));
    host.appendChild(s3);
  };

  AC.PlayerView = PlayerView;
  AC.playerAnalysis = {
    build: build, heroSnapshots: heroSnapshots,
    HOUR_BANDS: HOUR_BANDS, hourBandOf: hourBandOf,
    openBattleLog: openBattleLog,     // 同盟分析的玩家列表也复用这个战报浮层
    groupChains: groupChains          // 「打平续战」多段 -> 一次完整战斗（战报折叠与统计合并都靠它）
  };

  // URL 带 #log 打开首个阵容的战报浮层；带 #side 再自动点开第一个「配置」（便于验证与分享）
  if (location.hash === '#log' || location.hash === '#side') {
    setTimeout(function () {
      const logBtn = document.querySelector('.pc-log');
      if (!logBtn) return;
      logBtn.click();
      if (location.hash !== '#side') return;
      setTimeout(function () {
        const d = document.querySelector('.bl-detail');
        if (d) d.click();
      }, 700);
    }, 1000);
  }
})(window.AC);
