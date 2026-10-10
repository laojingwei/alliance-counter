window.AC = window.AC || {};

/* ============================================================
   CSV 解析 + 表头自动映射
   目标：以后换一份导出表（列顺序/列名变化）也能自动识别
   ============================================================ */
(function (AC) {
  'use strict';

  /* ---------- 1. 文本解析（支持引号包裹、引号内换行） ---------- */

  function detectDelimiter(text) {
    const sample = text.slice(0, 6000).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }).slice(0, 5);
    const cands = [',', '\t', ';', '|'];
    let best = ',', bestScore = -1;
    cands.forEach(function (d) {
      const counts = sample.map(function (l) { return l.split(d).length; });
      if (!counts.length) return;
      const avg = counts.reduce(function (a, b) { return a + b; }, 0) / counts.length;
      const variance = counts.reduce(function (a, b) { return a + Math.pow(b - avg, 2); }, 0) / counts.length;
      const score = avg - variance * 2;
      if (avg > 1.5 && score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function parseText(text, delimiter) {
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], cur = '', quoted = false;
    const s = text.replace(/^\uFEFF/, '');

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') { cur += '"'; i++; }
          else quoted = false;
        } else cur += c;
      } else if (c === '"') {
        quoted = true;
      } else if (c === d) {
        row.push(cur); cur = '';
      } else if (c === '\n') {
        row.push(cur); cur = '';
        rows.push(row); row = [];
      } else if (c === '\r') {
        /* 忽略，交给 \n 处理 */
      } else {
        cur += c;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }

    return rows.filter(function (r) {
      return r.some(function (cell) { return String(cell).trim() !== ''; });
    });
  }

  /* ---------- 2. 表头映射 ---------- */

  // 标准字段 -> 可能的列名写法（全部会被归一化后比较）
  const ALIASES = {
    id: ['战斗key', '战斗id', '战报key', '战报id', 'battlekey', 'battleid', 'id', 'key', '记录id'],
    place: ['地点', '坐标', '位置', 'place', 'location', 'pos'],
    time: ['时间', '战斗时间', '日期', 'time', 'datetime', 'date'],
    result: ['结果', '胜负', '战斗结果', 'result', 'outcome'],
    winner: ['胜方', '获胜方', '胜利方', 'winner'],
    round: ['回合', '回合数', 'round', 'rounds'],

    atkAlliance: ['攻方同盟', '攻击方同盟', '攻方联盟', 'attackeralliance', 'atkalliance', 'atkalliance'],
    atkPlayer: ['攻方玩家', '攻击方玩家', '攻方角色', '攻方名字', '攻方', 'attackerplayer', 'atkplayer', 'attacker', 'atkname'],
    atkFormation: ['攻方阵型', '攻方阵法', '攻方阵', 'atkformation', 'attackerformation', 'atkform'],
    atkComp: ['攻方阵容', '攻击方阵容', '攻方队伍', '攻方组合', '攻方配置', 'atkcomp', 'attackerteam', 'atkteam', 'atklineup', 'attackerlineup'],
    atkLevel: ['攻方等级', '攻方级别', 'atklevel', 'attackerlevel', 'atklv'],
    atkWuxun: ['攻方武勋', '攻方功勋', 'atkwuxun', 'atkmerit'],
    atkRemain: ['攻方剩余', '攻方剩余兵力', '攻方余兵', 'atkremain', 'atkleft'],
    atkOrigin: ['攻方原始兵力', '攻方总兵力', '攻方兵力', '攻方原始', 'atkorigin', 'atktotal', 'atktroops'],
    atkWounded: ['攻方伤兵', '攻方受伤', 'atkwounded', 'atkinjured'],
    atkDead: ['攻方阵亡', '攻方死亡', 'atkdead', 'atkkilled'],

    defAlliance: ['守方同盟', '防守方同盟', '守方联盟', 'defenderalliance', 'defalliance'],
    defPlayer: ['守方玩家', '防守方玩家', '守方角色', '守方名字', '守方', 'defenderplayer', 'defplayer', 'defender', 'defname'],
    defFormation: ['守方阵型', '守方阵法', '守方阵', 'defformation', 'defenderformation', 'defform'],
    defComp: ['守方阵容', '防守方阵容', '守方队伍', '守方组合', '守方配置', 'defcomp', 'defenderteam', 'defteam', 'deflineup', 'defenderlineup'],
    defLevel: ['守方等级', '守方级别', 'deflevel', 'defenderlevel', 'deflv'],
    defWuxun: ['守方武勋', '守方功勋', 'defwuxun', 'defmerit'],
    defRemain: ['守方剩余', '守方剩余兵力', '守方余兵', 'defremain', 'defleft'],
    defOrigin: ['守方原始兵力', '守方总兵力', '守方兵力', '守方原始', 'deforigin', 'deftotal', 'deftroops'],
    defWounded: ['守方伤兵', '守方受伤', 'defwounded', 'definjured'],
    defDead: ['守方阵亡', '守方死亡', 'defdead', 'defkilled'],

    parent: ['父战报', '父战斗', 'parent', 'parentid'],
    streak: ['连战场次', '连续场次', 'streak', 'combo'],
    streakWuxun: ['连战武勋', '连战功勋', 'streakwuxun', 'combomerit']
  };

  function normKey(s) {
    return String(s || '').trim().toLowerCase().replace(/[\s_\-（）()【】\[\]:：]/g, '');
  }

  // 反向索引
  const REVERSE = {};
  Object.keys(ALIASES).forEach(function (std) {
    ALIASES[std].forEach(function (a) {
      const k = normKey(a);
      if (!REVERSE[k]) REVERSE[k] = std;
    });
  });

  /**
   * 把一行表头映射为标准字段 -> 列下标
   * 先精确别名，再关键词推断
   */
  function mapHeader(header) {
    const index = {};       // std -> colIndex
    const unmapped = [];
    const used = {};

    header.forEach(function (raw, i) {
      const k = normKey(raw);
      if (!k) return;
      let std = REVERSE[k];
      if (!std) {
        // 关键词推断
        const isAtk = /攻|atk|attacker|offens/.test(k);
        const isDef = /守|防|def|defen/.test(k);
        const side = isAtk ? 'atk' : (isDef ? 'def' : '');
        if (side) {
          if (/阵容|队伍|组合|配置|lineup|team|comp/.test(k)) std = side + 'Comp';
          else if (/阵型|阵法|formation|form/.test(k)) std = side + 'Formation';
          else if (/等级|级别|level|lv/.test(k)) std = side + 'Level';
          else if (/武勋|功勋|merit|wuxun/.test(k)) std = side + 'Wuxun';
          else if (/阵亡|死亡|死|dead|kill/.test(k)) std = side + 'Dead';
          else if (/伤兵|受伤|受伤兵|wound|injur/.test(k)) std = side + 'Wounded';
          else if (/剩余|余兵|remain|left/.test(k)) std = side + 'Remain';
          else if (/原始兵力|总兵力|兵力|origin|total|troop/.test(k)) std = side + 'Origin';
          else if (/同盟|联盟|alliance|guild/.test(k)) std = side + 'Alliance';
          else if (/玩家|角色|名字|player|name/.test(k)) std = side + 'Player';
        } else {
          if (/回合|round/.test(k)) std = 'round';
          else if (/时间|日期|time|date/.test(k)) std = 'time';
          else if (/地点|坐标|位置|place|location/.test(k)) std = 'place';
          else if (/结果|胜负|result|outcome/.test(k)) std = 'result';
          else if (/胜方|winner/.test(k)) std = 'winner';
          else if (/父/.test(k)) std = 'parent';
          else if (/连战.*武勋/.test(k)) std = 'streakWuxun';
          else if (/连战/.test(k)) std = 'streak';
          else if (/key|id|编号/.test(k)) std = 'id';
        }
      }
      if (std && index[std] === undefined) { index[std] = i; used[i] = true; }
      else unmapped.push({ raw: raw, index: i });
    });

    return { index: index, unmapped: unmapped };
  }

  /** 解析文本 -> {header, rows(对象数组, 以标准字段为键), mapping} */
  function parseTable(text) {
    const matrix = parseText(text);
    if (!matrix.length) return { header: [], rows: [], mapping: null };

    // 表头行：取前 5 行中"可识别字段最多"的一行
    let headerRow = 0, bestHit = -1, bestMap = null;
    for (let i = 0; i < Math.min(5, matrix.length); i++) {
      const m = mapHeader(matrix[i]);
      const hit = Object.keys(m.index).length;
      if (hit > bestHit) { bestHit = hit; headerRow = i; bestMap = m; }
    }

    const header = matrix[headerRow];
    const mapping = bestMap || mapHeader(header);
    const rows = [];

    for (let r = headerRow + 1; r < matrix.length; r++) {
      const cells = matrix[r];
      const obj = { __raw: cells };
      Object.keys(mapping.index).forEach(function (std) {
        obj[std] = (cells[mapping.index[std]] || '').trim();
      });
      rows.push(obj);
    }

    return { header: header, rows: rows, mapping: mapping };
  }

  AC.csv = {
    parseText: parseText,
    detectDelimiter: detectDelimiter,
    mapHeader: mapHeader,
    parseTable: parseTable,
    ALIASES: ALIASES
  };
})(window.AC);
