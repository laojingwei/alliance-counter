/* ============================================================
   装备与兵书分析
   ------------------------------------------------------------
   明细表里每个武将都带：装备（名 / 特技 / 特效 / 武力·智力·统率·速度）、
   战马（同上一套）、兵书（名，含「善本 / 手抄 / 残章」等品级）。
   这一页把它们逐个量化：胜率 = 佩戴者 / 携带者所在部队的胜负。
   ============================================================ */
window.AC = window.AC || {};

(function (AC) {
  'use strict';

  const U = AC.util;

  // 属性分档（区间可解释，比按分位数切更好理解）
  const EQUIP_BINS = [
    { label: '< 7', min: -Infinity, max: 7 },
    { label: '7 ~ 9', min: 7, max: 9 },
    { label: '9 ~ 11', min: 9, max: 11 },
    { label: '≥ 11', min: 11, max: Infinity }
  ];
  const HORSE_BINS = [
    { label: '< 5', min: -Infinity, max: 5 },
    { label: '5 ~ 7', min: 5, max: 7 },
    { label: '7 ~ 9', min: 7, max: 9 },
    { label: '≥ 9', min: 9, max: Infinity }
  ];
  const ATTR_NAMES = ['武力', '智力', '统率', '速度'];

  function rateOf(o) { return o.n ? (o.win + o.draw * 0.5) / o.n : 0.5; }

  function bump(map, key, won, draw) {
    let o = map.get(key);
    if (!o) { o = { n: 0, win: 0, draw: 0 }; map.set(key, o); }
    o.n++;
    if (draw) o.draw++;
    else if (won) o.win++;
    return o;
  }

  /** 兵书的品级：从《XX》善本 这种名字里取后缀 */
  function bookGrade(name) {
    const m = /》([^》]*)$/.exec(String(name));
    const tag = m && m[1] ? m[1] : '';
    return tag || '未标注';
  }

  function toList(map, minN) {
    return Array.from(map.entries()).map(function (e) {
      return { name: e[0], n: e[1].n, win: e[1].win, draw: e[1].draw, rate: rateOf(e[1]) };
    }).filter(function (x) { return x.n >= (minN || 1); })
      .sort(function (a, b) { return b.rate - a.rate || b.n - a.n; });
  }

  /**
   * @param battles 战斗记录（用 store.battles，包含全部对局）
   */
  function analyze(battles) {
    const trait = new Map();      // 装备特技
    const effect = new Map();     // 装备特效
    const htrait = new Map();     // 战马特技
    const heffect = new Map();    // 战马特效
    const equips = new Map();     // 装备名
    const horses = new Map();     // 战马名
    const books = new Map();      // 兵书
    const bookGrades = new Map(); // 兵书品级
    // 属性 → 分档
    const attr = { equip: [], horse: [] };
    ATTR_NAMES.forEach(function () {
      attr.equip.push(new Map());
      attr.horse.push(new Map());
    });
    // 属性原始值分布（算均值用）
    const attrSum = { equip: [0, 0, 0, 0], horse: [0, 0, 0, 0] };
    const attrN = [0, 0, 0, 0, 0, 0, 0, 0];
    // 具体数值 -> 胜负：让页面能直接列出「哪个属性值胜率多少」
    const attrByValue = { equip: [], horse: [] };
    const attrValues = { equip: [], horse: [] };
    ATTR_NAMES.forEach(function () {
      attrByValue.equip.push(new Map()); attrByValue.horse.push(new Map());
      attrValues.equip.push([]); attrValues.horse.push([]);
    });

    let heroRows = 0;

    battles.forEach(function (b) {
      const isDraw = b.result === 'draw';
      [['atk', b.atk], ['def', b.def]].forEach(function (pair) {
        const role = pair[0], side = pair[1];
        const won = !isDraw && b.result === role;
        (side.heroes || []).forEach(function (h) {
          heroRows++;
          if (h.equipSkill) bump(trait, h.equipSkill, won, isDraw);
          if (h.equipEffect) bump(effect, h.equipEffect, won, isDraw);
          if (h.horseSkill) bump(htrait, h.horseSkill, won, isDraw);
          if (h.horseEffect) bump(heffect, h.horseEffect, won, isDraw);
          if (h.equip) bump(equips, h.equip, won, isDraw);
          if (h.horse) bump(horses, h.horse, won, isDraw);

          (h.books || []).forEach(function (bk) {
            if (!bk) return;
            bump(books, bk, won, isDraw);
            const g = bookGrade(bk);
            let o = bookGrades.get(g);
            if (!o) { o = { n: 0, win: 0, draw: 0 }; bookGrades.set(g, o); }
            o.n++; if (isDraw) o.draw++; else if (won) o.win++;
          });

          // 数值属性分档
          [['equip', h.equipAttrs, EQUIP_BINS, 0], ['horse', h.horseAttrs, HORSE_BINS, 4]].forEach(function (cfg) {
            const kind = cfg[0], vals = cfg[1] || [], bins = cfg[2], base = cfg[3];
            let allPresent = true;
            ATTR_NAMES.forEach(function (nm, k) {
              const v = vals[k];
              if (v === null || v === undefined || isNaN(v)) { allPresent = false; return; }
              const idx = base + k;
              attrSum[kind][k] += v; attrN[idx]++;
              attrValues[kind][k].push(v);
              bump(attrByValue[kind][k], v, won, isDraw);
              const bin = bins.filter(function (bn) { return v >= bn.min && v < bn.max; })[0];
              if (bin) bump(attr[kind][k], bin.label, won, isDraw);
            });
            if (!allPresent) { /* 缺项也照常统计已有的，不做特殊处理 */ }
          });
        });
      });
    });

    const attrReport = function (kind, bins) {
      return ATTR_NAMES.map(function (nm, k) {
        const map = attr[kind][k];
        const total = attrSum[kind][k];
        const nAll = (kind === 'equip' ? attrN[k] : attrN[4 + k]) || 0;
        const values = attrValues[kind][k];
        const sorted = values.slice().sort(function (a, b) { return a - b; });
        const distinctAll = new Set(values.map(function (v) { return v.toFixed(1); })).size;
        return {
          name: nm,
          avg: nAll ? total / nAll : null,
          min: sorted.length ? sorted[0] : null,
          max: sorted.length ? sorted[sorted.length - 1] : null,
          distinct: distinctAll,
          bins: bins.map(function (bn) {
            const o = map.get(bn.label);
            const inRange = values.filter(function (v) { return v >= bn.min && v < bn.max; });
            const lo = inRange.length ? Math.min.apply(null, inRange) : null;
            const hi = inRange.length ? Math.max.apply(null, inRange) : null;
            return {
              label: bn.label, n: o ? o.n : 0, rate: o ? rateOf(o) : null,
              // 这一档里实际出现过的数值范围与取值种数
              actual: lo === null ? '' : (lo.toFixed(1) + ' ~ ' + hi.toFixed(1)),
              distinct: new Set(inRange.map(function (v) { return v.toFixed(1); })).size
            };
          }).filter(function (x) { return x.n > 0; }),
          // 具体数值排行：直接看「哪个属性值胜率高」
          topValues: toList(attrByValue[kind][k], 1).slice(0, 12),
          valueCount: attrByValue[kind][k].size
        };
      });
    };

    return {
      heroRows: heroRows,
      traits: toList(trait, 3),
      effects: toList(effect, 3),
      horseTraits: toList(htrait, 3),
      horseEffects: toList(heffect, 3),
      equips: toList(equips, 5),
      horses: toList(horses, 5),
      books: toList(books, 5),
      bookGrades: Array.from(bookGrades.entries()).map(function (e) {
        return { name: e[0], n: e[1].n, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return b.n - a.n; }),
      equipAttr: attrReport('equip', EQUIP_BINS),
      horseAttr: attrReport('horse', HORSE_BINS)
    };
  }

  /* ==================== 渲染 ==================== */

  function section(title, note) {
    return U.el('div', { class: 'ally-section' }, [
      U.el('h3', {}, [
        U.el('span', { text: title }),
        note ? U.el('span', { class: 'ally-note', text: note }) : null
      ])
    ]);
  }

  function miniTable(rows, columns, opts) {
    const wrap = U.el('div', { class: 'ally-table hero-table' + (opts && opts.wide ? ' gear-wide' : '') });
    wrap.appendChild(U.el('div', { class: 'ht-head' }, columns.map(function (c) {
      return U.el('div', { text: c });
    })));
    rows.forEach(function (r) {
      wrap.appendChild(U.el('div', { class: 'ht-row' }, columns.map(function (c, i) {
        const v = r.cells[i];
        const style = (c === '胜率') ? { color: U.rateColor(r.rate === undefined ? 0.5 : r.rate) }
          : (c === '样本' ? { color: '#8fa3c4' } : null);
        return U.el('div', { class: i === 0 ? 'ht-name' : '', style: style, title: String(v), text: String(v) });
      })));
    });
    return wrap;
  }

  /** 两个表格并排 */
  function twoCol(left, right) {
    return U.el('div', { class: 'gear-two' }, [left, right]);
  }

  /** 属性区块：分档趋势 + 每档实际区间 + 具体数值排行 */
  function attrBlock(report) {
    const wrap = U.el('div', { class: 'gear-attr-block' });
    report.forEach(function (a) {
      const card = U.el('div', { class: 'gear-attr-card' });

      card.appendChild(U.el('div', { class: 'gear-attr-head' }, [
        U.el('b', { text: a.name }),
        U.el('span', {
          class: 'gear-attr-meta',
          text: '均值 ' + (a.avg === null ? '-' : a.avg.toFixed(1)) +
            ' · 范围 ' + (a.min === null ? '-' : a.min.toFixed(1) + ' ~ ' + a.max.toFixed(1)) +
            ' · ' + a.valueCount + ' 种取值'
        })
      ]));

      const bins = U.el('div', { class: 'gear-bins' });
      a.bins.forEach(function (bn) {
        bins.appendChild(U.el('div', { class: 'gear-bin2' }, [
          U.el('div', { class: 'gear-bin2-l', text: bn.label }),
          U.el('div', { class: 'gear-bin2-r', style: { color: U.rateColor(bn.rate) }, text: U.fmtPct(bn.rate, 0) }),
          U.el('div', { class: 'gear-bin2-n', text: U.fmtInt(bn.n) + ' 场' }),
          U.el('div', { class: 'gear-bin2-a', text: bn.actual ? '实际 ' + bn.actual : '' }),
          U.el('div', { class: 'gear-bin2-a', text: bn.distinct + ' 种取值' })
        ]));
      });
      card.appendChild(bins);

      if (a.topValues.length) {
        card.appendChild(U.el('div', { class: 'gear-vals-label', text: '具体取值表现（前 ' + a.topValues.length + ' 名）' }));
        card.appendChild(U.el('div', { class: 'gear-vals' }, a.topValues.map(function (v) {
          return U.el('span', { class: 'gear-val', title: '属性值 ' + v.name + ' · ' + v.n + ' 场 · 胜率 ' + U.fmtPct(v.rate, 0) }, [
            U.el('b', { style: { color: U.rateColor(v.rate) }, text: String(v.name) }),
            U.el('span', { class: 'gear-val-n', text: v.n + ' 场 ' + U.fmtPct(v.rate, 0) })
          ]);
        })));
      }
      wrap.appendChild(card);
    });
    return wrap;
  }
  function GearView(host) {
    this.host = host;
  }

  GearView.prototype.render = function (battles) {
    const host = this.host;
    const data = analyze(battles);
    host.innerHTML = '';

    if (!data.heroRows) {
      host.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '60px 0' } }, [
        U.el('h3', { text: '当前数据里没有装备 / 兵书信息' }),
        U.el('p', { text: '这一页需要武将级明细表（含装备、战马、兵书等列）。导入那种一场战斗多行的明细表即可看到内容。' })
      ]));
      return;
    }

    host.appendChild(U.el('div', { class: 'gear-head' }, [
      U.el('h2', { text: '装备 · 战马 · 兵书' }),
      U.el('p', {
        class: 'hint',
        text: '共 ' + U.fmtInt(data.heroRows) + ' 条武将记录。胜率口径统一为「佩戴 / 携带它的武将所在部队的胜负」，' +
          '样本不足的条目（少于 3~5 场）已过滤。'
      })
    ]));

    /* ---- 1. 特技 ---- */
    const s1 = section('特技', '装备与战马的特技，胜率 = 佩戴者所在部队的胜负');
    const t1 = miniTable(data.traits.slice(0, 14).map(function (x) {
      return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
    }), ['装备特技', '样本', '胜率']);
    const t2 = miniTable(data.horseTraits.slice(0, 14).map(function (x) {
      return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
    }), ['战马特技', '样本', '胜率']);
    s1.appendChild(twoCol(t1, t2));
    host.appendChild(s1);

    /* ---- 2. 特效 ---- */
    const s2 = section('特效', '装备与战马的特效');
    s2.appendChild(twoCol(
      miniTable(data.effects.slice(0, 14).map(function (x) {
        return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
      }), ['装备特效', '样本', '胜率']),
      miniTable(data.horseEffects.slice(0, 14).map(function (x) {
        return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
      }), ['战马特效', '样本', '胜率'])
    ));
    host.appendChild(s2);

    /* ---- 3. 属性高低对胜率的影响 ---- */
    const s3 = section('属性高低对胜率的影响', '把装备 / 战马的武力、智力、统率、速度分档，看是不是「堆得越高越强」');
    s3.appendChild(U.el('div', { class: 'gear-sub', text: '装备属性' }));
    s3.appendChild(attrBlock(data.equipAttr));
    s3.appendChild(U.el('div', { class: 'gear-sub', text: '战马属性' }));
    s3.appendChild(attrBlock(data.horseAttr));
    host.appendChild(s3);

    /* ---- 4. 装备 / 战马 ---- */
    const s4 = section('装备与战马', '按胜率排序（至少 5 场）');
    s4.appendChild(twoCol(
      miniTable(data.equips.slice(0, 15).map(function (x) {
        return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
      }), ['装备', '样本', '胜率']),
      miniTable(data.horses.slice(0, 15).map(function (x) {
        return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
      }), ['战马', '样本', '胜率'])
    ));
    host.appendChild(s4);

    /* ---- 5. 兵书 ---- */
    const s5 = section('兵书', '含品级分组（善本 / 手抄 / 残章 等是兵书的版本等级）');
    s5.appendChild(miniTable(data.bookGrades.map(function (x) {
      return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
    }), ['品级', '样本', '胜率']));
    s5.appendChild(U.el('div', { class: 'gear-sub', text: '具体兵书（前 18 本）' }));
    s5.appendChild(miniTable(data.books.slice(0, 18).map(function (x) {
      return { cells: [x.name, x.n + ' 场', U.fmtPct(x.rate, 0)], rate: x.rate };
    }), ['兵书', '样本', '胜率']));
    host.appendChild(s5);
  };

  AC.GearView = GearView;
  AC.gearAnalysis = { analyze: analyze, bookGrade: bookGrade };
})(window.AC);
