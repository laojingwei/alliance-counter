window.AC = window.AC || {};

/* ============================================================
   战报脱敏（浏览器页面与 Node 工具共用同一份实现）
   把「同盟名 / 玩家名」替换为一一对应的假名：
     - 同一原名永远映射到同一假名，统计结论完全不变
     - 无法从假名反推真实名称
   ============================================================ */
(function (AC) {
  'use strict';

  /* ---------------- MD5（纯 JS，页面与 Node 共用同一份实现） ---------------- */

  function md5(input) {
    const str = unescape(encodeURIComponent(String(input)));   // UTF-8

    function safeAdd(x, y) {
      const lsw = (x & 0xFFFF) + (y & 0xFFFF);
      const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
      return (msw << 16) | (lsw & 0xFFFF);
    }
    function rol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
    function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

    const x = [];
    for (let i = 0; i < str.length * 8; i += 8) {
      x[i >> 5] = (x[i >> 5] || 0) | (str.charCodeAt(i / 8) & 0xFF) << (i % 32);
    }
    const len = str.length * 8;
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;

    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const oa = a, ob = b, oc = c, od = d;
      a = ff(a, b, c, d, x[i], 7, -680876936);
      d = ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = ff(c, d, a, b, x[i + 2], 17, 606105819);
      b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = ff(a, b, c, d, x[i + 4], 7, -176418897);
      d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
      b = ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
      d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = ff(c, d, a, b, x[i + 10], 17, -42063);
      b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
      d = ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
      b = ff(b, c, d, a, x[i + 15], 22, 1236535329);

      a = gg(a, b, c, d, x[i + 1], 5, -165796510);
      d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = gg(c, d, a, b, x[i + 11], 14, 643717713);
      b = gg(b, c, d, a, x[i], 20, -373897302);
      a = gg(a, b, c, d, x[i + 5], 5, -701558691);
      d = gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = gg(c, d, a, b, x[i + 15], 14, -660478335);
      b = gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = gg(a, b, c, d, x[i + 9], 5, 568446438);
      d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = gg(c, d, a, b, x[i + 3], 14, -187363961);
      b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
      d = gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
      b = gg(b, c, d, a, x[i + 12], 20, -1926607734);

      a = hh(a, b, c, d, x[i + 5], 4, -378558);
      d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
      b = hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
      d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = hh(c, d, a, b, x[i + 7], 16, -155497632);
      b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = hh(a, b, c, d, x[i + 13], 4, 681279174);
      d = hh(d, a, b, c, x[i], 11, -358537222);
      c = hh(c, d, a, b, x[i + 3], 16, -722521979);
      b = hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = hh(a, b, c, d, x[i + 9], 4, -640364487);
      d = hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = hh(c, d, a, b, x[i + 15], 16, 530742520);
      b = hh(b, c, d, a, x[i + 2], 23, -995338651);

      a = ii(a, b, c, d, x[i], 6, -198630844);
      d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
      b = ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
      d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
      c = ii(c, d, a, b, x[i + 10], 15, -1051523);
      b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
      d = ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
      b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = ii(a, b, c, d, x[i + 4], 6, -145523070);
      d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = ii(c, d, a, b, x[i + 2], 15, 718787259);
      b = ii(b, c, d, a, x[i + 9], 21, -343485551);

      a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
    }

    const hex = '0123456789abcdef';
    let out = '';
    [a, b, c, d].forEach(function (w) {
      for (let i = 0; i < 4; i++) {
        out += hex.charAt((w >> (i * 8 + 4)) & 0xF) + hex.charAt((w >> (i * 8)) & 0xF);
      }
    });
    return out;
  }

  const SALT = 'ac-anon-v1::';

  /** 由原始名派生稳定的假名：与批次、顺序、数据量都无关 */
  function pseudoName(prefix, rawName, len) {
    return prefix + md5(SALT + String(rawName)).slice(0, len || 5).toUpperCase();
  }

  /* ---------------- 频次统计 ---------------- */

  function tally(rows, idx) {
    const m = new Map();
    if (idx === undefined) return m;
    rows.forEach(function (r) {
      const v = String(r[idx] == null ? '' : r[idx]).trim();
      if (!v) return;
      m.set(v, (m.get(v) || 0) + 1);
    });
    return m;
  }

  function mergeTally(target, src) {
    src.forEach(function (n, k) { target.set(k, (target.get(k) || 0) + n); });
    return target;
  }

  /** 按出现次数降序（次数相同按名称排序，保证结果稳定可复现） */
  function sortedEntries(countMap) {
    return Array.from(countMap.entries()).sort(function (a, b) {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
  }

  /* ---------------- 稳定性哈希（用于 ID / 坐标脱敏） ---------------- */

  function hash6(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36).toUpperCase().slice(0, 6);
  }

  /* ---------------- 方案生成 ---------------- */

  /**
   * 分析表头与数据，生成映射方案（不修改数据）
   * @param {Array} header 原始表头数组
   * @param {Array<Array>} rows 原始数据行（二维数组）
   * @param {Object} options { playerPrefix, alliancePrefix, padWidth }
   */
  function buildPlan(header, rows, options) {
    const opts = Object.assign({
      playerPrefix: '玩家',
      alliancePrefix: '同盟',
      padWidth: 2,
      nameMode: 'md5',        // md5 = 由原始名派生（跨批次稳定）；index = 按出场顺序编号
      md5Len: 5
    }, options || {});

    const mapping = AC.csv.mapHeader(header);
    const index = mapping.index;

    // 明细表（武将级长格式）没有攻守前缀，只有单列「玩家」「同盟」，单独识别
    const extraPlayer = [], extraAlliance = [];
    header.forEach(function (h, i) {
      const name = String(h).trim();
      if (name === '玩家' || name === '玩家名') extraPlayer.push(i);
      if (name === '同盟' || name === '同盟名') extraAlliance.push(i);
    });

    const playerCount = new Map();
    ['atkPlayer', 'defPlayer'].forEach(function (k) {
      if (index[k] !== undefined) mergeTally(playerCount, tally(rows, index[k]));
    });
    extraPlayer.forEach(function (i) { mergeTally(playerCount, tally(rows, i)); });

    const allianceCount = new Map();
    ['atkAlliance', 'defAlliance'].forEach(function (k) {
      if (index[k] !== undefined) mergeTally(allianceCount, tally(rows, index[k]));
    });
    extraAlliance.forEach(function (i) { mergeTally(allianceCount, tally(rows, i)); });

    // 假名：默认由「原始名的 MD5」派生——同一原名在任何批次、任何顺序下都得到同一个假名，
    // 这样分批追加数据时不会出现「同一个人对应两个假名」。
    const md5Mode = opts.nameMode === 'md5';
    const playerMap = new Map();
    sortedEntries(playerCount).forEach(function (e, i) {
      playerMap.set(e[0], md5Mode
        ? pseudoName(opts.playerPrefix, e[0], opts.md5Len)
        : opts.playerPrefix + String(i + 1).padStart(opts.padWidth, '0'));
    });

    const allianceMap = new Map();
    sortedEntries(allianceCount).forEach(function (e, i) {
      if (md5Mode) {
        allianceMap.set(e[0], pseudoName(opts.alliancePrefix, e[0], opts.md5Len));
      } else {
        const letter = String.fromCharCode(65 + (i % 26));
        const suffix = letter + (i >= 26 ? String(Math.floor(i / 26)) : '');
        allianceMap.set(e[0], opts.alliancePrefix + suffix);
      }
    });

    const missing = [];
    if (!extraPlayer.length && index.atkPlayer === undefined && index.defPlayer === undefined) {
      missing.push(AC.csv.ALIASES.atkPlayer[0]);
    }
    if (!extraAlliance.length && index.atkAlliance === undefined && index.defAlliance === undefined) {
      missing.push(AC.csv.ALIASES.atkAlliance[0]);
    }

    return {
      index: index,
      extraPlayer: extraPlayer,
      extraAlliance: extraAlliance,
      playerMap: playerMap,
      allianceMap: allianceMap,
      idMap: new Map(),
      placeMap: new Map(),
      stats: {
        rows: rows.length,
        players: playerMap.size,
        alliances: allianceMap.size,
        missing: missing
      }
    };
  }

  /* ---------------- 应用方案 ---------------- */

  /**
   * 应用映射，返回全新的行数组（不修改入参）
   * @param {Array} header 原始表头
   * @param {Array<Array>} rows 原始数据行
   * @param {Object} plan buildPlan 的结果
   * @param {Object} options { anonNames（默认 true）, anonId, anonPlace }
   */
  function applyPlan(header, rows, plan, options) {
    const opts = Object.assign({ anonNames: true, anonId: false, anonPlace: false }, options || {});
    const index = plan.index;
    let playerHits = 0, allianceHits = 0;

    const idText = function (s) {
      return String(s).replace(/\d{4,}/g, function (d) {
        if (!plan.idMap.has(d)) plan.idMap.set(d, hash6(d));
        return plan.idMap.get(d);
      });
    };

    const out = rows.map(function (raw) {
      const row = raw.slice();
      if (opts.anonNames) {
        ['atkPlayer', 'defPlayer'].forEach(function (k) {
          const i = index[k];
          if (i === undefined) return;
          const v = String(row[i] == null ? '' : row[i]).trim();
          const nv = plan.playerMap.get(v);
          if (nv) { row[i] = nv; playerHits++; }
        });
        ['atkAlliance', 'defAlliance'].forEach(function (k) {
          const i = index[k];
          if (i === undefined) return;
          const v = String(row[i] == null ? '' : row[i]).trim();
          const nv = plan.allianceMap.get(v);
          if (nv) { row[i] = nv; allianceHits++; }
        });
        // 明细表的单列「玩家」「同盟」
        (plan.extraPlayer || []).forEach(function (i) {
          const v = String(row[i] == null ? '' : row[i]).trim();
          const nv = plan.playerMap.get(v);
          if (nv) { row[i] = nv; playerHits++; }
        });
        (plan.extraAlliance || []).forEach(function (i) {
          const v = String(row[i] == null ? '' : row[i]).trim();
          const nv = plan.allianceMap.get(v);
          if (nv) { row[i] = nv; allianceHits++; }
        });
      }
      if (opts.anonId) {
        if (index.id !== undefined) row[index.id] = idText(row[index.id] || '');
        if (index.parent !== undefined && row[index.parent]) row[index.parent] = idText(row[index.parent]);
      }
      if (opts.anonPlace && index.place !== undefined) {
        const v = String(row[index.place] == null ? '' : row[index.place]).trim();
        if (v) {
          if (!plan.placeMap.has(v)) plan.placeMap.set(v, '区域' + String(plan.placeMap.size + 1).padStart(2, '0'));
          row[index.place] = plan.placeMap.get(v);
        }
      }
      return row;
    });

    return {
      header: header.slice(),
      rows: out,
      stats: {
        rows: out.length,
        playerReplacements: playerHits,
        allianceReplacements: allianceHits,
        ids: plan.idMap.size,
        places: plan.placeMap.size
      }
    };
  }

  /* ---------------- 序列化 ---------------- */

  function escapeCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsvText(header, rows) {
    const lines = [header.map(escapeCell).join(',')];
    rows.forEach(function (r) { lines.push(r.map(escapeCell).join(',')); });
    return lines.join('\r\n') + '\r\n';
  }

  /** 一步到位：分析 + 应用 */
  function anonymize(header, rows, options) {
    const plan = buildPlan(header, rows, options);
    const result = applyPlan(header, rows, plan, options);
    result.plan = plan;
    return result;
  }

  AC.anonymize = {
    buildPlan: buildPlan,
    applyPlan: applyPlan,
    toCsvText: toCsvText,
    anonymize: anonymize,
    hash6: hash6,
    md5: md5,
    pseudoName: pseudoName,
    SALT: SALT,
    sortedEntries: sortedEntries
  };
})(window.AC);
