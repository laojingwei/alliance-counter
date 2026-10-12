window.AC = window.AC || {};

/* ============================================================
   战报记录规范化
   - 阵容字符串标准化（武将书写顺序无关，排序归并）
   - 数值/等级/时间解析
   - 生成稳定去重 ID
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;

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
    const s = String(v).replace(/[,\s%]/g, '');
    if (s === '' || s === '-') return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  function levels(v) {
    if (!v) return [];
    return String(v).split(SEP).map(function (x) { return num(x); }).filter(function (x) { return x !== null; });
  }

  function parseTime(v) {
    if (!v) return { text: '', ts: null };
    let s = String(v).trim().replace(' ', 'T');
    let ts = Date.parse(s);
    if (isNaN(ts)) ts = Date.parse(s.replace(/-/g, '/'));
    return { text: String(v).trim(), ts: isNaN(ts) ? null : ts };
  }

  function normResult(v) {
    const s = String(v || '');
    if (/平/.test(s)) return 'draw';
    if (/攻方胜|攻击方胜|攻胜/.test(s)) return 'atk';
    if (/守方胜|防守方胜|守胜/.test(s)) return 'def';
    return 'unknown';
  }

  /* ---------- 单侧归一 ---------- */

  function sideFrom(prefix, row) {
    const compRaw = row[prefix + 'Comp'] || '';
    const units = splitUnits(compRaw);
    const lv = levels(row[prefix + 'Level']);
    const size = units.length || lv.length;
    const origin = num(row[prefix + 'Origin']);
    const remain = num(row[prefix + 'Remain']);
    const wounded = num(row[prefix + 'Wounded']);
    const dead = num(row[prefix + 'Dead']);

    return {
      alliance: (row[prefix + 'Alliance'] || '').trim(),
      player: (row[prefix + 'Player'] || '').trim(),
      formation: (row[prefix + 'Formation'] || '').trim() || '未知阵',
      compRaw: compRaw.trim(),
      comp: compDisplay(units),
      key: compKey(units),
      units: units,
      levels: lv,
      minLevel: lv.length ? Math.min.apply(null, lv) : null,
      size: size,
      wuxun: num(row[prefix + 'Wuxun']),
      remain: remain,
      origin: origin,
      wounded: wounded,
      dead: dead,
      /** 损失率：0 表示毫发无伤，1 表示全灭 */
      lossRate: origin && origin > 0 ? U.clamp(((wounded || 0) + (dead || 0)) / origin, 0, 1) : null
    };
  }

  /**
   * 把 CSV 行对象转成规范战斗记录；无法解析返回 null
   */
  function toBattle(row, batchId) {
    const atk = sideFrom('atk', row);
    const def = sideFrom('def', row);
    if (!atk.units.length && !def.units.length) return null;
    if (!atk.player && !def.player && !atk.compRaw && !def.compRaw) return null;

    const t = parseTime(row.time);
    const id = (row.id || '').trim() ||
      U.hash([row.place || '', t.text, atk.player, def.player, atk.compRaw, def.compRaw].join('|'));

    return {
      id: id,
      batchId: batchId || '',
      place: (row.place || '').trim(),
      time: t.text,
      ts: t.ts,
      result: normResult(row.result || row.winner),
      resultText: (row.result || row.winner || '').trim(),
      round: num(row.round),
      parent: (row.parent || '').trim(),
      streak: num(row.streak),
      streakWuxun: num(row.streakWuxun),
      atk: atk,
      def: def
    };
  }

  /* ---------------- 反序列化：把战斗记录还原成标准列 ---------------- */

  /** 内置示例表使用的标准列（与游戏导出表一致，便于重建与再导入） */
  const CSV_HEADER = [
    '战斗Key', '地点', '时间', '结果', '胜方',
    '攻方同盟', '攻方玩家', '攻方阵型', '攻方阵容', '攻方等级', '攻方武勋', '攻方剩余', '攻方原始兵力', '攻方伤兵', '攻方阵亡',
    '守方同盟', '守方玩家', '守方阵型', '守方阵容', '守方等级', '守方武勋', '守方剩余', '守方原始兵力', '守方伤兵', '守方阵亡',
    '回合', '父战报', '连战场次', '连战武勋'
  ];

  const RESULT_LABEL = { atk: '攻方胜', def: '守方胜', draw: '平局', unknown: '' };
  const WINNER_LABEL = { atk: '攻方', def: '守方', draw: '平局', unknown: '' };

  /** 把规范化战斗记录还原成一行标准列（与 CSV_HEADER 等长） */
  function battleToRow(b) {
    const s = function (v) { return v === null || v === undefined ? '' : v; };
    const side = function (x) {
      return [
        s(x.alliance), s(x.player), s(x.formation), s(x.compRaw),
        x.levels.length ? x.levels.join('/') : '',
        s(x.wuxun), s(x.remain), s(x.origin), s(x.wounded), s(x.dead)
      ];
    };
    const resultText = RESULT_LABEL[b.result] || s(b.resultText);
    const winnerText = WINNER_LABEL[b.result] || '';
    return [s(b.id), s(b.place), s(b.time), resultText, winnerText]
      .concat(side(b.atk), side(b.def), [s(b.round), s(b.parent), s(b.streak), s(b.streakWuxun)]);
  }

  /** 该战斗在指定维度下的分组键 */
  function groupKey(battle, side, dim) {
    const s = battle[side];
    return dim === 'formation' ? (s.formation || '未知阵') : (s.key || '未知阵容');
  }

  /* ---------- 「打平续战」的多段 -> 一次完整战斗 ----------
     游戏里打平会立刻续战，同一次交战因此拆成多段战报（时间只差十几秒、双方兵力首尾衔接）。
     识别只能靠兵力衔接：parent 字段指向的是外部总战报（实测 0 条对得上内部 id），认不出内部链。
     统计按「一次完整战斗」计，明细展示仍保留每一段（战报浮层负责折叠）。 */
  const CHAIN_GAP_MS = 10 * 60 * 1000;

  /** cur 是否是 prev 的续战：双方兵力都接得上，且时间没有倒挂 */
  function chainLinked(prev, cur) {
    const gap = (cur.ts || 0) - (prev.ts || 0);
    if (gap < 0 || gap > CHAIN_GAP_MS) return false;
    const link = function (a, b) {      // a 是后一段、b 是前一段
      return a.origin !== null && a.origin !== undefined &&
        b.remain !== null && b.remain !== undefined && a.origin === b.remain;
    };
    return link(cur.atk, prev.atk) && link(cur.def, prev.def);
  }

  /**
   * 把战报串成「同一次完整战斗」的链。
   * 先按「同一对玩家 + 同一地点」分桶（桶内才可能互为续战），再按时间序贪心衔接；
   * 同秒记录的先后不可靠，接尾之外还会试反向插链首。
   * @returns {Array<Array>} 每条链按时间正序，单段链也保留
   */
  function linkChains(battles) {
    const asc = battles.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    const buckets = new Map();
    asc.forEach(function (b) {
      const k = [b.atk.player, b.def.player].sort().join('|') + '@' + (b.place || '');
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); }
      arr.push(b);
    });

    const chains = [];
    buckets.forEach(function (segs) {
      const active = [];                 // 桶内可能并行着几条互不衔接的链
      segs.forEach(function (s) {
        for (let i = 0; i < active.length; i++) {
          const c = active[i];
          if (chainLinked(c[c.length - 1], s)) { c.push(s); return; }
        }
        for (let i = 0; i < active.length; i++) {
          const c = active[i];
          if (chainLinked(s, c[0])) { c.unshift(s); return; }
        }
        const c = [s];
        active.push(c);
        chains.push(c);
      });
    });
    return chains;
  }

  /** 一条链合并为一次完整战斗：胜负取末段、开战兵力取首段、剩余取末段，伤亡/回合/武勋累计 */
  function mergeChain(chain) {
    if (chain.length === 1) return chain[0];
    const first = chain[0], last = chain[chain.length - 1];

    function mergeSide(which) {
      const f = first[which], l = last[which];
      const sum = function (fn) {
        return chain.reduce(function (s, b) { return s + (b[which] ? fn(b[which]) : 0); }, 0);
      };
      const out = Object.assign({}, f, {
        origin: f.origin,                                    // 开战兵力 = 首段
        remain: l.remain,                                    // 剩余兵力 = 末段
        wounded: sum(function (s) { return s.wounded || 0; }),
        dead: sum(function (s) { return s.dead || 0; }),
        wuxun: sum(function (s) { return s.wuxun || 0; })     // 连战武勋 = 各段之和
      });
      // 逐武将：按名对齐，origin 取首段、remain 取末段、伤亡累计
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

    return Object.assign({}, first, {
      id: first.id,
      ts: first.ts, time: first.time,
      result: last.result, resultText: last.resultText,      // 胜负取最终段
      round: chain.reduce(function (s, b) { return s + (b.round || 0); }, 0),
      atk: mergeSide('atk'),
      def: mergeSide('def'),
      chainSegs: chain.length                                // 这次交战一共几段
    });
  }

  /**
   * 把续战多段合并为一次完整战斗。
   * @returns {Object} { list: 合并后的列表, merged: 合并掉的链数, rawSegs: 原始段数 }
   */
  function mergeChains(battles) {
    const chains = linkChains(battles);
    const multi = chains.filter(function (c) { return c.length > 1; });
    if (!multi.length) return { list: battles.slice(), merged: 0, rawSegs: battles.length };

    const mergedByFirst = new Map();
    const drop = new Set();
    multi.forEach(function (c) {
      mergedByFirst.set(c[0].id, mergeChain(c));
      c.forEach(function (b) { drop.add(b.id); });
    });

    const out = [];
    const seen = new Set();
    battles.forEach(function (b) {        // 保持原始相对顺序（合并体出现在链首位置）
      if (!drop.has(b.id)) { out.push(b); return; }
      const m = mergedByFirst.get(b.id);
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
    parseTime: parseTime,
    normResult: normResult,
    toBattle: toBattle,
    battleToRow: battleToRow,
    CSV_HEADER: CSV_HEADER,
    RESULT_LABEL: RESULT_LABEL,
    WINNER_LABEL: WINNER_LABEL,
    groupKey: groupKey,
    isFull: isFull,
    chainLinked: chainLinked,
    linkChains: linkChains,
    mergeChain: mergeChain,
    mergeChains: mergeChains
  };
})(window.AC);
