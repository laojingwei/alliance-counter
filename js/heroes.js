window.AC = window.AC || {};

/* ============================================================
   武将 / 技能 / 装备分析
   数据来自明细表：每支部队带若干武将，每个武将带技能、兵书、装备、战马、红度、觉醒。
   胜率口径：该武将（或技能）出现在场上时，其所在部队的胜负。
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;

  /** 技能名形如「草船借箭(Lv10)」，拆出基础名与等级，便于不同等级归并 */
  function parseSkill(name) {
    const m = /^(.*?)\s*[（(]\s*Lv\.?\s*(\d+)\s*[)）]\s*$/.exec(String(name));
    if (m) return { base: m[1].trim(), level: Number(m[2]) };
    return { base: String(name).trim(), level: null };
  }

  function bump(map, key, won, draw) {
    let o = map.get(key);
    if (!o) { o = { n: 0, win: 0, loss: 0, draw: 0 }; map.set(key, o); }
    o.n++;
    if (draw) o.draw++;
    else if (won) o.win++;
    else o.loss++;
    return o;
  }

  function build(result) {
    const heroes = new Map();
    const skills = new Map();
    const items = new Map();

    function getHero(name) {
      let h = heroes.get(name);
      if (!h) {
        h = {
          name: name, n: 0, win: 0, loss: 0, draw: 0,
          redSum: 0, redN: 0, awakenSum: 0, awakenN: 0, levelSum: 0, levelN: 0,
          pinSum: 0, pinN: 0,
          troops: new Map(), groups: new Map(), skills: new Map(), books: new Map(),
          equips: new Map(), horses: new Map(), mates: new Map(),
          alliances: new Map(), players: new Map(), vs: new Map(),
          byRed: new Map(), byPin: new Map(),
          traits: new Map()
        };
        heroes.set(name, h);
      }
      return h;
    }
    function getSkill(base) {
      let s = skills.get(base);
      if (!s) {
        s = { name: base, n: 0, win: 0, loss: 0, draw: 0, levelSum: 0, levelN: 0, pinSum: 0, pinN: 0, heroes: new Map() };
        skills.set(base, s);
      }
      return s;
    }
    function getItem(name, type) {
      const key = type + '|' + name;
      let it = items.get(key);
      if (!it) { it = { name: name, type: type, n: 0, win: 0, loss: 0, draw: 0, heroes: new Map() }; items.set(key, it); }
      return it;
    }

    result.battles.forEach(function (b) {
      const sides = [
        { role: 'atk', side: b.atk, opp: b.def },
        { role: 'def', side: b.def, opp: b.atk }
      ];
      const isDraw = b.result === 'draw';

      sides.forEach(function (t) {
        const side = t.side;
        if (!side.heroes || !side.heroes.length) return;
        const won = !isDraw && b.result === t.role;

        // 搭档关系（同队其余武将）
        const names = side.heroes.map(function (x) { return x.name; }).filter(Boolean);

        side.heroes.forEach(function (hd) {
          if (!hd.name) return;
          const h = getHero(hd.name);
          h.n++;
          if (isDraw) h.draw++; else if (won) h.win++; else h.loss++;
          if (hd.red !== null && hd.red !== undefined) {
            h.redSum += hd.red; h.redN++;
            bump(h.byRed, hd.red, won, isDraw);          // 红度 -> 胜负
          }
          if (hd.pin !== null && hd.pin !== undefined) {
            h.pinSum += hd.pin; h.pinN++;
            bump(h.byPin, hd.pin, won, isDraw);          // 品级 -> 胜负
          }
          if (hd.awaken !== null && hd.awaken !== undefined) { h.awakenSum += hd.awaken; h.awakenN++; }
          if (hd.level !== null && hd.level !== undefined) { h.levelSum += hd.level; h.levelN++; }
          if (hd.troop) h.troops.set(hd.troop, (h.troops.get(hd.troop) || 0) + 1);
          if (hd.group) h.groups.set(hd.group, (h.groups.get(hd.group) || 0) + 1);
          if (side.alliance) h.alliances.set(side.alliance, (h.alliances.get(side.alliance) || 0) + 1);
          if (side.player) h.players.set(side.player, (h.players.get(side.player) || 0) + 1);

          names.forEach(function (other) {
            if (other === hd.name) return;
            const m = h.mates.get(other) || { n: 0, win: 0, draw: 0 };
            m.n++; if (isDraw) m.draw++; else if (won) m.win++;
            h.mates.set(other, m);
          });

          const oppKey = t.opp.key;
          if (oppKey) {
            const v = h.vs.get(oppKey) || { n: 0, win: 0, draw: 0 };
            v.n++; if (isDraw) v.draw++; else if (won) v.win++;
            h.vs.set(oppKey, v);
          }

          (hd.skills || []).forEach(function (raw, si) {
            if (!raw) return;
            const p = parseSkill(raw);
            const pin = (hd.skillPins || [])[si];
            const hs = h.skills.get(p.base) || { n: 0, win: 0, draw: 0, levelSum: 0, levelN: 0, pin: pin };
            hs.n++; if (isDraw) hs.draw++; else if (won) hs.win++;
            if (p.level !== null) { hs.levelSum += p.level; hs.levelN++; }
            if (hs.pin === undefined || hs.pin === null) hs.pin = pin;
            h.skills.set(p.base, hs);

            const s = getSkill(p.base);
            s.n++;
            if (isDraw) s.draw++; else if (won) s.win++; else s.loss++;
            if (p.level !== null) { s.levelSum += p.level; s.levelN++; }
            if (pin !== null && pin !== undefined) { s.pinSum += pin; s.pinN++; }
            s.heroes.set(hd.name, (s.heroes.get(hd.name) || 0) + 1);
          });

          (hd.books || []).forEach(function (bk) {
            if (!bk) return;
            const hb = h.books.get(bk) || { n: 0, win: 0, draw: 0 };
            hb.n++; if (isDraw) hb.draw++; else if (won) hb.win++;
            h.books.set(bk, hb);
          });

          // 装备 / 战马 与其特技、特效
          const trait = function (name, type) {
            if (!name) return;
            const ht = h.traits.get(name) || { name: name, type: type, n: 0, win: 0, draw: 0 };
            ht.n++; if (isDraw) ht.draw++; else if (won) ht.win++;
            h.traits.set(name, ht);
            const it = getItem(name, type);
            it.n++; if (isDraw) it.draw++; else if (won) it.win++; else it.loss++;
            it.heroes.set(hd.name, (it.heroes.get(hd.name) || 0) + 1);
          };

          if (hd.equip) {
            const he = h.equips.get(hd.equip) || { n: 0, win: 0, draw: 0 };
            he.n++; if (isDraw) he.draw++; else if (won) he.win++;
            h.equips.set(hd.equip, he);
            const it = getItem(hd.equip, '装备');
            it.n++; if (isDraw) it.draw++; else if (won) it.win++; else it.loss++;
            it.heroes.set(hd.name, (it.heroes.get(hd.name) || 0) + 1);
          }
          trait(hd.equipSkill, '装备特技');
          trait(hd.equipEffect, '装备特效');

          if (hd.horse) {
            const hh = h.horses.get(hd.horse) || { n: 0, win: 0, draw: 0 };
            hh.n++; if (isDraw) hh.draw++; else if (won) hh.win++;
            h.horses.set(hd.horse, hh);
            const it = getItem(hd.horse, '战马');
            it.n++; if (isDraw) it.draw++; else if (won) it.win++; else it.loss++;
            it.heroes.set(hd.name, (it.heroes.get(hd.name) || 0) + 1);
          }
          trait(hd.horseSkill, '战马特技');
          trait(hd.horseEffect, '战马特效');
        });
      });
    });

    /* ---- 派生指标 ---- */
    const rateOf = function (o) { return o.n ? (o.win + o.draw * 0.5) / o.n : 0.5; };

    heroes.forEach(function (h) {
      h.rate = rateOf(h);
      h.redAvg = h.redN ? h.redSum / h.redN : null;
      h.pinAvg = h.pinN ? h.pinSum / h.pinN : null;
      h.awakenAvg = h.awakenN ? h.awakenSum / h.awakenN : null;
      h.levelAvg = h.levelN ? h.levelSum / h.levelN : null;
      h.troopList = Array.from(h.troops.entries()).sort(function (a, b) { return b[1] - a[1]; });
      h.groupList = Array.from(h.groups.entries()).sort(function (a, b) { return b[1] - a[1]; });
      // 红度 / 品级 -> 胜率 曲线
      h.byRedList = Array.from(h.byRed.entries()).map(function (e) {
        return { value: Number(e[0]), n: e[1].n, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return a.value - b.value; });
      h.byPinList = Array.from(h.byPin.entries()).map(function (e) {
        return { value: Number(e[0]), n: e[1].n, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return a.value - b.value; });
      h.traitList = Array.from(h.traits.values()).map(function (v) {
        return { name: v.name, type: v.type, n: v.n, rate: rateOf(v) };
      }).sort(function (a, b) { return b.n - a.n; });
      h.skillList = Array.from(h.skills.entries()).map(function (e) {
        return { name: e[0], n: e[1].n, win: e[1].win, draw: e[1].draw, rate: rateOf(e[1]), pin: e[1].pin };
      }).sort(function (a, b) { return b.n - a.n; });
      h.bookList = Array.from(h.books.entries()).map(function (e) {
        return { name: e[0], n: e[1].n, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return b.n - a.n; });
      h.equipList = Array.from(h.equips.entries()).map(function (e) {
        return { name: e[0], n: e[1].n, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return b.n - a.n; });
      h.horseList = Array.from(h.horses.entries()).map(function (e) {
        return { name: e[0], n: e[1].n, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return b.n - a.n; });
      h.mateList = Array.from(h.mates.entries()).map(function (e) {
        return { name: e[0], n: e[1].n, win: e[1].win, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return b.n - a.n; });
      h.vsList = Array.from(h.vs.entries()).map(function (e) {
        return { key: e[0], n: e[1].n, win: e[1].win, rate: rateOf(e[1]) };
      }).sort(function (a, b) { return b.n - a.n; });
      h.mainAlliance = '';
      let best = -1;
      h.alliances.forEach(function (v, k) { if (v > best) { best = v; h.mainAlliance = k; } });
    });

    skills.forEach(function (s) {
      s.rate = rateOf(s);
      s.levelAvg = s.levelN ? s.levelSum / s.levelN : null;
      s.pinAvg = s.pinN ? s.pinSum / s.pinN : null;
      s.heroList = Array.from(s.heroes.entries()).sort(function (a, b) { return b[1] - a[1]; });
    });

    items.forEach(function (it) {
      it.rate = rateOf(it);
      it.heroList = Array.from(it.heroes.entries()).sort(function (a, b) { return b[1] - a[1]; });
    });

    const heroList = Array.from(heroes.values()).sort(function (a, b) { return b.n - a.n || b.rate - a.rate; });
    const skillList = Array.from(skills.values()).sort(function (a, b) { return b.n - a.n; });
    const equipList = Array.from(items.values()).filter(function (x) { return x.type === '装备'; })
      .sort(function (a, b) { return b.n - a.n; });
    const horseList = Array.from(items.values()).filter(function (x) { return x.type === '战马'; })
      .sort(function (a, b) { return b.n - a.n; });
    const traitList = Array.from(items.values()).filter(function (x) {
      return x.type.indexOf('特技') >= 0 || x.type.indexOf('特效') >= 0;
    }).sort(function (a, b) { return b.n - a.n; });

    return { heroes: heroList, heroMap: heroes, skills: skillList, equips: equipList, horses: horseList, traits: traitList };
  }

  /* ==================== 渲染 ==================== */

  function bar(pct, color) {
    return U.el('div', { class: 'mini-bar' }, [
      U.el('i', { style: { width: U.clamp(pct, 0, 1) * 100 + '%', background: color || U.rateColor(0.5) } })
    ]);
  }

  function metric(k, v, sub) {
    return U.el('div', { class: 'insp-cell' }, [
      U.el('div', { class: 'k', text: k }),
      U.el('div', { class: 'v' }, [typeof v === 'string' ? U.el('span', { text: v }) : v]),
      sub ? U.el('div', { class: 'k', style: { marginTop: '2px' }, text: sub }) : null
    ]);
  }

  function section(title, note) {
    return U.el('div', { class: 'ally-section' }, [
      U.el('h3', {}, [
        U.el('span', { text: title }),
        note ? U.el('span', { class: 'ally-note', text: note }) : null
      ])
    ]);
  }

  /** 通用小表格：[名称, 场次, 胜率, 备注] */
  function miniTable(rows, columns, onPick) {
    const wrap = U.el('div', { class: 'ally-table hero-table' });
    wrap.appendChild(U.el('div', { class: 'ht-head' }, columns.map(function (c) {
      return U.el('div', { text: c });
    })));
    rows.forEach(function (r) {
      const row = U.el('div', { class: 'ht-row' }, columns.map(function (c, i) {
        const v = r.cells[i];
        // 第一列若是阵容名，带上兵种徽章
        if (i === 0 && r.troopSig) {
          return U.el('div', { class: 'ht-name', title: String(v) }, [U.compWithTroop(String(v), r.troopSig)]);
        }
        const style = (c === '胜率') ? { color: U.rateColor(r.rate === undefined ? 0.5 : r.rate) } : null;
        return U.el('div', { class: i === 0 ? 'ht-name' : '', style: style, title: String(v), text: String(v) });
      }));
      if (onPick && r.key) row.addEventListener('click', function () { onPick(r.key); });
      wrap.appendChild(row);
    });
    return wrap;
  }

  function HeroesView(listHost, detailHost, callbacks) {
    this.listHost = listHost;
    this.detailHost = detailHost;
    this.cb = callbacks || {};
    this.result = null;
    this.data = null;
    this.selected = null;
  }

  HeroesView.prototype.render = function (result) {
    this.result = result;
    this.data = build(result);

    if (!this.data.heroes.length) {
      this.listHost.innerHTML = '';
      this.detailHost.innerHTML = '';
      this.detailHost.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '60px 0' } }, [
        U.el('h3', { text: '当前数据里没有武将明细' }),
        U.el('p', { text: '武将 / 技能 / 装备分析需要「武将级明细表」。在左侧导入那种一场战斗多行的明细表即可看到这里的内容。' })
      ]));
      return;
    }

    const keep = this.selected && this.data.heroMap.has(this.selected);
    this.renderList();
    this.select(keep ? this.selected : this.data.heroes[0].name);
  };

  HeroesView.prototype.renderList = function () {
    const self = this;
    this.listHost.innerHTML = '';
    this.data.heroes.forEach(function (h) {
      const item = U.el('div', { class: 'ally-item', 'data-name': h.name }, [
        U.el('div', { class: 'ai-top' }, [
          U.el('div', { class: 'ai-name', title: h.name, text: h.name }),
          U.el('div', { class: 'ai-rate', text: U.fmtPct(h.rate, 0) })
        ]),
        U.el('div', { class: 'ai-meta' }, [
          U.el('span', { text: h.n + ' 场' + (h.redAvg !== null ? ' · 均红 ' + h.redAvg.toFixed(1) : '') }),
          h.troopList.length ? U.troopBadge(h.troopList[0][0]) : null
        ]),
        bar(h.rate, U.rateColor(h.rate))
      ]);
      item.addEventListener('click', function () { self.select(h.name); });
      self.listHost.appendChild(item);
    });
  };

  HeroesView.prototype.select = function (name) {
    this.selected = name;
    Array.prototype.forEach.call(this.listHost.children, function (node) {
      node.classList.toggle('active', node.dataset.name === name);
    });
    const h = this.data.heroMap.get(name);
    if (h) this.renderDetail(h);
  };

  HeroesView.prototype.renderDetail = function (h) {
    const host = this.detailHost;
    const self = this;
    const result = this.result;
    host.innerHTML = '';

    host.appendChild(U.el('div', { class: 'ally-head' }, [
      U.el('h2', { text: h.name }),
      U.el('div', {
        class: 'ally-head-meta',
        text: h.n + ' 场出场 · 胜率 ' + U.fmtPct(h.rate) + (h.mainAlliance ? ' · 主要在 ' + h.mainAlliance : '')
      })
    ]));

    host.appendChild(U.el('div', { class: 'ally-metrics' }, [
      metric('出场', h.n + ' 场', h.win + '胜 ' + h.loss + '负 ' + h.draw + '平'),
      metric('胜率', U.fmtPct(h.rate), '与所在部队同胜负'),
      metric('平均红度', h.redAvg === null ? '-' : h.redAvg.toFixed(2), '越高说明投入越多'),
      metric('平均品级', h.pinAvg === null ? '-' : h.pinAvg.toFixed(2), h.awakenAvg !== null ? '平均觉醒 ' + h.awakenAvg.toFixed(2) : ''),
      metric('平均等级', h.levelAvg === null ? '-' : h.levelAvg.toFixed(1), ''),
      // 单个武将的兵种：给具体名称 + 徽章
      metric('兵种',
        h.troopList.length
          ? U.el('span', { class: 'troop-inline' }, [
              U.troopBadge(h.troopList[0][0]),
              U.el('span', { class: 'troop-name', text: h.troopList[0][0] })
            ])
          : '-',
        h.groupList.length ? '编组 ' + h.groupList[0][0] : '')
    ]));

    // 红度 / 品级 -> 胜率（同一武将不同培养程度的实际表现）
    const curve = section('红度 / 品级 与胜率', '同一武将不同培养程度的实际表现');
    const mkCurve = function (title, list, unit) {
      const box = U.el('div', { class: 'curve-box' });
      box.appendChild(U.el('div', { class: 'curve-title', text: title }));
      if (!list.length) {
        box.appendChild(U.el('div', { class: 'hint', text: '暂无数据' }));
        return box;
      }
      const mx = Math.max.apply(null, list.map(function (x) { return x.n; })) || 1;
      list.forEach(function (x) {
        box.appendChild(U.el('div', { class: 'curve-row' }, [
          U.el('div', { class: 'curve-label', text: unit + x.value }),
          U.el('div', { class: 'curve-bar' }, [
            U.el('i', { style: { width: (x.n / mx) * 100 + '%', background: U.rateColor(x.rate) } })
          ]),
          U.el('div', { class: 'curve-n', text: x.n + ' 场' }),
          U.el('div', { class: 'curve-rate', style: { color: U.rateColor(x.rate) }, text: U.fmtPct(x.rate, 0) })
        ]));
      });
      return box;
    };
    curve.appendChild(mkCurve('红度', h.byRedList, '红'));
    curve.appendChild(mkCurve('品级', h.byPinList, '品'));
    host.appendChild(curve);

    // 常带技能
    const ss = section('常带技能', '按携带场次');
    if (!h.skillList.length) ss.appendChild(U.el('div', { class: 'hint', text: '暂无技能数据。' }));
    else {
      ss.appendChild(miniTable(h.skillList.slice(0, 8).map(function (x) {
        const pinTag = (x.pin === null || x.pin === undefined) ? '' : '（' + x.pin + '品）';
        return { key: x.name, rate: x.rate, cells: [x.name + pinTag, x.n + ' 场', U.fmtPct(x.rate, 0)] };
      }), ['技能', '携带', '胜率'], function (key) { if (self.cb.onPickSkill) self.cb.onPickSkill(key); }));
    }
    host.appendChild(ss);

    // 兵书 / 装备 / 战马
    const gems = section('常用兵书 / 装备 / 战马');
    const gemRows = [];
    h.bookList.slice(0, 4).forEach(function (x) { gemRows.push({ key: null, rate: x.rate, cells: ['兵书 ' + x.name, x.n + ' 场', U.fmtPct(x.rate, 0)] }); });
    h.equipList.slice(0, 3).forEach(function (x) { gemRows.push({ key: null, rate: x.rate, cells: ['装备 ' + x.name, x.n + ' 场', U.fmtPct(x.rate, 0)] }); });
    h.horseList.slice(0, 3).forEach(function (x) { gemRows.push({ key: null, rate: x.rate, cells: ['战马 ' + x.name, x.n + ' 场', U.fmtPct(x.rate, 0)] }); });
    if (!gemRows.length) gems.appendChild(U.el('div', { class: 'hint', text: '暂无数据。' }));
    else gems.appendChild(miniTable(gemRows, ['搭配', '携带', '胜率']));
    host.appendChild(gems);

    // 最佳搭档
    const ms = section('最佳搭档', '同队出场 ≥3 场，按胜率与场次排序');
    const mates = h.mateList.filter(function (m) { return m.n >= 3; })
      .sort(function (a, b) { return b.rate - a.rate || b.n - a.n; }).slice(0, 6);
    if (!mates.length) ms.appendChild(U.el('div', { class: 'hint', text: '暂无足够样本的搭档。' }));
    else {
      ms.appendChild(miniTable(mates.map(function (m) {
        return { key: m.name, rate: m.rate, cells: [m.name, m.n + ' 场', U.fmtPct(m.rate, 0)] };
      }), ['搭档', '同队', '胜率'], function (key) { self.select(key); }));
    }
    host.appendChild(ms);

    // 对阵表现
    const vs = section('对阵阵容表现', '该武将 vs 对手阵容');
    const vsRows = h.vsList.filter(function (v) { return v.n >= 3; }).slice(0, 8).map(function (v) {
      const node = result.nodeMap.get(v.key);
      return { key: v.key, rate: v.rate, cells: [node ? node.display : v.key, v.n + ' 场', U.fmtPct(v.rate, 0)] , troopSig: node ? node.troopSig : '' };
    });
    if (!vsRows.length) vs.appendChild(U.el('div', { class: 'hint', text: '暂无足够样本。' }));
    else vs.appendChild(miniTable(vsRows, ['对手阵容', '交手', '胜率'], function (key) { if (self.cb.onPickComp) self.cb.onPickComp(key); }));
    host.appendChild(vs);

    // 技能强度榜
    const ranks = section('技能强度榜', '按携带场次，胜率 = 携带者所在部队胜率');
    ranks.appendChild(miniTable(this.data.skills.slice(0, 12).map(function (s) {
      const pinTag = s.pinAvg === null ? '' : '（均 ' + s.pinAvg.toFixed(1) + ' 品）';
      return { key: null, rate: s.rate, cells: [s.name + pinTag, s.n + ' 场', U.fmtPct(s.rate, 0)] };
    }), ['技能', '携带', '胜率']));
    host.appendChild(ranks);

    // 特技 / 特效强度榜
    if (this.data.traits.length) {
      const tr = section('特技 / 特效强度榜', '装备与战马的特技、特效');
      tr.appendChild(miniTable(this.data.traits.slice(0, 10).map(function (it) {
        return { key: null, rate: it.rate, cells: [it.type + ' ' + it.name, it.n + ' 场', U.fmtPct(it.rate, 0)] };
      }), ['名称', '携带', '胜率']));
      host.appendChild(tr);
    }

    // 装备 / 战马榜
    const eq = section('装备 / 战马强度榜', '胜率 = 佩戴者所在部队胜率');
    const eqRows = this.data.equips.slice(0, 6).map(function (it) {
      return { key: null, rate: it.rate, cells: ['装备 ' + it.name, it.n + ' 场', U.fmtPct(it.rate, 0)] };
    }).concat(this.data.horses.slice(0, 4).map(function (it) {
      return { key: null, rate: it.rate, cells: ['战马 ' + it.name, it.n + ' 场', U.fmtPct(it.rate, 0)] };
    }));
    eq.appendChild(miniTable(eqRows, ['名称', '携带', '胜率']));
    host.appendChild(eq);
  };

  AC.HeroesView = HeroesView;
  AC.heroAnalysis = { build: build, parseSkill: parseSkill };
})(window.AC);
