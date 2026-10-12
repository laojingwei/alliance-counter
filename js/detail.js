window.AC = window.AC || {};

/* ============================================================
   武将级明细战报解析
   游戏导出的「明细表」是一场战斗拆成多行的长格式（每行一个武将），
   这里把它聚合成与宽表一致的一场战斗一条记录，
   同时把武将级信息（技能/兵书/装备/战马/红度/觉醒）挂在每支部队上。

   已验证的聚合规则：
     - 部队级字段（玩家/同盟/阵型/兵力/武勋/士气…）在同一方各行完全一致
     - 兵力类字段 = 该方各武将对应字段之和（2004 个部队全量零误差）
   ============================================================ */
(function (AC) {
  'use strict';

  const M = AC.model;

  // 出现其中任意 3 个即判定为明细格式
  const MARKERS = ['武将序号', '武将名', '方', '战斗编号', '武将伤兵'];

  function isDetailFormat(header) {
    const set = new Set((header || []).map(function (h) { return String(h).trim(); }));
    let hit = 0;
    MARKERS.forEach(function (m) { if (set.has(m)) hit++; });
    return hit >= 3;
  }

  function num(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/[,\s%]/g, '');
    if (s === '' || s === '-') return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  function pick(row, names) {
    for (let i = 0; i < names.length; i++) {
      const v = row[names[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  /** 兵种：优先用新版表里的名称列，旧表只有 ID 时按编号还原 */
  const TROOP_BY_ID = { '1': '盾兵', '2': '弓兵', '3': '枪兵', '4': '骑兵' };
  function troopName(name, id) {
    const n = name ? String(name).trim() : '';
    if (n) return n;
    const i = id === null || id === undefined ? '' : String(id).trim();
    return TROOP_BY_ID[i] || '';
  }

  /** 一行明细 -> 一个武将 */
  /* 「装备属性原始 / 战马属性原始」形如 might=9|intelligence=7.6|effect=49|skill=58，
     其中 might / intelligence / speed 是真实属性值，effect / skill 是特技特效 ID。
     逐列填的「装备武力」等只覆盖部分属性，这里按 KV 解析能把整套属性补全。 */
  const ATTR_KEY = {
    might: 0,        // 武力
    intelligence: 1, // 智力
    command: 2,      // 统率
    leadership: 2,   // 统率（别名）
    speed: 3         // 速度 / 先攻
  };

  function parseAttrRaw(raw) {
    const out = [null, null, null, null];   // 武力 / 智力 / 统率 / 速度
    const extra = {};                        // 其它 KV（effect / skill 等 ID）
    if (!raw) return { attrs: out, extra: extra };
    String(raw).split('|').forEach(function (part) {
      const i = part.indexOf('=');
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (ATTR_KEY[k] !== undefined) {
        const n = Number(v);
        if (!isNaN(n)) out[ATTR_KEY[k]] = n;
      } else if (v !== '') {
        extra[k] = v;
      }
    });
    return { attrs: out, extra: extra };
  }

  function heroFromRow(r) {
    // 技能 / 兵书 保留槽位（空串占位），这样能和「技能N品」一一对应
    const skills = [r['技能1'], r['技能2'], r['技能3']]
      .map(function (x) { return x ? String(x).trim() : ''; });
    const books = [r['兵书1'], r['兵书2'], r['兵书3']]
      .map(function (x) { return x ? String(x).trim() : ''; });
    const skillPins = [num(r['技能1品']), num(r['技能2品']), num(r['技能3品'])];
    return {
      name: pick(r, ['武将名', '武将', '英雄']),
      level: num(r['等级']),
      troop: troopName(r['兵种'], r['兵种ID']),
      troopId: r['兵种ID'] ? String(r['兵种ID']).trim() : '',
      group: r['编组'] ? String(r['编组']).trim() : '',
      red: num(r['红度']),
      pin: num(r['品']),
      awaken: num(r['觉醒']),               // 新版已移除该列，旧表仍然兼容
      skills: skills,
      skillPins: skillPins,
      books: books,
      equip: r['装备名'] ? String(r['装备名']).trim() : '',
      equipSkill: r['装备特技'] ? String(r['装备特技']).trim() : '',
      equipEffect: r['装备特效'] ? String(r['装备特效']).trim() : '',
      equipAttrs: mergeAttrs([num(r['装备武力']), num(r['装备智力']), num(r['装备统率']), num(r['装备速度'])], parseAttrRaw(r['装备属性原始']).attrs),
      equipAttrExtra: parseAttrRaw(r['装备属性原始']).extra,
      horse: r['战马名'] ? String(r['战马名']).trim() : '',
      horseSkill: r['战马特技'] ? String(r['战马特技']).trim() : '',
      horseEffect: r['战马特效'] ? String(r['战马特效']).trim() : '',
      horseAttrs: mergeAttrs([num(r['战马武力']), num(r['战马智力']), num(r['战马统率']), num(r['战马速度'])], parseAttrRaw(r['战马属性原始']).attrs),
      horseAttrExtra: parseAttrRaw(r['战马属性原始']).extra,
      origin: num(r['武将原始兵力']),
      remain: num(r['武将剩余兵力']),
      wounded: num(r['武将伤兵']),
      dead: num(r['武将阵亡'])
    };
  }

  /** 逐列属性优先，为空的位置用「属性原始」里的 KV 补上 */
  function mergeAttrs(byCol, byRaw) {
    const out = [null, null, null, null];
    for (let i = 0; i < 4; i++) {
      out[i] = (byCol[i] !== null && byCol[i] !== undefined) ? byCol[i]
        : ((byRaw[i] !== null && byRaw[i] !== undefined) ? byRaw[i] : null);
    }
    return out;
  }

  /** 同一方的多行 -> 一支部队 */
  function sideFromRows(rows) {
    const r0 = rows[0];
    const compRaw = pick(r0, ['阵容', '阵容名列表']);
    const units = M.splitUnits(compRaw);
    const levels = rows.map(function (r) { return num(r['等级']); })
      .filter(function (x) { return x !== null; });
    const origin = num(r0['原始兵力']);
    const wounded = num(r0['伤兵']);
    const dead = num(r0['阵亡']);

    const heroes = rows.map(function (r) {
      const h = heroFromRow(r);
      h.seq = num(r['武将序号']) || 0;
      return h;
    }).sort(function (a, b) { return a.seq - b.seq; });

    // 部队级培养进度：红度 / 品级 / 觉醒（旧表才有），以及逐武将分布
    function avgOf(key) {
      const vals = heroes.map(function (h) { return h[key]; })
        .filter(function (v) { return v !== null && v !== undefined; });
      return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
    }
    function distOf(key) {
      return heroes.map(function (h) { return h[key]; })
        .filter(function (v) { return v !== null && v !== undefined; });
    }
    const redSum = heroes.reduce(function (a, h) { return a + (h.red || 0); }, 0);
    const pinSum = heroes.reduce(function (a, h) { return a + (h.pin || 0); }, 0);

    return {
      alliance: pick(r0, ['同盟']),
      player: pick(r0, ['玩家']),
      formation: pick(r0, ['阵型名', '阵型']) || '未知阵',
      compRaw: compRaw,
      comp: M.compDisplay(units),
      key: M.compKey(units),
      units: units,
      levels: levels,
      minLevel: levels.length ? Math.min.apply(null, levels) : null,
      size: units.length || rows.length,
      wuxun: num(r0['武勋']),
      remain: num(r0['剩余兵力']),
      origin: origin,
      wounded: wounded,
      dead: dead,
      lossRate: origin && origin > 0 ? Math.min(1, Math.max(0, ((wounded || 0) + (dead || 0)) / origin)) : null,
      // 明细表独有
      power: pick(r0, ['势力']),
      career: pick(r0, ['职业']),
      hometown: pick(r0, ['出身州']),
      morale: num(r0['士气']),
      heroes: heroes,
      // 部队兵种：逐武将名称 + 速记串（如「枪弓弓」），顺序与阵容名一致
      troopList: heroes.map(function (h) { return h.troop; }).filter(Boolean),
      troopSig: heroes.map(function (h) { return h.troop ? h.troop.charAt(0) : ''; }).filter(Boolean).join(''),
      redAvg: avgOf('red'),
      redSum: redSum,
      redMax: distOf('red').length ? Math.max.apply(null, distOf('red')) : null,
      redDist: distOf('red'),
      pinAvg: avgOf('pin'),
      pinSum: pinSum,
      pinMax: distOf('pin').length ? Math.max.apply(null, distOf('pin')) : null,
      pinDist: distOf('pin'),
      awakenAvg: avgOf('awaken'),
      awakenSum: heroes.reduce(function (a, h) { return a + (h.awaken || 0); }, 0),
        // 部队级状态与资源（新版明细表新增）
        morale: num(r0['士气']),
        wagonOrigin: num(r0['辎重原始']),
        wagonNow: num(r0['辎重当前']),
        troopExp: num(r0['部队经验']),
        externalBuff: r0['外部增益'] ? String(r0['外部增益']).trim() : '',
        externalBuffSource: r0['外部增益来源'] ? String(r0['外部增益来源']).trim() : '',
        externalBuffLevel: num(r0['外部增益等级']),
        shipType: num(r0['战船类型']),
        seasonParts: r0['赛季组件'] ? String(r0['赛季组件']).trim() : '',
        vehicleType: num(r0['载具类型']),
        recruit: num(r0['征召数']),
        merit: num(r0['武勋']),
        stamina: num(r0['消耗体力']),
        troopMix: heroes.reduce(function (acc, h) { if (h.troop && acc.indexOf(h.troop) < 0) acc.push(h.troop); return acc; }, []).join('/')
    };
  }

  /**
   * 明细行 -> 战斗级记录数组
   * @param {Array<Object>} rows AC.csv.parseTable 解析出的行对象
   */
  function toBattles(rows, batchId) {
    const groups = new Map();
    const order = [];
    rows.forEach(function (r) {
      const k = pick(r, ['战斗编号', '战斗ID', '战斗Key']);
      if (!k) return;
      if (!groups.has(k)) { groups.set(k, []); order.push(k); }
      groups.get(k).push(r);
    });

    const out = [];
    order.forEach(function (k) {
      const g = groups.get(k);
      const atk = g.filter(function (r) { return String(r['方'] || '').indexOf('攻') >= 0; });
      const def = g.filter(function (r) { return String(r['方'] || '').indexOf('守') >= 0; });
      if (!atk.length || !def.length) return;

      const first = g[0];
      const t = M.parseTime(pick(first, ['时间']));
      const id = pick(first, ['战斗编号', '战斗Key', '战斗ID']);

      out.push({
        id: id,
        batchId: batchId || '',
        place: pick(first, ['地点', '坐标']),
        time: t.text,
        ts: t.ts,
        result: M.normResult(pick(first, ['结果', '胜方'])),
        resultText: pick(first, ['结果']),
        round: num(pick(first, ['回合数', '回合'])),
        parent: pick(first, ['父战报']),
        /* 原始战报自带的连战信息（新版导出才有）：
           recordType  block = 主战报、child = 由主战报续战拆分出的子战报
           draws       这一场里打平续战的次数（0 表示一次打完）
           subs        这一场触发了几条子战报 */
        recordType: pick(first, ['记录类型']),
        draws: num(pick(first, ['平局数'])),
        subs: num(pick(first, ['子战报数'])),
        matchType: pick(first, ['匹配类型']),
        streak: null,
        streakWuxun: null,
        detailed: true,
        atk: sideFromRows(atk),
        def: sideFromRows(def)
      });
    });

    return out;
  }

  /** 统计明细数据的信息，用于导入提示 */
  function summary(battles) {
    let heroes = 0, skills = 0;
    const heroSet = new Set(), skillSet = new Set(), equipSet = new Set();
    battles.forEach(function (b) {
      [b.atk, b.def].forEach(function (s) {
        if (!s.heroes) return;
        heroes += s.heroes.length;
        s.heroes.forEach(function (h) {
          if (h.name) heroSet.add(h.name);
          h.skills.forEach(function (sk) { skills++; skillSet.add(sk); });
          if (h.equip) equipSet.add(h.equip);
        });
      });
    });
    return {
      battles: battles.length,
      heroRows: heroes,
      heroes: heroSet.size,
      skills: skillSet.size,
      skillUses: skills,
      equips: equipSet.size
    };
  }

  /**
   * 直接解析明细表文本。
   * 不走 AC.csv.parseTable——那套表头映射是按「一场战斗一行」的宽表设计的，
   * 会把明细表里 武将与方 这类列直接丢掉。
   * @returns {Object|null} 不是明细格式时返回 null
   */
  function parse(text) {
    const matrix = AC.csv.parseText(text);
    if (!matrix.length) return null;

    // 表头行：取命中标记最多的那一行
    let headerRow = 0, best = -1;
    for (let i = 0; i < Math.min(4, matrix.length); i++) {
      let hit = 0;
      MARKERS.forEach(function (m) { if (matrix[i].indexOf(m) >= 0) hit++; });
      if (hit > best) { best = hit; headerRow = i; }
    }
    const header = matrix[headerRow];
    if (!isDetailFormat(header)) return null;

    const rows = [];
    for (let r = headerRow + 1; r < matrix.length; r++) {
      const cells = matrix[r];
      let any = false;
      for (let c = 0; c < cells.length; c++) { if (String(cells[c]).trim() !== '') { any = true; break; } }
      if (!any) continue;
      const o = {};
      for (let i = 0; i < header.length; i++) {
        o[String(header[i]).trim()] = cells[i] === undefined ? '' : String(cells[i]).trim();
      }
      rows.push(o);
    }

    const battles = toBattles(rows);
    return { header: header, rows: rows, battles: battles, summary: summary(battles) };
  }

  /** 快速嗅探（只看开头一小段），避免为判断格式而整份解析两遍 */
  function sniff(text) {
    const head = String(text).slice(0, 2048).split(/\r?\n/).slice(0, 3);
    for (let i = 0; i < head.length; i++) {
      let hit = 0;
      MARKERS.forEach(function (m) { if (head[i].indexOf(m) >= 0) hit++; });
      if (hit >= 3) return true;
    }
    return false;
  }

  /* ---------------- 反向导出：战斗记录 -> 明细行 ---------------- */

  /** 明细表的内置列（生成示例数据时也用它，保持两边一致） */
  const DETAIL_HEADER = [
    '战斗编号', '时间', '地点', '结果', '回合数', '父战报', '方',
    '玩家', '同盟', '势力', '出身州', '职业',
    '阵型名', '士气', '武勋', '阵容',
    '武将序号', '武将名', '等级', '编组', '兵种ID', '兵种', '红度', '品',
    '技能1', '技能2', '技能3', '技能1品', '技能2品', '技能3品',
    '兵书1', '兵书2', '兵书3',
    '装备名', '装备特技', '装备特效', '装备武力', '装备智力', '装备统率', '装备速度',
    '战马名', '战马特技', '战马特效', '战马武力', '战马智力', '战马统率', '战马速度',
    '武将原始兵力', '武将剩余兵力', '武将伤兵', '武将阵亡',
    '原始兵力', '剩余兵力', '伤兵', '阵亡'
  ];

  const RESULT_TEXT = { atk: '攻方胜', def: '守方胜', draw: '平局', unknown: '' };

  function s(v) { return v === null || v === undefined ? '' : v; }

  /** 一场战斗 -> 若干行明细 */
  function battleToRows(b, sideName) {
    const out = [];
    [['攻方', b.atk], ['守方', b.def]].forEach(function (pair) {
      const name = pair[0], side = pair[1];
      if (sideName && sideName !== name) return;
      const heroes = side.heroes && side.heroes.length ? side.heroes : [{}];
      heroes.forEach(function (h, i) {
        const skills = h.skills || [];
        const books = h.books || [];
        const pins = h.skillPins || [];
        const ea = h.equipAttrs || [];
        const ha = h.horseAttrs || [];
        out.push([
          s(b.id), s(b.time), s(b.place), RESULT_TEXT[b.result] || '', s(b.round), s(b.parent), name,
          s(side.player), s(side.alliance), s(side.power), s(side.hometown), s(side.career),
          s(side.formation), s(side.morale), s(side.wuxun), s(side.compRaw),
          i + 1, s(h.name), s(h.level), s(h.group), s(h.troopId), s(h.troop), s(h.red), s(h.pin),
          s(skills[0]), s(skills[1]), s(skills[2]), s(pins[0]), s(pins[1]), s(pins[2]),
          s(books[0]), s(books[1]), s(books[2]),
          s(h.equip), s(h.equipSkill), s(h.equipEffect), s(ea[0]), s(ea[1]), s(ea[2]), s(ea[3]),
          s(h.horse), s(h.horseSkill), s(h.horseEffect), s(ha[0]), s(ha[1]), s(ha[2]), s(ha[3]),
          s(h.origin), s(h.remain), s(h.wounded), s(h.dead),
          s(side.origin), s(side.remain), s(side.wounded), s(side.dead)
        ]);
      });
    });
    return out;
  }

  /** 一批战斗记录 -> 完整明细表行 */
  function toRows(battles) {
    let rows = [];
    battles.forEach(function (b) { rows = rows.concat(battleToRows(b)); });
    return rows;
  }

  /** 判断一批记录里是否含明细数据 */
  function hasDetail(battles) {
    return battles.some(function (b) { return b && b.detailed; });
  }

  AC.detail = {
    isDetailFormat: isDetailFormat,
    sniff: sniff,
    parse: parse,
    toBattles: toBattles,
    summary: summary,
    DETAIL_HEADER: DETAIL_HEADER,
    battleToRows: battleToRows,
    toRows: toRows,
    hasDetail: hasDetail
  };
})(window.AC);
