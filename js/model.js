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
    isFull: isFull
  };
})(window.AC);
