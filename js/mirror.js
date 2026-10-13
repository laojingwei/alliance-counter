/* ============================================================
   内战分析（对比视角）
   ------------------------------------------------------------
   内战 = 同一套阵容对同一套阵容。双方阵容一样，胜负只能由别的因素决定，
   所以这一页就是「把双方的差异摆出来，看哪一项真的决定胜负」。

   四块内容：
   ① 数值维度对比：逐项比较双方数值（红度、品级、装备/战马属性、士气、兵力…），
      统计「数值更高的一方」赢了多少 → 按影响大小排序。
   ② 特技 / 特效对比：一方有、另一方没有时，持有方赢了多少 →
      直接回答「带这个特技到底有没有用」。
   ③ 装备 / 战马 / 兵书对比：同样是「独有」口径。
   ④ 逐场明细：每场双方的实际数值与差值。
   ============================================================ */
window.AC = window.AC || {};

(function (AC) {
  'use strict';

  const U = AC.util;

  function num(v) { return (v === null || v === undefined || v === '' || isNaN(v)) ? null : Number(v); }
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }

  /* ---------------- 数值维度 ---------------- */

  function avgField(side, field) {
    const vals = (side.heroes || []).map(function (h) { return num(h[field]); })
      .filter(function (v) { return v !== null; });
    return vals.length ? sum(vals) / vals.length : null;
  }

  function sumAttr(side, field, idx) {
    let s = 0, n = 0;
    (side.heroes || []).forEach(function (h) {
      const arr = h[field];
      const v = arr ? num(arr[idx]) : null;
      if (v !== null) { s += v; n++; }
    });
    return n ? s : null;
  }

  function avgSkillPin(side) {
    let s = 0, n = 0;
    (side.heroes || []).forEach(function (h) {
      (h.skillPins || []).forEach(function (p) {
        const v = num(p);
        if (v !== null) { s += v; n++; }
      });
    });
    return n ? s / n : null;
  }

  const DIMS = [
    { key: 'force', name: '开战兵力', eps: 1, get: function (s) { return num(s.origin); } },
    { key: 'red', name: '红度', eps: 0.05, get: function (s) { return avgField(s, 'red'); } },
    { key: 'pin', name: '品级', eps: 0.05, get: function (s) { return avgField(s, 'pin'); } },
    { key: 'level', name: '武将等级', eps: 0.05, get: function (s) { return avgField(s, 'level'); } },
    { key: 'skillpin', name: '技能品级', eps: 0.05, get: avgSkillPin },
    { key: 'morale', name: '士气', eps: 0.05, get: function (s) { return num(s.morale); } },
    { key: 'ef', name: '装备武力', eps: 0.05, get: function (s) { return sumAttr(s, 'equipAttrs', 0); } },
    { key: 'ei', name: '装备智力', eps: 0.05, get: function (s) { return sumAttr(s, 'equipAttrs', 1); } },
    { key: 'ec', name: '装备统率', eps: 0.05, get: function (s) { return sumAttr(s, 'equipAttrs', 2); } },
    { key: 'es', name: '装备速度', eps: 0.05, get: function (s) { return sumAttr(s, 'equipAttrs', 3); } },
    { key: 'hf', name: '战马武力', eps: 0.05, get: function (s) { return sumAttr(s, 'horseAttrs', 0); } },
    { key: 'hi', name: '战马智力', eps: 0.05, get: function (s) { return sumAttr(s, 'horseAttrs', 1); } },
    { key: 'hc', name: '战马统率', eps: 0.05, get: function (s) { return sumAttr(s, 'horseAttrs', 2); } },
    { key: 'hs', name: '战马速度', eps: 0.05, get: function (s) { return sumAttr(s, 'horseAttrs', 3); } }
  ];

  function dimensionImpact(list) {
    return DIMS.map(function (d) {
      let higherN = 0, higherWin = 0;
      list.forEach(function (b) {
        const va = d.get(b.atk), vb = d.get(b.def);
        if (va === null || vb === null) return;
        const diff = va - vb;
        if (Math.abs(diff) < d.eps) return;
        const higherIsAtk = diff > 0;
        if ((b.result === 'atk') === higherIsAtk) higherWin++;
        higherN++;
      });
      const rate = higherN ? higherWin / higherN : null;
      return {
        key: d.key, name: d.name, n: higherN,
        higherRate: rate,
        gap: rate === null ? null : rate - 0.5
      };
    }).filter(function (x) { return x.n >= 3; })
      .sort(function (a, b) { return b.gap - a.gap; });
  }

  /* ---------------- 特技 / 特效 / 装备 / 战马 / 兵书：独有对比 ----------------
     一方有而另一方没有 → 看持有方赢不赢。比「整体胜率」更能说明问题，
     因为它把「双方都有」的情况排除了。 */

  function namesOf(side, kind) {
    const set = new Set();
    (side.heroes || []).forEach(function (h) {
      if (kind === 'equipSkill' && h.equipSkill) set.add(h.equipSkill);
      if (kind === 'equipEffect' && h.equipEffect) set.add(h.equipEffect);
      if (kind === 'horseSkill' && h.horseSkill) set.add(h.horseSkill);
      if (kind === 'horseEffect' && h.horseEffect) set.add(h.horseEffect);
      if (kind === 'equip' && h.equip) set.add(h.equip);
      if (kind === 'horse' && h.horse) set.add(h.horse);
      if (kind === 'book') (h.books || []).forEach(function (bk) { if (bk) set.add(bk); });
    });
    return set;
  }

  function exclusiveImpact(list, kind) {
    const map = new Map();
    function add(t, won, drew) {
      let o = map.get(t);
      if (!o) { o = { n: 0, win: 0, draw: 0 }; map.set(t, o); }
      o.n++;
      if (drew) o.draw++; else if (won) o.win++;
    }
    list.forEach(function (b) {
      const A = namesOf(b.atk, kind);
      const B = namesOf(b.def, kind);
      A.forEach(function (t) { if (!B.has(t)) add(t, b.result === 'atk', b.result === 'draw'); });
      B.forEach(function (t) { if (!A.has(t)) add(t, b.result === 'def', b.result === 'draw'); });
    });
    return Array.from(map.entries()).map(function (e) {
      const o = e[1];
      const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
      return { name: e[0], n: o.n, rate: rate, gap: rate === null ? null : rate - 0.5 };
    }).filter(function (x) { return x.n >= 3; })
      .sort(function (a, b) { return b.gap - a.gap || b.n - a.n; });
  }

  /* ---------------- 渲染辅助 ---------------- */

  /** 可折叠区块：默认只展开第一个，其余收起；展开状态由视图实例记住 */
  function section(title, note, opened) {
    const box = U.el('details', { class: 'ally-section fold' + (opened ? ' is-open' : '') }, [
      U.el('summary', { class: 'fold-summary' }, [
        U.el('span', { class: 'fold-title', text: title }),
        note ? U.el('span', { class: 'ally-note', text: note }) : null
      ])
    ]);
    if (opened) box.setAttribute('open', 'open');
    return box;
  }

  function tagLabel(gap) {
    if (gap === null) return '-';
    if (gap >= 0.15) return '极强';
    if (gap >= 0.08) return '强';
    if (gap >= 0.03) return '中';
    if (gap > -0.03) return '看不出';
    return '反直觉';
  }

  function impactList(rows, emptyText) {
    if (!rows.length) return U.el('div', { class: 'hint', text: emptyText });
    const maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.gap); })) || 0.01;
    const list = U.el('div', { class: 'dim-list' });
    rows.forEach(function (r) {
      list.appendChild(U.el('div', { class: 'dim-row' }, [
        U.el('div', { class: 'dim-name', title: r.name, text: r.name }),
        U.el('div', { class: 'dim-bar' }, [
          U.el('i', { style: { width: (Math.abs(r.gap) / maxAbs * 100) + '%', background: U.rateColor(r.rate) } })
        ]),
        U.el('div', { class: 'dim-rate', style: { color: U.rateColor(r.rate) }, text: U.fmtPct(r.rate, 0) }),
        U.el('div', { class: 'dim-gap', text: (r.gap >= 0 ? '+' : '') + (r.gap * 100).toFixed(0) + '%' }),
        U.el('div', { class: 'dim-n', text: r.n + ' 场' }),
        U.el('div', { class: 'dim-tag', text: tagLabel(r.gap) })
      ]));
    });
    return list;
  }

  /** 回合数分档（横条 + 胜率） */
  function roundStrip(bands, title) {
    if (!bands.length) return U.el('div', { class: 'hint', text: '没有回合数数据。' });
    const wrap = U.el('div', { class: 'rb-wrap' });
    if (title) wrap.appendChild(U.el('div', { class: 'rb-title', text: title }));
    bands.forEach(function (b) {
      wrap.appendChild(U.el('div', { class: 'rb-row' }, [
        U.el('div', { class: 'rb-label', text: b.label }),
        U.el('div', { class: 'rb-bar' }, [
          U.el('i', { style: { width: (U.clamp(b.rate, 0, 1) * 100) + '%', background: U.rateColor(b.rate) } })
        ]),
        U.el('div', { class: 'rb-rate', style: { color: U.rateColor(b.rate) }, text: U.fmtPct(b.rate, 0) }),
        U.el('div', { class: 'rb-n', text: b.n + ' 场' })
      ]));
    });
    return wrap;
  }

  function rateTable(rows, nameHead, emptyText) {
    if (!rows.length) return U.el('div', { class: 'hint', text: emptyText || '暂无样本' });
    const wrap = U.el('div', { class: 'ally-table hero-table' });
    wrap.appendChild(U.el('div', { class: 'ht-head' }, [
      U.el('div', { text: nameHead }), U.el('div', { text: '样本' }), U.el('div', { text: '胜率' })
    ]));
    rows.forEach(function (r) {
      wrap.appendChild(U.el('div', { class: 'ht-row' }, [
        U.el('div', { class: 'ht-name', title: r.name, text: r.name }),
        U.el('div', { text: r.n + ' 场' }),
        U.el('div', { style: { color: U.rateColor(r.rate) }, text: U.fmtPct(r.rate, 0) })
      ]));
    });
    return wrap;
  }

  function fmt(v) {
    if (v === null || v === undefined) return '-';
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US');
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  /* ---------------- 分析 ---------------- */

  /* ---------------- 逐武将对位 ----------------
     不同武将有各自的加点与装备，只看部队级汇总会互相抵消。
     这里按「武将名」把双方同一名武将配成一对，单看这个武将的差异。 */

  function heroByName(side) {
    const map = new Map();
    (side.heroes || []).forEach(function (h) {
      if (h.name) map.set(h.name, h);
    });
    return map;
  }

  /** 单个武将的对位维度（比部队级更细） */
  const HERO_DIMS = [
    { key: 'red', name: '红度', eps: 0.05, get: function (h) { return num(h.red); } },
    { key: 'pin', name: '品级', eps: 0.05, get: function (h) { return num(h.pin); } },
    { key: 'level', name: '等级', eps: 0.05, get: function (h) { return num(h.level); } },
    { key: 'ef', name: '装备武力', eps: 0.05, get: function (h) { return h.equipAttrs ? num(h.equipAttrs[0]) : null; } },
    { key: 'ei', name: '装备智力', eps: 0.05, get: function (h) { return h.equipAttrs ? num(h.equipAttrs[1]) : null; } },
    { key: 'ec', name: '装备统率', eps: 0.05, get: function (h) { return h.equipAttrs ? num(h.equipAttrs[2]) : null; } },
    { key: 'es', name: '装备速度', eps: 0.05, get: function (h) { return h.equipAttrs ? num(h.equipAttrs[3]) : null; } },
    { key: 'hf', name: '战马武力', eps: 0.05, get: function (h) { return h.horseAttrs ? num(h.horseAttrs[0]) : null; } },
    { key: 'hi', name: '战马智力', eps: 0.05, get: function (h) { return h.horseAttrs ? num(h.horseAttrs[1]) : null; } },
    { key: 'hc', name: '战马统率', eps: 0.05, get: function (h) { return h.horseAttrs ? num(h.horseAttrs[2]) : null; } },
    { key: 'hs', name: '战马速度', eps: 0.05, get: function (h) { return h.horseAttrs ? num(h.horseAttrs[3]) : null; } },
    { key: 'skillpin', name: '技能品级', eps: 0.05, get: function (h) {
      const p = (h.skillPins || []).map(function (x) { return num(x); })
        .filter(function (x) { return x !== null; });
      return p.length ? p.reduce(function (a, b) { return a + b; }, 0) / p.length : null;
    } }
  ];

  /* ---------------- 按「属性值」而不是「装备名」分析 ----------------
     装备/战马只是外壳，同名装备洗练出的属性值还会不同，
     所以真正该看的是属性值本身：这件装备给了多少武力/智力/统率/速度。 */

  /** 某个武将身上所有可分析的属性值来源（装备 4 项 + 战马 4 项） */
  const VALUE_SOURCES = [
    { key: 'equipForce', name: '装备武力', from: 'equipAttrs', idx: 0 },
    { key: 'equipInt', name: '装备智力', from: 'equipAttrs', idx: 1 },
    { key: 'equipCmd', name: '装备统率', from: 'equipAttrs', idx: 2 },
    { key: 'equipSpd', name: '装备速度', from: 'equipAttrs', idx: 3 },
    { key: 'horseForce', name: '战马武力', from: 'horseAttrs', idx: 0 },
    { key: 'horseInt', name: '战马智力', from: 'horseAttrs', idx: 1 },
    { key: 'horseCmd', name: '战马统率', from: 'horseAttrs', idx: 2 },
    { key: 'horseSpd', name: '战马速度', from: 'horseAttrs', idx: 3 }
  ];

  /** 把一组数值按「等宽」切成 4 档。
      用等宽而不是等频：属性值往往挤在一个窄区间里、只有少数极值，
      等频切出来的档宽会悬殊到没法看（如低档 5.9~10.2、中低档 10.3~10.6）。 */
  function makeBins(values) {
    const vs = values.slice().sort(function (a, b) { return a - b; });
    if (vs.length < 12) return null;
    const min = vs[0], max = vs[vs.length - 1];
    if (!(max > min)) return null;
    const step = (max - min) / 4;
    const cut = function (i) { return Math.round((min + step * i) * 10) / 10; };
    return [
      { label: '低', lo: -Infinity, hi: cut(1) },
      { label: '中低', lo: cut(1), hi: cut(2) },
      { label: '中高', lo: cut(2), hi: cut(3) },
      { label: '高', lo: cut(3), hi: Infinity }
    ];
  }

  /**
   * 属性值 -> 胜率。对每个属性：先把该武将出现过的所有取值收集起来分档，
   * 再统计「处在各档位时这名武将所在部队的胜率」。
   */
  function valueImpact(list, onlyHero) {
    // onlyHero 传武将名时，只统计该武将自己的属性值
    function pickHeroes(side) {
      return (side.heroes || []).filter(function (h) { return !onlyHero || h.name === onlyHero; });
    }
    // 收集取值
    const pool = {};
    VALUE_SOURCES.forEach(function (src) { pool[src.key] = []; });
    list.forEach(function (b) {
      [b.atk, b.def].forEach(function (side) {
        pickHeroes(side).forEach(function (h) {
          VALUE_SOURCES.forEach(function (src) {
            const arr = h[src.from];
            const v = arr ? num(arr[src.idx]) : null;
            if (v !== null) pool[src.key].push(v);
          });
        });
      });
    });

    const binsOf = {};
    VALUE_SOURCES.forEach(function (src) { binsOf[src.key] = makeBins(pool[src.key]); });

    const stat = {};
    VALUE_SOURCES.forEach(function (src) {
      stat[src.key] = { n: 0, win: 0, draw: 0, bins: new Map() };
    });

    list.forEach(function (b) {
      const drew = b.result === 'draw';
      [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
        const role = pair[0], side = pair[1];
        const won = !drew && b.result === role;
        pickHeroes(side).forEach(function (h) {
          VALUE_SOURCES.forEach(function (src) {
            const arr = h[src.from];
            const v = arr ? num(arr[src.idx]) : null;
            if (v === null) return;
            const s = stat[src.key];
            s.n++; if (drew) s.draw++; else if (won) s.win++;
            const bins = binsOf[src.key];
            if (!bins) return;
            const bin = bins.filter(function (bn) { return v >= bn.lo && v < bn.hi; })[0];
            if (!bin) return;
            let o = s.bins.get(bin.label);
            if (!o) { o = { n: 0, win: 0, draw: 0, lo: v, hi: v }; s.bins.set(bin.label, o); }
            o.n++;
            if (drew) o.draw++;
            else if (won) o.win++;
            if (v < o.lo) o.lo = v;
            if (v > o.hi) o.hi = v;
          });
        });
      });
    });

    return VALUE_SOURCES.map(function (src) {
      const s = stat[src.key];
      const bins = Array.from(s.bins.entries()).map(function (e) {
        const o = e[1];
        const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
        return {
          label: e[0], n: o.n, rate: rate,
          range: (Math.round(o.lo * 10) / 10) + ' ~ ' + (Math.round(o.hi * 10) / 10),
          order: ['低', '中低', '中高', '高'].indexOf(e[0])
        };
      }).sort(function (a, b) { return a.order - b.order; });

      // 高低档之间差多少 —— 一眼看出这个属性值到底有没有用
      const low = bins[0], high = bins[bins.length - 1];
      const spread = (low && high && low.n >= 5 && high.n >= 5 && low.rate !== null && high.rate !== null)
        ? high.rate - low.rate : null;

      return {
        key: src.key, name: src.name,
        avg: pool[src.key].length ? sum(pool[src.key]) / pool[src.key].length : null,
        bins: bins.filter(function (x) { return x.n >= 5; }),
        spread: spread
      };
    }).filter(function (x) { return x.bins.length >= 2; })
      .sort(function (a, b) {
        return (b.spread === null ? -9 : b.spread) - (a.spread === null ? -9 : a.spread);
      });
  }

  /* ---------------- 该武将的特技 / 特效影响 ----------------
     装备与战马一般自带特技或特效，这也是「配置」的一部分。
     这里统计：这名武将在这件装备/战马带某个特技时胜率如何，
     并和「这件装备/战马没有特技时」的基准做对比。 */

  const TRAIT_SOURCES = [
    { key: 'equipSkill', name: '装备特技', from: 'equipSkill' },
    { key: 'equipEffect', name: '装备特效', from: 'equipEffect' },
    { key: 'horseSkill', name: '战马特技', from: 'horseSkill' },
    { key: 'horseEffect', name: '战马特效', from: 'horseEffect' }
  ];

  function heroTraitImpact(list, heroName) {
    const out = {};
    // 金书（兵书）：一个武将带 3 本，逐本统计；基准用该武将的总体胜率
    const bookStat = { items: new Map(), base: { n: 0, win: 0, draw: 0 } };
    // 技能：该武将带的技能（最多 3 个），逐技能统计；基准用其总体胜率
    const skillStat = { items: new Map(), base: { n: 0, win: 0, draw: 0 } };

    TRAIT_SOURCES.forEach(function (src) {
      out[src.key] = { name: src.name, items: new Map(), none: { n: 0, win: 0, draw: 0 } };
    });

    list.forEach(function (b) {
      const drew = b.result === 'draw';
      [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
        const role = pair[0];
        const h = (pair[1].heroes || []).filter(function (x) { return x.name === heroName; })[0];
        if (!h) return;
        const won = !drew && b.result === role;

        // 金书：该武将的每一本都记一次；同时累计总体基准
        bookStat.base.n++; if (drew) bookStat.base.draw++; else if (won) bookStat.base.win++;
        (h.books || []).forEach(function (bk) {
          if (!bk) return;
          let o = bookStat.items.get(bk);
          if (!o) { o = { n: 0, win: 0, draw: 0 }; bookStat.items.set(bk, o); }
          o.n++; if (drew) o.draw++; else if (won) o.win++;
        });

        // 技能（同一技能占多槽位时每场只记一次）
        skillStat.base.n++; if (drew) skillStat.base.draw++; else if (won) skillStat.base.win++;
        const seenSkill = new Set();
        (h.skills || []).forEach(function (sk) {
          const nm = sk ? String(sk).replace(/\(Lv\d+\)$/, '').trim() : '';
          if (!nm || seenSkill.has(nm)) return;
          seenSkill.add(nm);
          let o = skillStat.items.get(nm);
          if (!o) { o = { n: 0, win: 0, draw: 0 }; skillStat.items.set(nm, o); }
          o.n++; if (drew) o.draw++; else if (won) o.win++;
        });

        TRAIT_SOURCES.forEach(function (src) {
          const v = h[src.from];
          const rec = out[src.key];
          if (v) {
            let o = rec.items.get(v);
            if (!o) { o = { n: 0, win: 0, draw: 0 }; rec.items.set(v, o); }
            o.n++; if (drew) o.draw++; else if (won) o.win++;
          } else {
            // 该位置没有特技 -> 基准组
            rec.none.n++; if (drew) rec.none.draw++; else if (won) rec.none.win++;
          }
        });
      });
    });

    return TRAIT_SOURCES.map(function (src) {
      const rec = out[src.key];
      const noneRate = rec.none.n ? (rec.none.win + rec.none.draw * 0.5) / rec.none.n : null;
      const items = Array.from(rec.items.entries()).map(function (e) {
        const o = e[1];
        const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
        return {
          name: e[0], n: o.n, rate: rate,
          delta: (rate !== null && noneRate !== null) ? rate - noneRate : null
        };
      }).filter(function (x) { return x.n >= 5; })
        .sort(function (a, b) { return b.rate - a.rate || b.n - a.n; });

      return {
        key: src.key, name: rec.name,
        noneN: rec.none.n, noneRate: noneRate,
        items: items
      };
    }).filter(function (x) { return x.items.length || x.noneN >= 5; })
      .concat([buildBookDim(bookStat), buildSkillDim(skillStat)]);
  }

  /** 技能维度：与该武将总体胜率对比（过滤掉几乎每场都带的技能） */
  function buildSkillDim(skillStat) {
    const baseRate = skillStat.base.n ? (skillStat.base.win + skillStat.base.draw * 0.5) / skillStat.base.n : null;
    const items = Array.from(skillStat.items.entries()).map(function (e) {
      const o = e[1];
      const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
      return {
        name: e[0], n: o.n, rate: rate,
        delta: (rate !== null && baseRate !== null) ? rate - baseRate : null
      };
    })
      .filter(function (x) { return x.n >= 5; })
      .sort(function (a, b) { return b.rate - a.rate || b.n - a.n; });
    return {
      key: 'skills', name: '技能', isSkill: true,
      noneN: skillStat.base.n, noneRate: baseRate,
      items: items
    };
  }

  /** 金书维度：与该武将总体胜率对比 */
  function buildBookDim(bookStat) {
    const baseRate = bookStat.base.n ? (bookStat.base.win + bookStat.base.draw * 0.5) / bookStat.base.n : null;
    const items = Array.from(bookStat.items.entries()).map(function (e) {
      const o = e[1];
      const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
      return {
        name: e[0], n: o.n, rate: rate,
        delta: (rate !== null && baseRate !== null) ? rate - baseRate : null
      };
    })
      // 几乎每场都带的书等于基准，没有对比价值，过滤掉
      .filter(function (x) { return x.n >= 5 && x.n < bookStat.base.n * 0.8; })
      .sort(function (a, b) { return b.rate - a.rate || b.n - a.n; });
    return {
      key: 'books', name: '金书（兵书）', isBook: true,
      noneN: bookStat.base.n, noneRate: baseRate,
      items: items
    };
  }

  /* ---------------- 按回合数分组 ----------------
     源数据里没有逐回合的过程明细（属性回合时序列全空），
     所以能做到的最细粒度是「按这场战斗打了几个回合」分组，
     看这名武将（或这套阵容）是擅长速决还是拖后期。 */
  const ROUND_BANDS = [
    { label: '1~2 回合（速决）', lo: 1, hi: 2 },
    { label: '3~4 回合', lo: 3, hi: 4 },
    { label: '5~6 回合', lo: 5, hi: 6 },
    { label: '7+ 回合（拉锯）', lo: 7, hi: Infinity }
  ];

  /**
   * 只统计「攻方」在各回合区间的胜率。
   * 不能把双方各记一次 —— 那样一胜一负必然抵消，每档都只会是 50%，毫无信息量。
   */
  function roundBands(list) {
    const stat = ROUND_BANDS.map(function (b) { return { label: b.label, n: 0, win: 0, draw: 0 }; });
    list.forEach(function (b) {
      const r = num(b.round);
      if (r === null) return;
      const band = ROUND_BANDS.filter(function (x) { return r >= x.lo && r <= x.hi; })[0];
      if (!band) return;
      const idx = ROUND_BANDS.indexOf(band);
      stat[idx].n++;
      if (b.result === 'draw') stat[idx].draw++;
      else if (b.result === 'atk') stat[idx].win++;
    });
    return stat.map(function (o) {
      const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
      return { label: o.label, n: o.n, rate: rate };
    }).filter(function (x) { return x.n > 0; });
  }

  function heroPairing(list) {
    const byHero = new Map();

    list.forEach(function (b) {
      const wonA = b.result === 'atk';
      const drew = b.result === 'draw';
      const wonB = b.result === 'def';
      const A = heroByName(b.atk);
      const B = heroByName(b.def);

      A.forEach(function (ha, name) {
        const hb = B.get(name);
        if (!hb) return;                      // 对方没有这个武将 -> 不算对位
        let rec = byHero.get(name);
        if (!rec) {
          rec = {
            name: name, n: 0,
            dimHit: new Map(),                 // 维度 -> {n, higherWin}
            equipAtk: new Map(), equipDef: new Map(),  // 该武将带某装备时的胜负
            skillOnly: new Map(),                      // 技能对位：一方带、另一方不带
            horseAtk: new Map(), horseDef: new Map(),
            samples: []
          };
          byHero.set(name, rec);
        }
        rec.n++;

        /* 技能对位：这名武将在 A 方带、B 方不带（或反过来）时，持有方赢了多少。
           比「带它 vs 总体」更有意义 —— 后者因技能长期固定，差异几乎为零。 */
        const skA = new Set((ha.skills || []).map(function (x) { return x ? String(x).replace(/\(Lv\d+\)$/, '').trim() : ''; }).filter(Boolean));
        const skB = new Set((hb.skills || []).map(function (x) { return x ? String(x).replace(/\(Lv\d+\)$/, '').trim() : ''; }).filter(Boolean));
        skA.forEach(function (nm) {
          if (skB.has(nm)) return;
          let o = rec.skillOnly.get(nm);
          if (!o) { o = { n: 0, win: 0, draw: 0 }; rec.skillOnly.set(nm, o); }
          o.n++; if (drew) o.draw++; else if (b.result === 'atk') o.win++;
        });
        skB.forEach(function (nm) {
          if (skA.has(nm)) return;
          let o = rec.skillOnly.get(nm);
          if (!o) { o = { n: 0, win: 0, draw: 0 }; rec.skillOnly.set(nm, o); }
          o.n++; if (drew) o.draw++; else if (b.result === 'def') o.win++;
        });

        // 维度对比
        HERO_DIMS.forEach(function (d) {
          const va = d.get(ha), vb = d.get(hb);
          if (va === null || vb === null) return;
          const diff = va - vb;
          if (Math.abs(diff) < d.eps) return;
          let o = rec.dimHit.get(d.key);
          if (!o) { o = { name: d.name, n: 0, higherWin: 0 }; rec.dimHit.set(d.key, o); }
          o.n++;
          const higherIsA = diff > 0;
          if (!drew && ((b.result === 'atk') === higherIsA)) o.higherWin++;
        });

        // 该武将带某件装备 / 战马时的胜负
        function mark(map, item, won) {
          if (!item) return;
          let o = map.get(item);
          if (!o) { o = { n: 0, win: 0, draw: 0 }; map.set(item, o); }
          o.n++;
          if (drew) o.draw++;
          else if (won) o.win++;
        }
        mark(rec.equipAtk, ha.equip, wonA);
        mark(rec.equipDef, hb.equip, wonB);
        mark(rec.horseAtk, ha.horse, wonA);
        mark(rec.horseDef, hb.horse, wonB);

        rec.samples.push({ A: ha, B: hb, result: b.result, id: b.id });
      });
    });

    return Array.from(byHero.values()).map(function (rec) {
      const dims = Array.from(rec.dimHit.values()).map(function (o) {
        const rate = o.n ? o.higherWin / o.n : null;
        return { name: o.name, n: o.n, rate: rate, gap: rate === null ? null : rate - 0.5 };
      }).filter(function (x) { return x.n >= 3; })
        .sort(function (a, b) { return b.gap - a.gap; });

      // 装备 / 战马：把双方合并成「该武将带它时的胜率」
      function merge(a, b) {
        const map = new Map();
        [a, b].forEach(function (src) {
          src.forEach(function (o, k) {
            let t = map.get(k);
            if (!t) { t = { n: 0, win: 0, draw: 0 }; map.set(k, t); }
            t.n += o.n; t.win += o.win; t.draw += o.draw;
          });
        });
        return Array.from(map.entries()).map(function (e) {
          const o = e[1];
          const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
          return { name: e[0], n: o.n, rate: rate, gap: rate === null ? null : rate - 0.5 };
        }).filter(function (x) { return x.n >= 3; })
          .sort(function (x, y) { return y.gap - x.gap || y.n - x.n; });
      }

      return {
        name: rec.name,
        n: rec.n,
        dims: dims,
        // 该武将自己的属性值分档（看「属性给到多少才有效」）
        valueDims: valueImpact(list, rec.name),
        // 该武将装备 / 战马的特技特效表现（与「无特技」基准对比）
        traitDims: heroTraitImpact(list, rec.name),
        // 技能对位（比总体口径更有区分度）
        skillPairs: Array.from(rec.skillOnly.entries()).map(function (e) {
          const o = e[1];
          const rate = o.n ? (o.win + o.draw * 0.5) / o.n : null;
          return { name: e[0], n: o.n, rate: rate, gap: rate === null ? null : rate - 0.5 };
        }).filter(function (x) { return x.n >= 3; })
          .sort(function (a, b) { return b.gap - a.gap || b.n - a.n; }),
        equips: merge(rec.equipAtk, rec.equipDef),
        horses: merge(rec.horseAtk, rec.horseDef),
        samples: rec.samples
      };
    }).sort(function (a, b) { return b.n - a.n; });
  }

  function groupMirrors(battles) {
    const groups = new Map();
    battles.forEach(function (b) {
      if (!b.atk || !b.def) return;
      if (b.atk.key !== b.def.key) return;      // 只看内战
      if (!b.atk.origin && !b.def.origin) return;
      /* 人数不满 3 的残缺队（1~2 个武将）是斯巴达队：翻地、占资源用，一般不主动打架，
         把它们算进内战对比没有意义（而且它们大多是零散挨打的样本）。 */
      if ((b.atk.size || 0) < 3 || (b.def.size || 0) < 3) return;
      let g = groups.get(b.atk.key);
      if (!g) {
        g = {
          key: b.atk.key,
          display: b.atk.display || b.atk.compRaw || b.atk.key,
          troopSig: b.atk.troopSig || '',
          list: []
        };
        groups.set(b.atk.key, g);
      }
      g.list.push(b);
    });
    return Array.from(groups.values()).sort(function (a, b) { return b.list.length - a.list.length; });
  }

  function report(g) {
    const list = g.list;
    let atkWins = 0, defWins = 0, draws = 0, rounds = 0;
    list.forEach(function (b) {
      if (b.result === 'atk') atkWins++;
      else if (b.result === 'def') defWins++;
      else draws++;
      rounds += b.round || 0;
    });
    return {
      key: g.key,
      display: g.display,
      troopSig: g.troopSig,
      n: list.length,
      atkWins: atkWins, defWins: defWins, draws: draws,
      atkRate: list.length ? (atkWins + draws * 0.5) / list.length : 0.5,
      avgRound: list.length ? rounds / list.length : 0,
      dims: dimensionImpact(list),
      equipSkills: exclusiveImpact(list, 'equipSkill'),
      equipEffects: exclusiveImpact(list, 'equipEffect'),
      horseSkills: exclusiveImpact(list, 'horseSkill'),
      horseEffects: exclusiveImpact(list, 'horseEffect'),
      equips: exclusiveImpact(list, 'equip'),
      horses: exclusiveImpact(list, 'horse'),
      books: exclusiveImpact(list, 'book'),
      heroPairs: heroPairing(list),
      roundBands: roundBands(list),
      list: list
    };
  }

  /* ---------------- 视图 ---------------- */

  function MirrorView(listHost, detailHost) {
    this.listHost = listHost;
    this.detailHost = detailHost;
    this.groups = [];
    this.selected = null;
  }

  MirrorView.prototype.render = function (battles) {
    this.groups = groupMirrors(battles).map(report);
    if (!this.groups.length) {
      this.listHost.innerHTML = '';
      this.detailHost.innerHTML = '';
      this.detailHost.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '60px 0' } }, [
        U.el('h3', { text: '当前数据里没有可分析的内战' }),
        U.el('p', { text: '内战指同一套阵容对同一套阵容。导入含这类对局的战报后，这里会显示双方配置差异对胜负的影响。' })
      ]));
      return;
    }
    const self = this;
    const keep = this.selected && this.groups.some(function (g) { return g.key === self.selected; });
    this.renderList();
    this.select(keep ? this.selected : this.groups[0].key);
  };

  MirrorView.prototype.renderList = function () {
    const self = this;
    this.listHost.innerHTML = '';
    this.groups.forEach(function (g) {
      const item = U.el('div', { class: 'ally-item', 'data-name': g.key }, [
        U.el('div', { class: 'ai-top' }, [
          U.el('div', { class: 'ai-name', title: g.display, text: g.display }),
          U.el('div', { class: 'ai-rate', text: g.n + ' 场' })
        ]),
        U.el('div', { class: 'ai-meta' }, [
          U.el('span', { text: '攻方胜率 ' + U.fmtPct(g.atkRate, 0) }),
          U.troopBadges(g.troopSig)
        ])
      ]);
      item.addEventListener('click', function () { self.select(g.key); });
      self.listHost.appendChild(item);
    });
  };

  /** 记录 / 读取折叠状态，重渲染后保持 */
  MirrorView.prototype.fold = function (name, def) {
    if (!this.foldState) this.foldState = {};
    if (this.foldState[name] === undefined) this.foldState[name] = !!def;
    return this.foldState[name];
  };

  MirrorView.prototype.bindFold = function (root) {
    const self = this;
    Array.prototype.forEach.call(root.querySelectorAll('details.fold'), function (node) {
      const title = node.querySelector('.fold-title');
      const name = title ? title.textContent.slice(0, 1) : '';
      const key = { '①': 'dims', '②': 'traits', '③': 'hero', '④': 'gear', '⑤': 'samples' }[name];
      if (!key) return;
      node.addEventListener('toggle', function () { self.foldState[key] = node.open; });
    });
  };

  MirrorView.prototype.select = function (key) {
    this.selected = key;
    Array.prototype.forEach.call(this.listHost.children, function (node) {
      node.classList.toggle('active', node.dataset.name === key);
    });
    const g = this.groups.filter(function (x) { return x.key === key; })[0];
    if (g) this.renderDetail(g);
    // 切换阵容后详情区从头看
    U.scrollTopAll(this.detailHost);
  };

  MirrorView.prototype.renderDetail = function (g) {
    const host = this.detailHost;
    host.innerHTML = '';

    host.appendChild(U.el('div', { class: 'ally-head' }, [
      U.el('h2', {}, [U.compWithTroop(g.display, g.troopSig)]),
      U.el('div', { class: 'ally-head-meta', text:
        g.n + ' 场内战 · 平均 ' + g.avgRound.toFixed(1) + ' 回合 · 双方阵容完全相同，胜负由配置与攻守方决定' })
    ]));

    host.appendChild(U.el('div', { class: 'ally-metrics' }, [
      U.el('div', { class: 'insp-cell' }, [
        U.el('div', { class: 'k', text: '内战场次' }), U.el('div', { class: 'v', text: g.n + ' 场' })
      ]),
      U.el('div', { class: 'insp-cell' }, [
        U.el('div', { class: 'k', text: '攻方胜率', title: '攻方 = 发起进攻的一方；注意这不等于「先动」，先攻属性在源数据里为空，无法判断谁真的先出手' }),
        U.el('div', { class: 'v', text: U.fmtPct(g.atkRate) }),
        U.el('div', { class: 'k', style: { marginTop: '2px' },
          text: '攻 ' + g.atkWins + ' 胜 / 守 ' + g.defWins + ' 胜 / 平 ' + g.draws })
      ])
    ]));

    /* ① 数值维度 */
    const s1 = section('① 数值维度对比', '逐项比较双方数值，「更高的一方」赢了多少 —— 按影响大小排序', this.fold('dims', true));
    s1.appendChild(impactList(g.dims.map(function (d) {
      return { name: d.name, n: d.n, rate: d.higherRate, gap: d.gap };
    }), '有差异的样本太少。'));
    if (g.roundBands && g.roundBands.length) {
      s1.appendChild(U.el('p', { class: 'hint', style: { marginTop: '10px' }, text:
        '攻方在不同回合数下的胜率。源数据没有逐回合过程明细（属性回合时序列为空），这是能做到的最细粒度 —— 可以看出这套阵容是速决型还是拉锯型：' }));
      s1.appendChild(roundStrip(g.roundBands));
    }
    host.appendChild(s1);

    /* ② 特技 / 特效 */
    const s2 = section('② 特技 / 特效对比', '只看「一方有、另一方没有」的对局，胜率 = 带着它的那一方赢了多少', this.fold('traits', true));
    const grid = U.el('div', { class: 'vs-grid' });
    [
      ['装备特技', g.equipSkills],
      ['装备特效', g.equipEffects],
      ['战马特技', g.horseSkills],
      ['战马特效', g.horseEffects]
    ].forEach(function (pair) {
      grid.appendChild(U.el('div', { class: 'vs-box' }, [
        U.el('div', { class: 'vs-box-t', text: pair[0] }),
        impactList(pair[1].slice(0, 10).map(function (x) {
          return { name: x.name, n: x.n, rate: x.rate, gap: x.gap };
        }), '没有「一方独占」的样本。')
      ]));
    });
    s2.appendChild(grid);
    host.appendChild(s2);

    /* ②.5 武将逐一对位 —— 不同武将有各自的加点与装备，必须拆开看 */
    const sHero = section('③ 武将逐一对位', '同一名武将在双方各自的加点 / 装备 / 战马 —— 选中武将看它自己的差异', this.fold('hero'));
    if (!g.heroPairs.length) {
      sHero.appendChild(U.el('div', { class: 'hint', text: '没有可对位的武将（双方阵中需有同名武将）。' }));
    } else {
      const heroList = U.el('div', { class: 'hp-list' });
      const heroDetail = U.el('div', { class: 'hp-detail' });

      const showHero = function (hp) {
        Array.prototype.forEach.call(heroList.children, function (n) {
          n.classList.toggle('active', n.dataset.hero === hp.name);
        });
        heroDetail.innerHTML = '';
        heroDetail.appendChild(U.el('div', { class: 'hp-head' }, [
          U.el('b', { text: hp.name }),
          U.el('span', { class: 'hp-head-n', text: '对位 ' + hp.n + ' 场' })
        ]));

        heroDetail.appendChild(U.el('div', { class: 'gear-sub', text: '属性差异对比（该武将自己，非部队平均）' }));
        heroDetail.appendChild(impactList(hp.dims.map(function (d) {
          return { name: d.name, n: d.n, rate: d.rate, gap: d.gap };
        }), '该武将的属性差异样本不足。'));

        // 属性值分档：装备/战马只是外壳，真正起作用的是它给的属性值
        if (hp.valueDims.length) {
          heroDetail.appendChild(U.el('div', { class: 'gear-sub', text: '属性值影响（该武将自己的装备 / 战马属性，按分位分成四档）' }));
          const vw = U.el('div', { class: 'val-list' });
          hp.valueDims.forEach(function (vd) {
            const row = U.el('div', { class: 'val-row' }, [
              U.el('div', { class: 'val-name', text: vd.name })
            ]);
            vd.bins.forEach(function (bn) {
              row.appendChild(U.el('div', { class: 'val-bin' }, [
                U.el('div', { class: 'val-bin-l', text: bn.label + ' ' + bn.range }),
                U.el('div', { class: 'val-bin-v' }, [
                  U.el('b', { style: { color: U.rateColor(bn.rate) }, text: U.fmtPct(bn.rate, 0) }),
                  U.el('span', { class: 'val-bin-n', text: bn.n + ' 场' })
                ])
              ]));
            });
            while (row.children.length < 5) row.appendChild(U.el('div', { class: 'val-bin', text: '-' }));
            const sp = vd.spread;
            row.appendChild(U.el('div', { class: 'val-spread', title: '最高档 - 最低档', text:
              sp === null ? '-' : (sp >= 0 ? '+' : '') + (sp * 100).toFixed(0) + '%' }));
            vw.appendChild(row);
          });
          heroDetail.appendChild(vw);
          heroDetail.appendChild(U.el('p', { class: 'hint', text:
            '看最右列「高低差」：正值越大，说明这项属性堆得越高越容易赢；接近 0 说明该属性对这名武将没什么用。' }));
        }


        // 特技 / 特效：装备与战马一般自带，同样属于配置，和属性值一起比
        if (hp.traitDims.length) {
          heroDetail.appendChild(U.el('div', { class: 'gear-sub', text: '特技 / 特效 / 金书影响（与该武将的「无特技」或总体基准对比）' }));
          const tw = U.el('div', { class: 'trait-list' });
          hp.traitDims.forEach(function (td) {
            const box = U.el('div', { class: 'trait-box' }, [
              U.el('div', { class: 'trait-head' }, [
                U.el('b', { text: td.name }),
                U.el('span', { class: 'trait-base', text:
                  '基准（无特技） ' + (td.noneRate === null ? '-' : U.fmtPct(td.noneRate, 0)) + ' / ' + td.noneN + ' 场' })
              ])
            ]);
            if (!td.items.length) {
              box.appendChild(U.el('div', { class: 'hint', text: '样本不足 5 场，暂不列。' }));
            } else {
              const tb = U.el('div', { class: 'trait-table' });
              tb.appendChild(U.el('div', { class: 'trait-row trait-row-h' }, [
                U.el('div', { text: td.name }),
                U.el('div', { text: '样本' }),
                U.el('div', { text: '胜率' }),
                U.el('div', { text: '对比基准' })
              ]));
              td.items.slice(0, 8).forEach(function (x) {
                tb.appendChild(U.el('div', { class: 'trait-row' }, [
                  U.el('div', { class: 'trait-name', title: x.name, text: x.name }),
                  U.el('div', { class: 'trait-n', text: x.n + ' 场' }),
                  U.el('div', { class: 'trait-rate', style: { color: U.rateColor(x.rate) }, text: U.fmtPct(x.rate, 0) }),
                  U.el('div', {
                    class: 'trait-delta ' + (x.delta === null ? '' : (x.delta > 0.02 ? 'pos' : (x.delta < -0.02 ? 'neg' : ''))),
                    text: x.delta === null ? '-' : (x.delta >= 0 ? '+' : '') + (x.delta * 100).toFixed(0) + '%'
                  })
                ]));
              });
              box.appendChild(tb);
            }
            tw.appendChild(box);
          });
          heroDetail.appendChild(tw);
        }
        // 技能对位：同名武将在双方带不同技能时，谁的胜率高
        if (hp.skillPairs && hp.skillPairs.length) {
          heroDetail.appendChild(U.el('div', { class: 'gear-sub', text:
            '技能对位（这名武将在某方带了它、另一方没带时，「带着它」的一方赢了多少）' }));
          const sk = U.el('div', { class: 'ally-table hero-table' });
          sk.appendChild(U.el('div', { class: 'ht-head' }, [
            U.el('div', { text: '技能' }), U.el('div', { text: '样本' }),
            U.el('div', { text: '持有方胜率' }), U.el('div', { text: '对比五五开' })
          ]));
          hp.skillPairs.slice(0, 10).forEach(function (x) {
            sk.appendChild(U.el('div', { class: 'ht-row' }, [
              U.el('div', { class: 'ht-name', title: x.name, text: x.name }),
              U.el('div', { text: x.n + ' 场' }),
              U.el('div', { style: { color: U.rateColor(x.rate) }, text: U.fmtPct(x.rate, 0) }),
              U.el('div', {
                class: 'trait-delta ' + (x.gap === null ? '' : (x.gap > 0.02 ? 'pos' : (x.gap < -0.02 ? 'neg' : ''))),
                text: x.gap === null ? '-' : (x.gap >= 0 ? '+' : '') + (x.gap * 100).toFixed(0) + '%'
              })
            ]));
          });
          heroDetail.appendChild(sk);
          heroDetail.appendChild(U.el('p', { class: 'hint', text:
            '同一名武将技能长期固定，用「带它 vs 总体」看不出差别；这里改成对位口径：' +
            '一方带了、另一方不带，才能反映这个技能在同等条件下的价值。' }));
        }

        // 该武将带某件装备 / 某匹马时的胜率（样本通常很小，仅作参考）
        if (hp.equips.length || hp.horses.length) {
          heroDetail.appendChild(U.el('details', { class: 'val-more' }, [
            U.el('summary', { text: '按具体装备 / 战马看（样本少，参考用）' }),
            U.el('div', { class: 'vs-grid', style: { marginTop: '8px' } }, [
              U.el('div', { class: 'vs-box' }, [
                U.el('div', { class: 'vs-box-t', text: hp.name + ' 带这件装备时的胜率' }),
                rateTable(hp.equips.slice(0, 8), '装备', '无样本')
              ]),
              U.el('div', { class: 'vs-box' }, [
                U.el('div', { class: 'vs-box-t', text: hp.name + ' 带这匹马时的胜率' }),
                rateTable(hp.horses.slice(0, 8), '战马', '无样本')
              ])
            ])
          ]));
        }
        // 逐场对位明细
        const cols = ['结果', '红度', '品级', '装备武力', '装备智力', '装备(攻/守)', '战马(攻/守)'];
        const head = U.el('div', { class: 'hp-head-row' }, cols.map(function (c) {
          return U.el('div', { text: c });
        }));
        const rows = hp.samples.slice(0, 25).map(function (sp) {
          const a = sp.A, b = sp.B;
          function pair(v1, v2, eps) {
            const n1 = num(v1), n2 = num(v2);
            if (n1 === null || n2 === null) return U.el('div', { class: 'mc-v mc-na', text: '-' });
            const d = n1 - n2;
            const cls = Math.abs(d) < (eps || 0.05) ? 'mc-v mc-eq' : (d > 0 ? 'mc-v mc-hi' : 'mc-v mc-lo');
            return U.el('div', { class: cls }, [
              U.el('b', { text: fmt(d > 0 ? n1 : n2) }),
              U.el('span', { class: 'mc-diff', text: ' ' + (d > 0 ? '+' : '') + fmt(d) })
            ]);
          }
          const eq = function (x, y) {
            const same = x === y;
            return U.el('div', { class: same ? 'mc-v mc-eq' : 'mc-v', title: x + ' / ' + y },
              [U.el('span', { text: (x || '-') + ' / ' + (y || '-') })]);
          };
          return U.el('div', { class: 'hp-row' }, [
            U.el('div', { class: 'mc-win ' + (sp.result === 'atk' ? 'is-atk' : (sp.result === 'draw' ? 'is-draw' : 'is-def')),
              text: sp.result === 'atk' ? '攻方胜' : (sp.result === 'draw' ? '平' : '守方胜') }),
            pair(a.red, b.red), pair(a.pin, b.pin),
            pair(a.equipAttrs && a.equipAttrs[0], b.equipAttrs && b.equipAttrs[0]),
            pair(a.equipAttrs && a.equipAttrs[1], b.equipAttrs && b.equipAttrs[1]),
            eq(a.equip, b.equip), eq(a.horse, b.horse)
          ]);
        });
        heroDetail.appendChild(U.el('div', { class: 'gear-sub', text: '逐场对位明细（每格为较高一方；装备 / 战马显示 攻 / 守）' }));
        heroDetail.appendChild(U.el('div', { class: 'hp-table' }, [head].concat(rows)));
      };

      g.heroPairs.forEach(function (hp) {
        const item = U.el('div', { class: 'hp-item', 'data-hero': hp.name, title: hp.name }, [
          U.el('span', { class: 'hp-name', text: hp.name }),
          U.el('span', { class: 'hp-n', text: hp.n + ' 场' })
        ]);
        item.addEventListener('click', function () { showHero(hp); });
        heroList.appendChild(item);
      });
      sHero.appendChild(U.el('div', { class: 'hp-wrap' }, [heroList, heroDetail]));
      showHero(g.heroPairs[0]);
    }
    host.appendChild(sHero);

    /* ③ 装备 / 战马 / 兵书 */
    const s3 = section('④ 装备 / 战马 / 兵书对比', '同样是「一方有、另一方没有」的口径', this.fold('gear'));
    s3.appendChild(U.el('div', { class: 'vs-grid' }, [
      U.el('div', { class: 'vs-box' }, [
        U.el('div', { class: 'vs-box-t', text: '装备' }),
        rateTable(g.equips.slice(0, 10), '装备', '没有独有样本')
      ]),
      U.el('div', { class: 'vs-box' }, [
        U.el('div', { class: 'vs-box-t', text: '战马' }),
        rateTable(g.horses.slice(0, 10), '战马', '没有独有样本')
      ])
    ]));
    s3.appendChild(U.el('div', { class: 'gear-sub', text: '兵书（独有时胜率，前 12 本）' }));
    s3.appendChild(rateTable(g.books.slice(0, 12), '兵书', '没有独有样本'));
    host.appendChild(s3);

    /* ④ 逐场明细 */
    const s4 = section('⑤ 部队级逐场明细', '每一场的双方数值与差值（绿=更高，红=更低）', this.fold('samples'));
    const dimKeys = g.dims.slice(0, 8).map(function (d) { return d.key; });
    const dimMap = {};
    DIMS.forEach(function (d) { dimMap[d.key] = d; });
    const head = U.el('div', { class: 'mc-head' },
      [U.el('div', { text: '#' }), U.el('div', { text: '结果' })].concat(
        dimKeys.map(function (k) { return U.el('div', { text: dimMap[k].name }); })));
    const rows = g.list.slice(0, 30).map(function (b, i) {
      const cells = [
        U.el('div', { class: 'mc-idx', text: '#' + (i + 1) }),
        U.el('div', {
          class: 'mc-win ' + (b.result === 'atk' ? 'is-atk' : (b.result === 'draw' ? 'is-draw' : 'is-def')),
          text: b.result === 'atk' ? '攻方胜' : (b.result === 'draw' ? '平' : '守方胜')
        })
      ];
      dimKeys.forEach(function (k) {
        const d = dimMap[k];
        const va = d.get(b.atk), vb = d.get(b.def);
        if (va === null || vb === null) {
          cells.push(U.el('div', { class: 'mc-v mc-na', text: '-' }));
          return;
        }
        const diff = va - vb;
        const cls = Math.abs(diff) < d.eps ? 'mc-v mc-eq' : (diff > 0 ? 'mc-v mc-hi' : 'mc-v mc-lo');
        cells.push(U.el('div', { class: cls, title: d.name + ' 攻 ' + fmt(va) + ' / 守 ' + fmt(vb) }, [
          U.el('b', { text: fmt(diff > 0 ? va : vb) }),
          U.el('span', { class: 'mc-diff', text: ' ' + (diff > 0 ? '+' : '') + fmt(diff) })
        ]));
      });
      return U.el('div', { class: 'mc-row' }, cells);
    });
    s4.appendChild(U.el('div', { class: 'mc-table' }, [head].concat(rows)));
    s4.appendChild(U.el('p', { class: 'hint', text:
      '每格是较高一方的数值与差值。若胜方普遍显示绿色，说明内战基本就是拼配置。' +
      (g.list.length > 30 ? '（只显示前 30 场）' : '') }));
    host.appendChild(s4);
    this.bindFold(host);
  };

  AC.MirrorView = MirrorView;
  AC.mirrorAnalysis = {
    report: report,
    groupMirrors: groupMirrors,
    dimensionImpact: dimensionImpact,
    exclusiveImpact: exclusiveImpact,
    heroPairing: heroPairing,
    roundBands: roundBands,
    DIMS: DIMS
  };
})(window.AC);
