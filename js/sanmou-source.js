window.AC = window.AC || {};

/* ============================================================
   Sanmou 数据源（唯一数据入口）
   ------------------------------------------------------------
   数据来自 sanmou-viewer 的「战报数据 → 导出数据文件」，
   在页面里以 <script src="js/battle-data.js"> 引入，产生：

     window.AC.battleData = {
       schema: 'ac-battle-data-v1',
       generatedAt, source, stats,
       records: [ { id, t, pa, tm, ts, lo, rs, rt, rd, dr, cn, A, D }, ... ]
     }

   字段含义（紧凑命名，减小文件体积）：
     战斗级  id=战斗ID  t=记录类型(block/child)  pa=父战报ID  tm=时间  ts=时间戳
             lo=地点  rs=胜负(atk/def/draw)  rt=结果原文  rd=回合  dr=平局数  cn=子战报数
     部队级  p=玩家 a=同盟 aid=角色ID f=势力 b=出身州 fm=阵型 lu=阵容
             wx=武勋 mo=士气 role=职位 o=原始兵力 r=剩余兵力 w=伤兵 d=阵亡 hs=武将[]
     武将级  n=名 i=序号 lv=等级 g=编组 t=兵种 ti=兵种ID red=红度 pin=品
             sk=技能 sp=技能品 bk=兵书 eq=装备 eqs=装备特技 eqe=装备特效 eqa=装备属性
             ho=战马 hos=战马特技 hoe=战马特效 hoa=战马属性
             o=原始兵力 r=剩余兵力 w=伤兵 d=阵亡
   ============================================================ */
(function (AC) {
  'use strict';

  const SCHEMA = 'ac-battle-data-v1';
  const TROOP_BY_ID = { 1: '盾兵', 2: '弓兵', 3: '枪兵', 4: '骑兵' };

  /** 是否有可用数据 */
  function available() {
    const d = AC.battleData;
    return !!(d && d.schema === SCHEMA && Array.isArray(d.records) && d.records.length);
  }

  /** 数据摘要，用于界面提示 */
  function summary() {
    if (!available()) return null;
    const d = AC.battleData;
    return Object.assign({ generatedAt: d.generatedAt, source: d.source }, d.stats || {});
  }

  /** 数据是否缺失时给出可读的原因 */
  function diagnose() {
    if (!AC.battleData) {
      return {
        ok: false,
        reason: 'missing',
        message: '没有找到战报数据。请用 sanmou-viewer 的「战报数据 → 导出数据文件」生成 '
               + 'battle-data.js，放到 js/ 目录并在 index.html 里用 <script src> 引入。'
      };
    }
    if (AC.battleData.schema !== SCHEMA) {
      return {
        ok: false,
        reason: 'schema',
        message: '数据格式不匹配（期望 ' + SCHEMA + '，实际 ' + AC.battleData.schema + '）。'
               + '请用当前版本的 sanmou-viewer 重新导出。'
      };
    }
    if (!Array.isArray(AC.battleData.records) || !AC.battleData.records.length) {
      return { ok: false, reason: 'empty', message: '数据文件里没有战报记录。' };
    }
    return { ok: true, message: '' };
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  /** 武将：紧凑键 -> 内部结构 */
  function toHero(h) {
    return {
      name: h.n || '',
      seq: h.i || 0,
      level: num(h.lv),
      group: h.g === null || h.g === undefined ? '' : String(h.g),
      troop: h.t || TROOP_BY_ID[h.ti] || '',
      troopId: h.ti === null || h.ti === undefined ? '' : String(h.ti),
      red: num(h.red),
      pin: num(h.pin),
      skills: (h.sk || []).slice(),
      skillPins: (h.sp || []).map(num),
      books: (h.bk || []).slice(),
      equip: h.eq || '',
      equipSkill: h.eqs || '',
      equipEffect: h.eqe || '',
      equipAttrs: (h.eqa || [null, null, null, null]).slice(),
      equipAttrExtra: { skill: h.eqs || '', effect: h.eqe || '' },
      horse: h.ho || '',
      horseSkill: h.hos || '',
      horseEffect: h.hoe || '',
      horseAttrs: (h.hoa || [null, null, null, null]).slice(),
      horseAttrExtra: { skill: h.hos || '', effect: h.hoe || '' },
      origin: num(h.o),
      remain: num(h.r),
      wounded: num(h.w),
      dead: num(h.d)
    };
  }

  /** 部队：紧凑键 -> 内部结构（含派生统计量） */
  function toSide(s) {
    const M = AC.model;
    const units = M.splitUnits(s.lu || '');
    const heroes = (s.hs || []).map(toHero);
    const levels = heroes.map(function (h) { return h.level; })
      .filter(function (x) { return x !== null && x !== undefined; });
    const origin = num(s.o);
    const wounded = num(s.w);
    const dead = num(s.d);

    const vals = function (key) {
      return heroes.map(function (h) { return h[key]; })
        .filter(function (v) { return v !== null && v !== undefined; });
    };
    const avg = function (key) {
      const a = vals(key);
      return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null;
    };
    const maxOf = function (key) {
      const a = vals(key);
      return a.length ? Math.max.apply(null, a) : null;
    };

    return {
      alliance: s.a || '',
      player: s.p || '',
      avatarId: s.aid || '',
      formation: s.fm || '未知阵',
      compRaw: s.lu || '',
      comp: units.join(' / '),
      key: M.compKey(units),
      units: units,
      levels: levels,
      minLevel: levels.length ? Math.min.apply(null, levels) : null,
      size: units.length || heroes.length,
      wuxun: num(s.wx),
      remain: num(s.r),
      origin: origin,
      wounded: wounded,
      dead: dead,
      lossRate: (origin && origin > 0)
        ? Math.min(1, Math.max(0, ((wounded || 0) + (dead || 0)) / origin))
        : null,
      power: s.f === null || s.f === undefined ? '' : String(s.f),
      career: s.role === null || s.role === undefined ? '' : String(s.role),
      morale: num(s.mo),
      heroes: heroes,
      troopList: heroes.map(function (h) { return h.troop; }).filter(Boolean),
      troopSig: heroes.map(function (h) { return h.troop ? h.troop.charAt(0) : ''; })
        .filter(Boolean).join(''),
      redAvg: avg('red'),
      redSum: heroes.reduce(function (a, h) { return a + (h.red || 0); }, 0),
      redDist: vals('red'),
      redMax: maxOf('red'),
      pinAvg: avg('pin'),
      pinSum: heroes.reduce(function (a, h) { return a + (h.pin || 0); }, 0),
      pinDist: vals('pin'),
      pinMax: maxOf('pin')
    };
  }

  /** 一条记录 -> battle 对象 */
  function toBattle(rec) {
    const M = AC.model;
    const t = M.parseTime(rec.tm);
    return {
      id: rec.id,
      place: rec.lo || '',
      time: t.text || rec.tm || '',
      ts: t.ts || rec.ts || null,
      result: rec.rs || 'unknown',
      resultText: rec.rt || '',
      round: num(rec.rd),
      parent: rec.pa || '',
      recordType: rec.t || 'block',
      draws: num(rec.dr),
      subs: num(rec.cn),
      detailed: true,
      atk: toSide(rec.A || {}),
      def: toSide(rec.D || {})
    };
  }

  /** 全部记录 -> battle 数组 */
  function toBattles() {
    if (!available()) return [];
    return AC.battleData.records.map(toBattle);
  }

  /* ---------------- 上传 / 拖入的数据文件解析 ---------------- */

  /**
   * 解析用户上传的数据文件文本，装到 AC.battleData。
   * 支持三种格式（viewer 导出的三选一）：
   *   .js    —— window.AC.battleData = {...};（file:// 最稳，与内置文件同格式）
   *   .json  —— { schema, stats, records }（整体 JSON）
   *   .jsonl —— 每行一条紧凑记录
   * @returns {{ok:boolean, count?:number, message?:string}}
   */
  function parseUploaded(text, filename) {
    const name = String(filename || '上传数据').trim();
    const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!trimmed) return { ok: false, message: '文件内容为空。' };

    let data = null;

    if (/\.jsonl$/i.test(name)) {
      // 行式 JSON：每行一条记录
      const records = [];
      const lines = trimmed.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          records.push(JSON.parse(line));
        } catch (e) {
          return { ok: false, message: '第 ' + (i + 1) + ' 行不是合法 JSON：' + e.message };
        }
      }
      if (!records.length) return { ok: false, message: 'jsonl 文件里没有记录。' };
      data = { schema: SCHEMA, records: records, stats: {} };
    } else if (/\.js$/i.test(name)) {
      // 执行 .js 沙箱，取 window.AC.battleData
      const fake = { window: { AC: {} } };
      fake.globalThis = fake;
      try {
        new Function('window', trimmed)(fake.window);
      } catch (e) {
        return { ok: false, message: 'js 文件执行失败：' + e.message };
      }
      data = fake.window.AC && fake.window.AC.battleData;
      if (!data) return { ok: false, message: 'js 文件里没有找到 window.AC.battleData。' };
    } else {
      // .json 或其它：整体 JSON
      try {
        data = JSON.parse(trimmed);
      } catch (e) {
        return { ok: false, message: '不是合法的 JSON 文件：' + e.message };
      }
    }

    if (data.schema && data.schema !== SCHEMA) {
      return { ok: false, message: '数据格式不匹配（期望 ' + SCHEMA + '，实际 ' + data.schema + '）。请用当前版本的 sanmou-viewer 重新导出。' };
    }
    if (!Array.isArray(data.records)) {
      return { ok: false, message: '数据里没有 records 数组，不是 viewer 导出的战报文件。' };
    }
    if (!data.records.length) {
      return { ok: false, message: '数据文件里没有战报记录。' };
    }

    // 校验首条记录的基本结构，尽早发现格式错误
    const probe = data.records[0] || {};
    if (!probe.id || !probe.A || !probe.D) {
      return { ok: false, message: '记录结构不符合预期（缺少 id / A / D 字段）。请确认是 sanmou-viewer 导出的战报数据。' };
    }

    // 统计信息缺失时补算（jsonl 不带 stats）
    if (!data.stats || !data.stats.records) {
      let block = 0, child = 0;
      for (let i = 0; i < data.records.length; i++) {
        if (data.records[i].t === 'child') child++; else block++;
      }
      const players = new Set();
      data.records.forEach(function (r) {
        if (r.A && r.A.p) players.add(r.A.p);
        if (r.D && r.D.p) players.add(r.D.p);
      });
      data.stats = {
        records: data.records.length,
        blocks: block,
        children: child,
        players: players.size,
        source: name
      };
    }
    data.source = data.source || name;

    AC.battleData = data;
    return { ok: true, count: data.records.length };
  }

  AC.sanmou = {
    SCHEMA: SCHEMA,
    available: available,
    summary: summary,
    diagnose: diagnose,
    parseUploaded: parseUploaded,
    toBattle: toBattle,
    toBattles: toBattles,
    toSide: toSide,
    toHero: toHero
  };
})(window.AC);
