window.AC = window.AC || {};

/* ============================================================
   战报记录规范化
   ------------------------------------------------------------
   数据源：sanmou-viewer 导出的 window.AC.battleData（结构化 JSON）。
   本模块只负责：
     - 阵容字符串标准化（武将书写顺序无关，排序归并）
     - 数值/时间解析
     - 连战（打平续战）链识别与合并

   注：早期版本的 CSV 解析（toBattle / battleToRow / CSV_HEADER）已移除，
   数据统一由 sanmou-viewer 提供，不再需要文本解析与表头映射。
   ============================================================ */
(function (AC) {
  'use strict';

  /* ---------- 阵容字符串 ---------- */

  const SEP = /\s*[\/、,;|+＋]\s*/;

  /** 拆出武将列表（保序、去重） */
  function splitUnits(str) {
    if (!str) return [];
    const seen = {};
    const out = [];
    String(str).split(SEP).forEach(function (u) {
      const name = u.replace(/[（）()\s]/g, '').trim();
      if (!name || name === '-' || name === '无') return;
      if (seen[name]) return;
      seen[name] = 1;
      out.push(name);
    });
    return out;
  }

  /** 阵容 Key：武将排序后拼接，保证「A/B/C」与「C/A/B」视为同一阵容 */
  function compKey(units) {
    return units.slice().sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; }).join(' / ');
  }

  /** 原始写法归一（保留顺序，仅清理空格），用于展示 */
  function compDisplay(units) {
    return units.join(' / ');
  }

  /* ---------- 数值 ---------- */

  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const s = String(v).replace(/[,\s%]/g, '');
    if (s === '' || s === '-') return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  function parseTime(v) {
    if (!v) return { text: '', ts: null };
    const raw = String(v).trim();
    let s = raw.replace(' ', 'T');
    let ts = Date.parse(s);
    if (isNaN(ts)) ts = Date.parse(s.replace(/-/g, '/'));
    return { text: raw, ts: isNaN(ts) ? null : ts };
  }

  /** 该战斗在指定维度下的分组键 */
  function groupKey(battle, side, dim) {
    const s = battle[side];
    if (!s) return '';
    return dim === 'formation' ? (s.formation || '未知阵') : (s.key || '未知阵容');
  }

  /* ---------- 多段战报 -> 一次完整战斗 ----------
     Sanmou 战报的两级结构：
       block —— 交战的最终战报（分出胜负的那一段）
       child —— 挂在主战报下的分战报

     【判据：只有打平才会续战】（按游戏机制）
     一场战斗从开打打到分出胜负为止。打平意味着「这场还没完，接着打」，
     所以平局段和它的后续段属于同一场战斗，最后一段才分出胜负。

     实测佐证（10,054 条真实数据）：
       · 859 条平局记录里 844 条是 child（block/draw 只有 15 条）——
         平局确实只作为「中间段」出现，与上面的机制一致。
       · 早先误把「兵力衔接」当续战判据：兵力衔接的 6,226 对相邻段里，
         95.3% 的前一段其实是**分出胜负**的 —— 那是打赢之后接着打下一场
         （连战），不是同一场战斗；真正「前一段是平局」的只占 4.7%。
       · 按父战报整波合并更糟：它标的是「同一波团战」（同一时间地点的多方
         混战），实测 77% 的段兵力根本对不上，还出现过 4,907 例
         「段里赢了、所属场次却算输」。

     所以串链判据 = 同一玩家 + 同一阵容 + **前一段是平局** + 时间相邻（≤10 分钟）。
     平局之后的下一段（对手可能换人，实测同一波里对手会换来换去）并进同一条链。

     合并时：最早一段定身份与开战兵力，末段定胜负与剩余，伤亡/回合/武勋累计。
     其余每一条都各自算一场真实交战，由 analyzer 计入统计。 */

  /** 同一场战斗内相邻两段的间隔上限：打平之后十几秒内就会接着打 */
  const CHAIN_GAP_MS = 10 * 60 * 1000;

  /**
   * 战斗中伤兵不恢复，所以下一段的开战兵力应约等于上一段的**剩余**兵力。
   * （战斗结束后的连战才会把伤兵补回来：那种情况开战 = 剩余 + 伤兵。）
   * 用「剩余」而不是「剩余+伤兵」判定，正好能把「打平后撤退休整、补满兵
   * 再来」那种新战斗挡在外面 —— 实测它在平局相邻对里占了一半以上。
   */
  function closeOrigin(a, b) {
    const x = a || 0, y = b || 0;
    if (x <= 0 || y < 0) return false;
    return Math.abs(x - y) <= Math.max(500, x * 0.05);
  }

  /**
   * 是不是同一对玩家。同一场战斗里**双方队伍不会变**（变的只有兵力），
   * 所以续战段一定满足「A 方还是那个玩家、D 方也还是那个玩家」。
   * 注意别拿阵容字符串比：某个武将打光后可能就不在记录里了，字符串会不一样。
   */
  function samePair(a, b) {
    return !!(a && b && a.atk && b.atk && a.def && b.def
      && a.atk.player && b.atk.player
      && a.atk.player === b.atk.player
      && a.def.player === b.def.player);
  }

  /** 相邻两段是否真的是同一场战斗的连续段（双方玩家不变 + 前一段平局 + 兵力接得上） */
  function chainedPair(prev, cur) {
    if (!prev || !cur || prev.result !== 'draw') return false;
    if (!samePair(prev, cur)) return false;
    /* 双方都要接得上才算同一场：真实续战里「开战兵力 = 上一段剩余」对两边同时成立
       （实测 703 处续战 p50~p99 的衔接误差全是 0）；而「同一对玩家打完一场后各自
       换一支部队再打下一场」时，只有一方的兵力会因 5% 容差偶然落进范围
       （实测 3 处全是这种：如 33000→30295 剩 30295，下一场守方开战 31768，差 1473，
       恰在容差 1588 内，但攻方 1208 vs 26622 完全接不上 —— 明显是两场独立的战斗）。 */
    let checked = 0;
    for (let k = 0; k < 2; k++) {
      const which = k === 0 ? 'atk' : 'def';
      const ps = prev[which], cs = cur[which];
      if (!ps || !cs) continue;
      if (ps.remain === null || ps.remain === undefined) continue;
      checked++;
      if (!closeOrigin(cs.origin, ps.remain)) return false;
    }
    return checked > 0;
  }

  /**
   * 把战报串成「一次完整战斗」：一次战斗 = 若干平局段 + 最后分出胜负的一段。
   * 按「同一玩家 + 同一阵容」的时间序列，只有前一段是平局才续上去。
   * @returns {Array<Array>} 每条链（链内按时间正序），单段链也保留
   */
  function linkChains(battles) {
    /* 按时间处理；**同秒的按双方总兵力降序** —— 数据里同秒记录的先后是乱的（实测有
       「结果段排在平局段之前」的情况），而一场战斗里兵力只减不增，所以兵力多的那一段
       一定在前面。顺序错了会让续战段找不到它的上一段，整场就被拆成两场。 */
    const sorted = battles.slice().sort(function (a, b) {
      if ((a.ts || 0) !== (b.ts || 0)) return (a.ts || 0) - (b.ts || 0);
      const fa = (a.atk.origin || 0) + (a.def.origin || 0);
      const fb = (b.atk.origin || 0) + (b.def.origin || 0);
      return fb - fa;
    });
    const ownerOf = new Map();          // id -> 所属链
    const chains = [];
    const lastOf = new Map();           // 「玩家|阵容」-> 该部队的上一条战报

    /** 把 guest 所在的链并进 host 所在的链 */
    function union(host, guest) {
      const hc = ownerOf.get(host.id);
      const gc = ownerOf.get(guest.id);
      if (!hc || !gc || hc === gc) return;
      for (let i = 0; i < gc.length; i++) { hc.push(gc[i]); ownerOf.set(gc[i].id, hc); }
      gc.length = 0;
    }

    sorted.forEach(function (b) {
      const own = [b];
      chains.push(own);
      ownerOf.set(b.id, own);

      for (let k = 0; k < 2; k++) {
        const which = k === 0 ? 'atk' : 'def';
        const s = b[which];
        if (!s || !s.player) continue;
        /* 键里带上**对手玩家**：同一秒可能有对「不同人」的几场交战，兵力还挨得很近
           （实测 15229 与 15193 只差 36），只按「我方」建键会让它们互相顶掉，
           真正的续战段反而接不上。同一场战斗里双方队伍不变，所以对手也是稳定的。 */
        const foeSide = which === 'atk' ? b.def : b.atk;
        const key = s.player + '|' + ((foeSide && foeSide.player) || '') + '|'
          + (s.key || s.compRaw || '');
        const prev = lastOf.get(key);
        lastOf.set(key, b);
        if (!prev) continue;
        const prevSide = prev[which];
        if (!prevSide) continue;
        /* 同一场战斗里双方队伍不变，先确认这一点 */
        if (!samePair(prev, b)) continue;
        const gap = (b.ts || 0) - (prev.ts || 0);
        if (gap > CHAIN_GAP_MS) continue;
        /* 战斗中伤兵不恢复：开战 ≈ 上一段剩余，而且**只有打平才续战**。
           同秒的记录在数据里顺序不定（实测有「平局段排在结果段之后」的情况），
           所以两个方向都试，并各自检查「谁才是打平的那一段」。 */
        if (gap >= 0 && prev.result === 'draw' && closeOrigin(s.origin, prevSide.remain)) {
          union(prev, b);                       // 正常：prev 打平，本段接在它后面
        } else if (gap <= 0 && b.result === 'draw' && closeOrigin(prevSide.origin, s.remain)) {
          union(b, prev);                       // 反序：本段才是打平的那一段
        }
      }
    });

    const out = chains.filter(function (c) { return c.length > 0; });
    out.forEach(function (c) {
      if (c.length < 2) return;
      c.sort(function (a, b) {
        if ((a.ts || 0) !== (b.ts || 0)) return (a.ts || 0) - (b.ts || 0);
        // 同秒：战斗中双方总兵力只减不增，兵力多的排在前面才与实际顺序一致
        const fa = (a.atk.origin || 0) + (a.def.origin || 0);
        const fb = (b.atk.origin || 0) + (b.def.origin || 0);
        return fb - fa;
      });
    });

    /* 复核：union 的传递性可能把不相干的两波并进同一条链（实测约 6%，例如同一个
       玩家在几秒内打了两波、两波又被中间记录串起来）。这里按「同一部队 + 前一段
       平局 + 兵力接得上」逐段检查，接不上的地方断开。 */
    const cleaned = [];
    out.forEach(function (c) {
      let cur = [c[0]];
      for (let i = 1; i < c.length; i++) {
        if (chainedPair(cur[cur.length - 1], c[i])) cur.push(c[i]);
        else { cleaned.push(cur); cur = [c[i]]; }
      }
      cleaned.push(cur);
    });
    return cleaned.filter(function (c) { return c.length > 0; });
  }

  /** 一条链合并为一次完整战斗：最早一段定身份与开战兵力，末段定胜负与剩余，伤亡/回合/武勋累计 */
  function mergeChain(chain) {
    if (chain.length === 1) return chain[0];
    const main = chain[0];                 // 链内按时间正序：最早一段 = 这场战斗的开局
    const last = chain[chain.length - 1];  // 末段 = 分出胜负的那一段

    function mergeSide(which) {
      const f = main[which], l = last[which];
      const sum = function (fn) {
        return chain.reduce(function (s, b) { return s + (b[which] ? (fn(b[which]) || 0) : 0); }, 0);
      };
      const out = Object.assign({}, f, {
        origin: f.origin,                                    // 开战兵力 = 主段
        remain: l.remain,                                    // 剩余兵力 = 时间最末段
        wounded: sum(function (s) { return s.wounded; }),
        dead: sum(function (s) { return s.dead; }),
        wuxun: sum(function (s) { return s.wuxun; })
      });
      // 逐武将：按名对齐，origin 取主段、remain 取末段、伤亡累计
      if (f.heroes && f.heroes.length) {
        const lastByName = new Map();
        (l.heroes || []).forEach(function (h) { if (h.name) lastByName.set(h.name, h); });
        out.heroes = f.heroes.map(function (h) {
          const lh = lastByName.get(h.name);
          let w = 0, d = 0;
          chain.forEach(function (b) {
            const hs = b[which].heroes || [];
            for (let i = 0; i < hs.length; i++) {
              if (hs[i].name === h.name) { w += hs[i].wounded || 0; d += hs[i].dead || 0; break; }
            }
          });
          return Object.assign({}, h, {
            remain: lh ? lh.remain : h.remain,
            origin: h.origin,
            wounded: w, dead: d
          });
        });
      }
      return out;
    }

    return Object.assign({}, main, {
      id: main.id,
      ts: main.ts, time: main.time,
      result: last.result, resultText: last.resultText,      // 胜负取时间最末段
      round: chain.reduce(function (s, b) { return s + (b.round || 0); }, 0),
      atk: mergeSide('atk'),
      def: mergeSide('def'),
      chainSegs: chain.length,                               // 这次战斗一共几段
      childIds: chain.filter(function (b) { return b !== main; })
                     .map(function (b) { return b.id; }),
      /* 原始各段（链内按时间正序，末段是分出胜负的那一段）。
         战报浮层用它把平局段收进可展开的盒子里，不再单独铺开。 */
      segs: chain.slice()
    });
  }

  /**
   * 把多段战报合并为一次完整战斗。
   * @returns {Object} { list: 合并后的列表, merged: 合并掉的链数, rawSegs: 原始段数 }
   */
  function mergeChains(battles) {
    const chains = linkChains(battles);
    const multi = chains.filter(function (c) { return c.length > 1; });

    const mergedByMain = new Map();
    const drop = new Set();
    multi.forEach(function (c) {
      const m = mergeChain(c);
      mergedByMain.set(m.id, m);
      c.forEach(function (b) { drop.add(b.id); });
    });

    const out = [];
    const seen = new Set();
    battles.forEach(function (b) {        // 保持原始相对顺序（合并体出现在主段位置）
      if (!drop.has(b.id)) { out.push(b); return; }
      const m = mergedByMain.get(b.id);
      if (m && !seen.has(m.id)) { seen.add(m.id); out.push(m); }
    });
    return { list: out, merged: multi.length, rawSegs: battles.length };
  }

  /** 阵容是否满编（3 人） */
  function isFull(side) { return side.size >= 3; }

  AC.model = {
    splitUnits: splitUnits,
    compKey: compKey,
    compDisplay: compDisplay,
    num: num,
    parseTime: parseTime,
    groupKey: groupKey,
    isFull: isFull,
    linkChains: linkChains,
    mergeChain: mergeChain,
    mergeChains: mergeChains
  };
})(window.AC);
