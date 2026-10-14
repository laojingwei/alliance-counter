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

  /** 简短时间戳（供「连续段 10/12 06:21 ~ 06:21」这类提示用） */
  function fmtTime(ts) {
    const d = new Date(ts || 0);
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 筛选「活跃时段」时，该时段至少要占玩家这么多比例的有效对局才算「活跃在该时段」 */
  const HOUR_SHARE = 0.3;

  /* 「手操抓克制」的判定 —— 只看行为，两种证据任一成立即可：
     ① 长期集中：单一对手占比 ≥85%（50~70% 那只是碰到的多，随便打也会碰上，不算证据）
     ② 一波连打：至少连续 4 场都在打同一套队伍、而且全赢
        （哪怕整体占比不高，连着几场只挑这一套打已经说明他在针对） */
  const SNIPE_MIN_N = 6;          // ① 至少交手这么多场才判（85% 之下小样本容易偶然）
  const SNIPE_SHARE = 0.85;       // ① 单一对手占比门槛
  const SNIPE_SHARE_PURE = 0.95;  // ① ≥95% = 几乎只打它（别的队伍基本不碰）
  const SNIPE_RUN_MIN = 4;        // ② 连续几场打同一套（且全胜）才算「一波针对」
  const RUN_GAP_MS = 30 * 60 * 1000;   // ② 连续段内相邻两场最多隔 30 分钟（超过就是「隔一阵又打」，另起一波）

  /* 克制分级用的是全站统一口径（AC.util.counterLevel）：≥80% 强克制 / 70~80% 克制 /
     45~70% 均势 / 30~45% 被克 / <30% 被强克。
     档位直接用真实胜率定（和展示同一个数），样本量的顾虑靠 SNIPE_MIN_N 门槛兜底。 */

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
    /* 「另 N 段平局续战已并入」：一场战斗里这位玩家这套阵容参与了 k 段，就有 k-1 段被折进
       同一张卡。注意**不能数「所有 child 记录」** —— 没被合并的 child 本身就是独立一场、
       已经计入统计，那样数出来的数字会和战报浮层里的段数对不上（实测 15 对 1）。 */
    const childCount = new Map();
    /* 全量口径的「玩家|阵容 -> 对手分布」：抓克制判的是**行为**（他盯着谁打），
       不该被「只统计兵力接近 / 红度对等」这类统计筛选砍掉场次——否则真人专挑 8 场，
       筛选后只剩 3 场就判不出来了。展示用的场次/胜率仍走筛选后口径。 */
    const fullFoe = new Map();
    /* 每套队伍的全量战斗序列（按时间正序用）：用来找「连续 N 场都在打同一套」的一波针对 */
    const fullSeq = new Map();
    if (useAll) {
      /* 「被折进同一张卡的段」= 这场战斗里他参与的段数 - 1（与战报浮层同口径）。
         按**玩家**归属，key 取他在这场里第一次出现的那个 —— 同场续战里某个武将打光后
         阵容串会变短、key 跟着变，按 key 精确匹配会漏掉后面的段。 */
      fullSrc.forEach(function (b) {
        if (!b.segs || b.segs.length < 2) return;
        const seen = new Map();          // 玩家 -> { key, n }
        b.segs.forEach(function (sg) {
          [sg.atk, sg.def].forEach(function (s) {
            if (!s || !s.player) return;
            let rec = seen.get(s.player);
            if (!rec) { rec = { key: s.key, n: 0 }; seen.set(s.player, rec); }
            rec.n++;
          });
        });
        seen.forEach(function (rec, player) {
          if (rec.n < 2) return;
          let cm = childCount.get(player);
          if (!cm) { cm = new Map(); childCount.set(player, cm); }
          cm.set(rec.key, (cm.get(rec.key) || 0) + (rec.n - 1));
        });
      });

      fullSrc.forEach(function (b) {
        [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
          const sd = pair[1];
          if (!sd || !sd.player) return;
          // fullSrc 已经是「合并后的一场一场」，所以这里每条都算一场
          let m = fullCount.get(sd.player);
          if (!m) { m = new Map(); fullCount.set(sd.player, m); }
          m.set(sd.key, (m.get(sd.key) || 0) + 1);
          const foeSd = pair[0] === 'atk' ? b.def : b.atk;
          if (!sd.key || !foeSd || !foeSd.key || foeSd.key === sd.key) return;
          /* 垃圾对局（打空城 / 练功 / 斯巴达队）：我方零损失、没拿到武勋，
             或者这支部队人数不满 3（1~2 个武将的翻地队，一般不主动打架）。
             这些都不该用来判断「他是不是在手动抓克制」。 */
          const junk = ((sd.wuxun || 0) <= 0)
            || (((sd.origin || 0) - (sd.remain || 0)) <= 0)
            || ((sd.size || 0) < 3)
            || ((foeSd.size || 0) < 3);
          const fk = sd.player + '|' + sd.key;
          let seq = fullSeq.get(fk);
          if (!seq) { seq = []; fullSeq.set(fk, seq); }
          seq.push({ ts: b.ts || 0, foe: foeSd.key, won: b.result === pair[0], junk: junk });
          if (junk) return;                       // 垃圾对局不计入对手分布
          let rec = fullFoe.get(fk);
          if (!rec) {
            rec = { foe: new Map(), win: new Map(), atk: new Map(), name: new Map(), total: 0 };
            fullFoe.set(fk, rec);
          }
          rec.total++;
          rec.foe.set(foeSd.key, (rec.foe.get(foeSd.key) || 0) + 1);
          if (b.result === pair[0]) rec.win.set(foeSd.key, (rec.win.get(foeSd.key) || 0) + 1);
          rec.atk.set(foeSd.key, (rec.atk.get(foeSd.key) || 0) + (pair[0] === 'atk' ? 1 : 0));
          if (!rec.name.has(foeSd.key)) {
            rec.name.set(foeSd.key, foeSd.display || foeSd.compRaw || foeSd.key);
          }
        });
      });
    }
    /** 最长「连续打同一套且全胜」的场数。
        要求相邻两场**紧挨着**：同一个对手、中间没有别的对局、且间隔不超过 RUN_GAP_MS
        —— 只按「场次相邻」会把「今天打一场、明天再打一场」也算成连续，那不是一波针对。 */
    function bestRunOf(seq) {
      if (!seq || !seq.length) return { n: 0, foe: '', fromTs: 0, toTs: 0 };
      const asc = seq.slice().sort(function (a, b) { return a.ts - b.ts; });
      let best = { n: 0, foe: '', fromTs: 0, toTs: 0 }, cur = null;
      asc.forEach(function (x) {
        if (x.junk) { cur = null; return; }      // 空城 / 练功 / 残缺队：断开连续
        const gapOk = cur && (x.ts - cur.lastTs) <= RUN_GAP_MS;
        if (x.won && cur && cur.foe === x.foe && gapOk) {
          cur.n++; cur.toTs = x.ts; cur.lastTs = x.ts;
        } else if (x.won) {
          cur = { foe: x.foe, n: 1, fromTs: x.ts, toTs: x.ts, lastTs: x.ts };
        } else {
          cur = null;
        }
        if (cur && cur.n > best.n) best = { n: cur.n, foe: cur.foe, fromTs: cur.fromTs, toTs: cur.toTs };
      });
      return best;
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
            formationMap: new Map(),  // 惯用阵型 -> 场次
            foeMap: new Map(),        // 整体打过哪些对手阵容、各多少场
            foeWin: new Map(),        // 对手阵容键 -> 胜场
            foeName: new Map(),       // 对手阵容键 -> 显示名
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
        if (side.formation) {
          p.formationMap.set(side.formation, (p.formationMap.get(side.formation) || 0) + 1);
        }
        // 玩家级对手分布：用来判断「这人整体上是不是爱挑对手」
        if (foe && foe.key && foe.key !== side.key) {
          p.foeMap.set(foe.key, (p.foeMap.get(foe.key) || 0) + 1);
          if (b.result === role) p.foeWin.set(foe.key, (p.foeWin.get(foe.key) || 0) + 1);
          if (!p.foeName.has(foe.key)) {
            p.foeName.set(foe.key, foe.display || foe.compRaw || foe.key);
          }
        }
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
            heroAgg: new Map(),  // 这套阵容里每名武将的跨场累计
            foeMap: new Map(),   // 这套阵容打过哪些对手阵容、各多少场（识别「手操抓克制」用）
            foeWin: new Map(),   // 对手阵容键 -> 打赢该对手的场次（算「抓它时的胜率」）
            foeName: new Map()   // 对手阵容键 -> 显示名
          };
          p.compMap.set(key, c);
        }
        c.n++;
        if (b.result === role) c.wins++;
        else if (b.result === 'draw') c.draws++;
        else c.loss++;
        aggHero(c.heroAgg, side, b.ts || 0);
        // 对手分布：内战不算（同阵容互打说明不了「抓克制」）
        if (foe && foe.key && foe.key !== side.key) {
          c.foeMap.set(foe.key, (c.foeMap.get(foe.key) || 0) + 1);
          if (b.result === role) c.foeWin.set(foe.key, (c.foeWin.get(foe.key) || 0) + 1);
          if (!c.foeName.has(foe.key)) {
            c.foeName.set(foe.key, foe.display || foe.compRaw || foe.key);
          }
          // 他在这组对局里是「主动进攻」还是「被动防守」——用来区分刷分与被人追着打
          if (!c.foeAtk) c.foeAtk = new Map();
          c.foeAtk.set(foe.key, (c.foeAtk.get(foe.key) || 0) + (role === 'atk' ? 1 : 0));
        }
      });
    });

    const players = Array.from(map.values()).map(function (p) {
      // 该玩家在全量数据里的场次（不受当前筛选影响），比 n 大说明有对局被排除
      const fm = useAll ? fullCount.get(p.name) : null;
      const cm = useAll ? childCount.get(p.name) : null;

      const compList = Array.from(p.compMap.values())
        .sort(function (a, b) { return b.n - a.n; })
        .map(function (c) {
          /* 对手集中度：优先用**全量**行为（不受统计筛选影响），没有全量数据时退回筛选后口径 */
          const ff = fullFoe.get(p.name + '|' + c.key);
          let foeTotal = 0, topKey = '', topN = 0;
          if (ff) {
            ff.foe.forEach(function (v, k) {
              foeTotal += v;
              if (v > topN) { topN = v; topKey = k; }
            });
          } else {
            c.foeMap.forEach(function (v, k) {
              foeTotal += v;
              if (v > topN) { topN = v; topKey = k; }
            });
          }
          const topShare = foeTotal ? topN / foeTotal : 0;
          const topDisplay = (ff && ff.name.get(topKey)) || c.foeName.get(topKey) || topKey;
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
            // 全量口径下该阵容的 block 场次；比 n 大说明有对局被统计条件排除
            fullN: (fm && fm.has(c.key)) ? fm.get(c.key) : c.n,
            // 同一阵容的同场续战（child）段数：已并入所属那一场，不算「被排除」
            childN: (cm && cm.has(c.key)) ? cm.get(c.key) : 0,
            // 对手分布（用于展示「打过的对手有多散」）
            foes: { total: foeTotal, kinds: c.foeMap.size, topKey: topKey, topN: topN, topShare: topShare, topDisplay: topDisplay },
            /* 手操抓克制：样本够 + 明显盯着某一种队伍打 */
            /* 指向性 × 胜率：
               counter = 专挑它、而且真打得过（胜率 ≥70%）→ 真·抓克制
               focus   = 专挑它，但只是均势（45~70%）→ 只是爱打这一套，谈不上克制
               feeding = 专挑一个克自己的队打（<45%）→ 刷分 / 被追着打 / 任务，不是抓克制 */
            /* 两种证据任一成立就算「针对」：
               ① byShare：长期集中在同一套（≥85%）
               ② runHit：连续 ≥4 场都在打同一套且全胜（一波针对性打击） */
            sniper: (function () {
              const run = bestRunOf(fullSeq.get(p.name + '|' + c.key));
              const runHit = run.n >= SNIPE_RUN_MIN;
              const byShare = foeTotal >= SNIPE_MIN_N && topShare >= SNIPE_SHARE;
              if (!byShare && !runHit) return null;
              const via = byShare ? 'share' : 'run';
              const key = byShare ? topKey : run.foe;
              const n = byShare ? topN : run.n;
              const display = (ff && ff.name.get(key)) || c.foeName.get(key) || key;
              const win = (ff ? ff.win.get(key) : c.foeWin.get(key)) || 0;
              const rate = byShare ? (topN ? (win / topN) : 0) : (n ? (win >= n ? 1 : win / n) : 1);
              const share = foeTotal ? (n / foeTotal) : 0;
              const lv = U.counterLevel(rate);
              const atkN = (ff ? ff.atk.get(key) : (c.foeAtk && c.foeAtk.get(key))) || 0;
              return {
                key: key, display: display, n: n, total: foeTotal, share: share, via: via,
                run: runHit ? run.n : 0,
                // 连续段的起止时间：让用户能自己翻到那几场核对（浮层分页时尤其需要）
                runFrom: runHit ? run.fromTs : 0,
                runTo: runHit ? run.toTs : 0,
                strong: share >= SNIPE_SHARE_PURE || lv.key === 'strong',
                rate: rate, level: lv.key, levelLabel: lv.label, levelColor: lv.color,
                /* via=run（连打全胜）本身就是针对性行为，直接算抓克制；
                   via=share 才按胜率分档：counter 真克制 / focus 只是均势 / feeding 专撞被克队 */
                kind: (via === 'run') ? 'counter'
                  : ((lv.key === 'strong' || lv.key === 'counter') ? 'counter'
                    : (lv.key === 'even' ? 'focus' : 'feeding')),
                atkRatio: n ? (atkN / n) : 0,
                why: n ? ((atkN / n) >= 0.7 ? 'self' : ((atkN / n) <= 0.3 ? 'forced' : 'mixed')) : 'mixed'
              };
            })()
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
        compList: compList,
        // 手操抓克制：哪些队伍是专门盯着某一种队伍打的
        snipers: compList.filter(function (c) { return c.sniper; }),
        // 惯用阵型（按场次排序，用于习惯面板）
        formations: Array.from(p.formationMap.entries())
          .map(function (e) { return { name: e[0], n: e[1] }; })
          .sort(function (a, b) { return b.n - a.n; }),
        // 整体对手分布：他是不是整体上也在挑对手
        foeStat: (function () {
          let total = 0, topKey = '', topN = 0;
          p.foeMap.forEach(function (v, k) {
            total += v;
            if (v > topN) { topN = v; topKey = k; }
          });
          return {
            total: total, kinds: p.foeMap.size, topKey: topKey, topN: topN,
            topDisplay: p.foeName.get(topKey) || topKey,
            topShare: total ? topN / total : 0
          };
        })()
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

  /** 从全量数据现场收集某玩家某套阵容的「战斗」（含同场的平局续战段） */
  function collectBattles(allBattles, kept, playerName, comp) {
    const out = [];
    (allBattles || []).forEach(function (b) {
      /* 合并体自带这场战斗的全部原始段（model.mergeChain 写入的 segs）；
         单段链没有 segs，就是它自己。 */
      const segs = (b.segs && b.segs.length) ? b.segs : [b];
      /* 只要这一场里有一段是他用这套阵容打的，整场就归他 ——
         同场续战里某个武将打光后阵容字符串会变短，不能要求每段都一致。 */
      let matched = false;
      segs.forEach(function (sg) {
        [sg.atk, sg.def].forEach(function (s) {
          if (s && s.player === playerName && s.key === comp.key) matched = true;
        });
      });
      if (!matched) return;

      const mine = [];
      segs.forEach(function (sg) {
        [['atk', sg.atk], ['def', sg.def]].forEach(function (pair) {
          const role = pair[0], side = pair[1];
          if (!side || side.player !== playerName) return;
          mine.push({
            id: sg.id, time: sg.time, ts: sg.ts, place: sg.place, round: sg.round,
            result: sg.result, role: role,
            me: side, foe: role === 'atk' ? sg.def : sg.atk
          });
        });
      });
      if (!mine.length) return;

      /* 末段（分出胜负的那一段）就是这一场的「结果」；前面的平局段收进 segs，
         由卡片上的按钮展开 —— 不再单独铺开成一堆「场」。 */
      mine.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      const last = mine[mine.length - 1];
      const inKept = kept.has(b.id);
      out.push({
        id: b.id, time: last.time, ts: last.ts, place: last.place, round: last.round,
        result: last.result, role: last.role,
        me: last.me, foe: last.foe,
        isChild: b.recordType === 'child',
        /* 未计入统计的原因只剩一种要单独标：真的没通过当前的样本筛选条件。
           （同场续战段现在收在 segs 里，不再作为「被排除」的另一类条目出现。） */
        filtered: !inKept,
        filteredBy: inKept ? '' : (b.recordType === 'child' ? 'child' : 'sample'),
        segs: mine.slice(0, -1)
      });
    });
    return out;
  }

  /**
   * 同一次完整战斗的续战间隔上限：打平后十几秒内就会续战。
   * （兵力量级判定才是主要依据，这里只是防误连的兜底。）
   */
  const CHAIN_GAP_MS = 10 * 60 * 1000;

  /**
   * cur 是否是 prev 这一段的续战。
   * 只看**我方**兵力：child 是我方同一支部队的续战段，而对手在同一波里可能换人
   * （实测同一波续战里对手会从「诸葛亮/诸葛瑾/SP周瑜」换成「马腾/钟会/公孙瓒」），
   * 再要求对方也首尾衔接会让该折叠的段折不起来。
   * 另外战后伤兵会恢复，所以比对的是「开战兵力 = 上一段剩余 + 上一段伤兵」。
   */
  function linked(prev, cur) {
    const gap = (cur.ts || 0) - (prev.ts || 0);
    if (gap < 0 || gap > CHAIN_GAP_MS) return false;
    if (!prev.me || !cur.me) return false;
    const s = prev.me;
    if (s.origin === null || s.origin === undefined || s.remain === null || s.remain === undefined) return false;
    if (cur.me.origin === null || cur.me.origin === undefined) return false;
    const exp = (s.remain || 0) + (s.wounded || 0);
    return Math.abs(cur.me.origin - exp) <= Math.max(50, exp * 0.005);
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
   *   playerName, comp,                // 要看的玩家与其某套阵容（需含 key / display / troopSig）
   *   title, subTitle,                 // 可选：自定义标题（连赢证据等场景）
   *   gatherFn                         // 可选：自定义取数 (allBattles, kept, playerName, comp) => list
   * }
   */
  function openBattleLog(o) {
    o = o || {};
    const result = o.result || {};
    const playerName = o.playerName, comp = o.comp || { key: '', display: '' };
    const allBattles = (o.allBattles && o.allBattles.length) ? o.allBattles : (result.battles || []);
    const kept = o.keptIdSet || new Set((result.battles || []).map(function (b) { return b.id; }));
    const gather = typeof o.gatherFn === 'function' ? o.gatherFn : collectBattles;
    let list = gather(allBattles, kept, playerName, comp)
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    // 只看某段时间内的交战（连赢证据用：那一波之间的战报，含夹在中间的败局）
    if (o.range && (o.range.from || o.range.to)) {
      list = list.filter(function (x) {
        return (x.ts || 0) >= (o.range.from || 0) && (x.ts || 0) <= (o.range.to || Infinity);
      });
    }
    /* 平局续战段已经收进各场战斗的 segs 里（默认折叠），这里只统计数量用于说明 */
    const segCnt = list.reduce(function (s, x) { return s + (x.segs ? x.segs.length : 0); }, 0);
    const hidden = list.filter(function (x) { return x.filteredBy === 'sample'; }).length;
    /* 与游戏内战报一致：**一场完整战斗一张卡**，同场的平局段收在卡片里可展开。
       场号按**发生顺序**编（第 1 场 = 最早那场），列表从新到旧排列（最新的在最上面）。
       注意：一场战斗只占一个场号 —— 打平续战段不再各自占一场。 */
    const asc = list.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    asc.forEach(function (x, i) { x.__seqNo = i + 1; });
    // 倒序显示；同一秒的两场按场号倒排，保证「新的在上」不会因稳定排序而颠倒
    const shown = list.slice().sort(function (a, b) {
      return ((b.ts || 0) - (a.ts || 0)) || ((b.__seqNo || 0) - (a.__seqNo || 0));
    });
    let page = 0;
    const totalPages = Math.max(1, Math.ceil(shown.length / BATT_PER_PAGE));

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
          (x.filtered ? ' is-filtered' : '') + (x.isChild ? ' is-child' : '')
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
        x.filteredBy === 'child' ? U.el('span', {
          class: 'bl-child-tag', text: '同场续战',
          title: '这是同一场交战的续战段（游戏用「父战报」把它归属到那一场），已并入那一场一起统计。'
               + '它不是被筛选条件排除的 —— 放宽左侧任何条件都不会让它单独计数'
        }) : (x.filtered ? U.el('span', {
          class: 'bl-filtered-tag', text: '被筛选排除',
          title: '这场没通过左侧的样本筛选条件，不计入统计，但仍属于他的对战记录'
        }) : null),
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

    /**
     * 一场完整战斗 = 结果卡（末段）+ 折叠起来的平局续战段。
     * 默认只显示结果那一段，点按钮才展开前面的平局段；
     * 展开区用专门的盒子装，和「独立的一场」在视觉上区分开。
     */
    function renderChain(x, seqText) {
      const segs = x.segs || [];
      if (!segs.length) return renderCard(x, seqText);
      const total = segs.length + 1;          // 这一场一共几段
      /* 段号按**时间顺序**编：先打的那几段是平局（第 1、2…段），最后一段才分出胜负。
         所以主卡是「第 total 段」，展开区里是它前面的第 1…段 —— 反过来标会让人以为
         平局是「续战」而结果才是第一场。 */
      const card = renderCard(x, seqText + ' · 第 ' + total + ' 段');

      const wrap = U.el('div', { class: 'bl2-chain' });
      const more = U.el('div', { class: 'bl2-chain-more' });
      more.hidden = true;
      /* 展开区里按时间**倒序**显示（与整个列表「新的在上」保持一致），
         但段号仍是时间顺序（第 1 段 = 最早那一段）。 */
      segs.map(function (sg, i) { return { sg: sg, no: i + 1 }; })
        .reverse()
        .forEach(function (item) {
          const sc = renderCard(item.sg, '第 ' + item.no + ' 段');
          sc.classList.add('is-seg');
          more.appendChild(sc);
        });

      let open = false;
      const btn = U.el('button', {
        class: 'bl2-chain-toggle',
        text: '展开前面 ' + segs.length + ' 段平局',
        onclick: function (e) {
          e.stopPropagation();
          open = !open;
          more.hidden = !open;
          btn.textContent = open ? '收起平局段' : ('展开前面 ' + segs.length + ' 段平局');
        }
      });
      /* 这一整场（所有段）加起来拿了多少武勋：结果卡只标末段的，
         续战几场下来累计的武勋容易被低估，这里在标题栏补个合计。 */
      const totalWuxun = (x.me && x.me.wuxun ? x.me.wuxun : 0)
        + segs.reduce(function (s, sg) { return s + (sg.me && sg.me.wuxun ? sg.me.wuxun : 0); }, 0);
      wrap.appendChild(U.el('div', { class: 'bl2-chain-bar' }, [
        U.el('i', { class: 'bl2-chain-tag', text: '完整一场' }),
        U.el('span', {
          class: 'bl2-chain-note',
          text: '共 ' + (segs.length + 1) + ' 段（前面 ' + segs.length + ' 段打平后接着打），胜负以最后一段为准'
        }),
        totalWuxun > 0 ? U.el('span', {
          class: 'bl2-chain-wuxun',
          title: '这场所有段（含平局续战段）加起来获得的武勋合计',
          text: '武勋合计 ' + U.fmtInt(totalWuxun)
        }) : null,
        btn
      ]));
      wrap.appendChild(card);
      wrap.appendChild(more);
      return wrap;
    }

    function renderPage() {
      body.innerHTML = '';
      const slice = shown.slice(page * BATT_PER_PAGE, (page + 1) * BATT_PER_PAGE);
      if (!slice.length) {
        body.appendChild(U.el('div', { class: 'hint', text: '这套阵容没有可展示的对战记录。' }));
        return;
      }
      // 一场完整战斗一张卡，场号用「发生顺序」（第 1 场 = 最早），与游戏内一致；
      // 同场的平局续战段收在卡片里，点按钮才展开
      slice.forEach(function (x) {
        body.appendChild(renderChain(x, '第 ' + (x.__seqNo || 1) + ' 场'));
      });
    }

    function renderPager() {
      pager.innerHTML = '';
      pager.appendChild(U.el('button', {
        class: 'bl-btn', text: '上一页', disabled: page === 0 ? 'disabled' : null,
        onclick: function () { if (page > 0) { page--; renderPage(); renderPager(); body.scrollTop = 0; } }
      }));
      pager.appendChild(U.el('span', {
        class: 'bl-page',
        /* 把账目写清楚：计入统计的场次 + 折叠起来的平局续战段 + 未过筛选的场次 */
        text: (page + 1) + ' / ' + totalPages + '  （共 ' + list.length + ' 场'
          + '：计入统计 ' + Math.max(0, list.length - hidden) + ' 场'
          + (segCnt ? ' · 另有 ' + segCnt + ' 段平局续战已折进所属那场' : '')
          + (hidden ? ' · 未过筛选 ' + hidden + ' 场' : '') + '）'
      }));
      pager.appendChild(U.el('button', {
        class: 'bl-btn', text: '下一页', disabled: page >= totalPages - 1 ? 'disabled' : null,
        onclick: function () { if (page < totalPages - 1) { page++; renderPage(); renderPager(); body.scrollTop = 0; } }
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
        o.titleText
          ? U.el('b', { text: o.titleText })
          : U.el('span', {}, [
              U.el('b', { text: playerName }),
              U.el('span', { text: ' · ' }),
              U.el('span', {}, [U.compWithTroop(comp.display, comp.troopSig)])
            ])
      ]),
      U.el('div', { class: 'bl2-sum' }, summary),
      U.el('button', { class: 'bl-close', text: '×', title: '关闭（Esc）', onclick: close })
    ]));
    // 连赢证据等场景：在战报上方补一条说明（这一波是几连、累计武勋多少）
    if (o.note) panel.appendChild(U.el('div', { class: 'bl-note' }, [U.el('span', { text: o.note })]));
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
        /* 指向性标签：标签上的百分比一律是**打它的胜率**（克制口径），占比放进悬停说明，
           免得把「50% 的场次在打它」误读成「对它胜率 50%」。 */
        c.sniper ? U.el('span', {
          class: 'pc-sniper kind-' + c.sniper.kind + (c.sniper.strong ? ' is-strong' : ''),
          title: '这套队伍 ' + c.sniper.total + ' 场里有 ' + c.sniper.n + ' 场打的是「' + c.sniper.display +
            '」（占它 ' + U.fmtPct(c.sniper.share, 0) + '），打它的胜率 ' + U.fmtPct(c.sniper.rate, 0) +
            '，属于' + c.sniper.levelLabel +
            (c.sniper.n < 12 ? '（样本只有 ' + c.sniper.n + ' 场，结论仅供参考）' : '') +
            '；这 ' + c.sniper.n + ' 场里 ' + U.fmtPct(c.sniper.atkRatio, 0) + ' 是他主动进攻 —— ' +
            (c.sniper.kind === 'counter'
              ? (c.sniper.why === 'forced' ? '打它很稳，但他很少主动去挑，多半是对方撞上来吃亏'
                : '专挑它、而且真打得过，是手操抓克制')
              : c.sniper.kind === 'focus' ? '只是常打这一套，胜率上是均势，谈不上克制'
                : (c.sniper.why === 'forced' ? '主要是被对方追着打，躲不掉，不是他在送'
                  : '盯着一个克自己的队伍还主动去撞，更像刷分 / 做任务')),
          text: (c.sniper.via === 'run'
            ? '⚠ 抓克制 · 连打 ' + c.sniper.display + ' ' + c.sniper.n + ' 场'
            : (c.sniper.kind === 'counter'
              ? (c.sniper.strong ? '⚠ 抓克制 · 几乎只打 ' : '⚠ 手操抓克制 · 克 ')
              : c.sniper.kind === 'focus' ? '常打 ' : '⚠ 送分 · 专撞 ') +
              c.sniper.display + ' ' + U.fmtPct(c.sniper.rate, 0))
        }) : null,
        U.el('span', { text: c.n + ' 场' }),
        U.el('span', { class: 'pc-wl', text: c.winLo + ' 胜 ' + (c.loss || 0) + ' 负' + (c.draw ? ' ' + c.draw + ' 平' : '') }),
        U.el('span', { style: { color: U.rateColor(c.rate) }, text: '胜率 ' + U.fmtPct(c.rate, 0) }),
        // 小样本保护：1 场 1 胜显示 100% 会误导
        c.n < 5 ? U.el('span', { class: 'pc-weak', text: '样本少' }) : null,
        (c.fullN && c.fullN > c.n)
          ? U.el('span', { class: 'pc-more', title: '有对局被筛选条件排除，关闭「红度对等」等条件后可见', text: '另 ' + (c.fullN - c.n) + ' 场被筛选排除' })
          : null,
        // 同场续战：已并入所属的那一场，与「被筛选排除」不是一回事
        (c.childN && c.childN > 0)
          ? U.el('span', {
            class: 'pc-child',
            title: '这些是同一场交战的续战段（游戏用「父战报」归属），已并进所属那一场一起统计；不是被筛选条件排除的',
            text: '另 ' + c.childN + ' 段续战已并入'
          })
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
    // listHost 原本是滚动容器（.ally-list）。这里把它改造成两层结构：
    //   listHost（固定，不滚动）
    //     ├─ .pf-bar      筛选栏（固定在顶部）
    //     └─ .pf-scroll   成员列表（独立滚动 → 滚动条只出现在列表旁边）
    // 这样筛选栏不再需要 sticky，滚动条也不会长到筛选栏右边。
    listHost.classList.remove('ally-list');
    listHost.classList.add('ally-list', 'pf-host');   // 保留 ally-list 的边框与宽度；滚动交给 pf-scroll
    const scroll = U.el('div', { class: 'pf-scroll' });
    listHost.appendChild(scroll);
    this.listHost = listHost;
    this.scrollHost = scroll;      // 成员项 / 空提示插到这里
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
      this.resetHost();
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
      this.resetHost();
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
    Array.prototype.slice.call(this.scrollHost.querySelectorAll('.ally-item, .hint')).forEach(function (n) { n.remove(); });
    if (!list.length) {
      this.scrollHost.appendChild(U.el('div', { class: 'hint', style: { padding: '12px 4px' }, text: '没有符合筛选条件的玩家。' }));
      this.scrollHost.scrollTop = 0;
      return;
    }
    this.renderItems(list);
    // 列表 DOM 被重建过，选中高亮要补回来（否则一改筛选左侧高亮就丢了）
    if (this.selected) this.markActive(this.selected);
    // 筛选条件变了：列表从头看
    this.scrollHost.scrollTop = 0;
  };

  /** 只做列表高亮，不重绘详情 */
  PlayerView.prototype.markActive = function (name) {
    const host = this.scrollHost;
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

    // 筛选栏挂到 listHost（固定区，在 scrollHost 之上）
    this.listHost.insertBefore(bar, this.scrollHost);
  };

  /** 重建两层结构：固定区（listHost）+ 独立滚动区（scrollHost） */
  PlayerView.prototype.resetHost = function () {
    this.listHost.innerHTML = '';
    this.scrollHost = U.el('div', { class: 'pf-scroll' });
    this.listHost.appendChild(this.scrollHost);
  };

  PlayerView.prototype.renderList = function () {
    const self = this;
    this.resetHost();
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
          p.avgRed === null ? null : U.el('span', { text: '均红 ' + p.avgRed.toFixed(1) }),
          // 列表就能看出这个人的指向性习惯；徽章文案按「是不是真克制」区分
          (p.snipers && p.snipers.length) ? (function () {
            const c = p.snipers.filter(function (x) { return x.sniper.kind === 'counter'; })[0] || p.snipers[0];
            const s = c.sniper;
            return U.el('span', {
              class: 'ai-sniper kind-' + s.kind,
              title: '他的 ' + c.display + ' 有 ' + U.fmtPct(s.share, 0) + ' 的场次在打「' + s.display +
                '」，打它胜率 ' + U.fmtPct(s.rate, 0) + '（' + s.levelLabel + '）',
              text: s.kind === 'counter' ? '⚠ 抓克制' : (s.kind === 'focus' ? '常打某队' : '⚠ 专撞被克队')
            });
          })() : null
        ])
      ]);
      item.addEventListener('click', function () { self.select(p.name); });
      self.scrollHost.appendChild(item);
    });
  };

  PlayerView.prototype.select = function (name) {
    this.selected = name;
    this.markActive(name);
    const p = this.data.players.filter(function (x) { return x.name === name; })[0];
    if (p) this.renderDetail(p);
    // 切换玩家后详情区从头看
    U.scrollTopAll(this.detailHost);
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
      })(), '放宽左侧筛选条件可看到'),
      metric('同场续战', (function () {
        let child = 0;
        p.compList.forEach(function (c) { child += (c.childN || 0); });
        return child + ' 段';
      })(), '同一场交战的续战段，已并入所属那一场统计')
    ]));

    /* ---- 他的作战习惯（总结成「怎么应付他」） ---- */
    const habitSec = section('他的作战习惯',
      '从对手分布、出动时段、惯用阵型与队伍集中度看这个人怎么打，用来决定怎么应付他');
    {
      const T = function (s) { return U.el('span', { text: s }); };
      const hl = function (s, cls) { return U.el('span', { class: cls || 'ac-strong', text: s }); };
      const row = function (k, kids, cls) {
        return U.el('div', { class: 'hb-row' + (cls ? ' ' + cls : '') }, [
          U.el('b', { class: 'hb-k', text: k }),
          U.el('span', { class: 'hb-v' }, kids)
        ]);
      };

      // ① 指向性 × 胜率：真克制 / 只是常打 / 盯着被克的打，三种要分开说
      if (p.snipers && p.snipers.length) {
        // 优先展示「真抓克制」的那种；没有就展示最集中的那条
        const counter = p.snipers.filter(function (c) { return c.sniper.kind === 'counter'; })[0] || p.snipers[0];
        const s = counter.sniper;
        // 成因：他主动去撞 vs 被对方追着打 —— 同样「专打某队」，含义完全不同
        const why = s.why === 'self'
          ? T('（这 ' + s.n + ' 场里 ' + U.fmtPct(s.atkRatio, 0) + ' 是他主动进攻，是自己找上门）')
          : s.why === 'forced'
            ? T('（这 ' + s.n + ' 场里只有 ' + U.fmtPct(s.atkRatio, 0) + ' 是他主动进攻，多半是被对方追着打，躲不掉）')
            : T('（主动进攻占 ' + U.fmtPct(s.atkRatio, 0) + '，主动被动都有）');
        const shrinkNote = s.n < 12 ? T('〔样本只有 ' + s.n + ' 场，结论仅供参考〕') : null;
        // 连续型：把「哪几场」标出来，用户可以自己翻到战报核对（浮层是分页的）
        const runNote = (s.via === 'run' && s.runFrom)
          ? T('〔连续段：' + fmtTime(s.runFrom) + ' ~ ' + fmtTime(s.runTo) + '，共 ' + s.run + ' 场，每一场都是同一个对手〕')
          : null;
        const head = s.kind === 'counter'
          ? [T('他的 '), hl(counter.display, 'ac-comp'), T(' 打 '), hl(s.display, 'ac-comp'),
            T(' 很稳：这套 ' + s.total + ' 场里有 ' + s.n + ' 场打的是它（占 ' + U.fmtPct(s.share, 0) +
              '），打它胜率 '), hl(U.fmtPct(s.rate, 0), 'ac-good'), T('（' + s.levelLabel + '）——' +
              (s.why === 'forced'
                ? '不过他很少主动去挑（只有 ' + U.fmtPct(s.atkRatio, 0) + ' 是主动进攻），更多是对方撞上来吃亏：你要出这套，得先想好怎么破它'
                : '他会手动挑目标，别指望他"随便撞上你"')), why, runNote, shrinkNote]
          : s.kind === 'focus'
            ? [T('他的 '), hl(counter.display, 'ac-comp'), T(' 常打 '), hl(s.display, 'ac-comp'),
              T('（' + s.n + '/' + s.total + ' 场），但打它只有 '), hl(U.fmtPct(s.rate, 0)), T('，属于' + s.levelLabel +
                '——只是爱打这一套，不算克制；应对上按均势准备即可'), why, runNote, shrinkNote]
            : [T('注意：他的 '), hl(counter.display, 'ac-comp'), T(' 有 ' + s.n + '/' + s.total + ' 场都在打 '),
              hl(s.display, 'ac-comp'), T('，而打它只有 '), hl(U.fmtPct(s.rate, 0), 'ac-warn'),
              T('（' + s.levelLabel + '）——' +
                (s.why === 'forced' ? '但那是被对方追着打，不是他在送；把对方那套挡住就行' : '还在主动去撞，更像刷分 / 做任务')),
              why, runNote, shrinkNote];
        habitSec.appendChild(row(s.kind === 'counter' ? '⚠ 抓克制' : (s.kind === 'focus' ? '常打某队' : '⚠ 专撞被克队'), head,
          s.kind === 'feeding' ? 'hb-sniper is-warn' : (s.kind === 'focus' ? '' : 'hb-sniper')));
        const rest = p.snipers.filter(function (c) { return c !== counter; });
        if (rest.length) {
          habitSec.appendChild(row('还有', [
            T(rest.slice(0, 4).map(function (c) {
              return c.display + (c.sniper.kind === 'counter' ? ' 克 ' : (c.sniper.kind === 'focus' ? ' 常打 ' : ' 被克于 ')) +
                c.sniper.display + '（' + U.fmtPct(c.sniper.rate, 0) + '）';
            }).join('、'))
          ]));
        }
      } else {
        habitSec.appendChild(row('对手分布', [
          T('没有"只打某一种队伍"的迹象，撞上谁打谁——应对上不用特意躲他的队伍')
        ]));
      }

      // ② 主力队伍
      const main = p.compList[0];
      if (main) {
        habitSec.appendChild(row('主力队伍', [
          T('最常出 '), hl(main.display, 'ac-comp'),
          T('（' + main.n + ' 场 · 占他 ' + U.fmtPct(main.n > 0 && p.n ? main.n / p.n : 0, 0) +
            '，胜率 ' + U.fmtPct(main.rate, 0) + '）')
        ]));
      }

      // ③ 整体对手集中度
      const fs = p.foeStat;
      if (fs && fs.total) {
        habitSec.appendChild(row('对手面', [
          T('一共打过 '), hl(String(fs.kinds)), T(' 种不同队伍；最集中的是对 '),
          hl(fs.topDisplay, 'ac-comp'),
          T('（' + fs.topN + '/' + fs.total + ' = ' + U.fmtPct(fs.topShare, 0) + '）' +
            (fs.kinds <= 4 ? '——可选范围很窄，多半在盯特定目标' : '——面对的主流队伍比较杂'))
        ]));
      }

      // ④ 惯用阵型
      if (p.formations && p.formations.length) {
        habitSec.appendChild(row('惯用阵型', [
          T(p.formations.slice(0, 3).map(function (f) {
            return f.name + ' ' + U.fmtPct(p.n ? f.n / p.n : 0, 0);
          }).join(' · '))
        ]));
      }

      // ⑤ 出动时段
      if (p.peakHour) {
        const hours = p.hours.filter(function (h) { return h.n > 0; })
          .sort(function (a, b) { return b.n - a.n; })
          .map(function (h) { return h.label + ' ' + U.fmtPct(p.hourTotal ? h.n / p.hourTotal : 0, 0); });
        habitSec.appendChild(row('出动时段', [
          T('主要在 '), hl(p.peakHour), T('（' + hours.slice(0, 2).join(' · ') + '）——错开这个时段，或者就在这个时段堵他')
        ]));
      }

      // ⑥ 换队与养成
      habitSec.appendChild(row('队伍与养成', [
        T('一共用了 '), hl(p.compList.length + ' 套队伍'),
        T((p.compList.length >= 6 ? '（换队很勤，按场次盯不过来的就抓他的主力那两套）' : '（队伍集中，针对他一两套即可）')),
        p.avgRed === null ? null : T('；平均红度 ' + p.avgRed.toFixed(1))
      ]));
    }
    host.appendChild(habitSec);

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
          U.el('span', { style: { color: U.counterLevel(top.expRate).color }, text: U.fmtPct(top.expRate) }),
          hl('（' + U.counterLevel(top.expRate).label + '）', 'ac-note'),
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
    openBattleLog: openBattleLog,
    collectBattles: collectBattles,     // 同盟分析的玩家列表也复用这个战报浮层
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
