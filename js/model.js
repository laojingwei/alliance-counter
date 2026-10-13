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
       block —— 主战报（该次交战的最终结果）
       child —— 挂在主战报下的分战报（打平续战段 / 团战里各支部队的对战）

     串链判据（以新数据为准）：
       主判据 = 父战报关系。child.parentBattleId 直接指向父级 battleId，
       这是游戏给的权威结构，实测匹配率 99.4%——旧版因为拿「战斗编号」
       （co_ 前缀）当 ID 对不上，才退化成按兵力猜测，这里不再需要。

     注意：同一条 block 下的多个 child 可能是不同部队的团战分战报
     （实测同父下攻方有多个不同玩家），所以合并时：
       主段      = 链内的 block（开战兵力 / 身份取它）
       时间末段  = 胜负与剩余兵力的来源
       伤亡/回合/武勋 = 各段累计
     找不到父级的孤儿 child 保持独立，由 analyzer 的统计口径过滤掉，
     不参与「一次出战 = 1 场」的计数，但在明细里仍可见。 */

  /**
   * 按父战报关系把战报串成链。
   * @returns {Array<Array>} 每条链 [主段, 子段...]（链内按时间正序），单段链也保留
   */
  function linkChains(battles) {
    const ownerOf = new Map();          // id -> 所属链
    const chains = [];

    battles.forEach(function (b) {
      const c = [b];
      chains.push(c);
      ownerOf.set(b.id, c);
    });

    battles.forEach(function (b) {
      if (!b.parent) return;
      const parentChain = ownerOf.get(b.parent);
      const own = ownerOf.get(b.id);
      if (!parentChain || parentChain === own) return;
      // 从自己的链挪进父链
      own.splice(own.indexOf(b), 1);
      parentChain.push(b);
      ownerOf.set(b.id, parentChain);
    });

    // 链内按时间排序；链首优先放 block（作为合并时的主段）
    chains.forEach(function (c) {
      c.sort(function (a, b) {
        const ta = a.recordType === 'child' ? 1 : 0;
        const tb = b.recordType === 'child' ? 1 : 0;
        if (ta !== tb) return ta - tb;             // block 在前
        return (a.ts || 0) - (b.ts || 0);          // 再按时间
      });
    });
    return chains;
  }

  /** 一条链合并为一次完整战斗：主段定身份与开战兵力，末段定胜负与剩余，伤亡/回合/武勋累计 */
  function mergeChain(chain) {
    if (chain.length === 1) return chain[0];
    const main = chain.find(function (b) { return b.recordType !== 'child'; }) || chain[0];
    const last = chain.reduce(function (a, b) { return (b.ts || 0) >= (a.ts || 0) ? b : a; }, chain[0]);

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
      chainSegs: chain.length,                               // 这次交战一共几段
      childIds: chain.filter(function (b) { return b !== main; })
                     .map(function (b) { return b.id; })
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
