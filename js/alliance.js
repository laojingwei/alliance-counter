window.AC = window.AC || {};

/* ============================================================
   同盟分析
   1) 聚合每个同盟的出战画像：主流队伍、惯用阵型、主力玩家、活跃时段
   2) 反制建议：以该同盟的出场分布为权重，遍历全部候选阵容，
      用全局对抗数据算出「期望胜率」与「覆盖度」
   3) 逐队伍单点克制：针对它每套主流队伍，列出最能打的阵容
   ============================================================ */
(function (AC) {
  'use strict';

  const U = AC.util;

  /* ==================== 一、聚合 ==================== */

  /**
   * 单个武将的配置指纹。
   * 技能 / 技能品级 / 兵书 / 装备（含特技特效）/ 战马（含特技特效）任一不同，
   * 就算作另一套配置；兵种、红度、等级属于养成程度，不参与区分。
   */
  function heroConfigSig(h) {
    if (!h) return '-';
    return [
      h.name || '',
      (h.skills || []).join('\u0001'),
      (h.skillPins || []).join('\u0001'),
      (h.books || []).join('\u0001'),
      h.equip || '', h.equipSkill || '', h.equipEffect || '',
      h.horse || '', h.horseSkill || '', h.horseEffect || ''
    ].join('\u0002');
  }

  /** 一整支部队的配置指纹（与武将顺序无关）；阵型不同也算另一套配置 */
  function compConfigSig(heroes, formation) {
    return (heroes || []).map(heroConfigSig).sort().join('\u0003') + '\u0004' + (formation || '');
  }

  /* ---------------- 阵型站位表 ----------------
     取自游戏内「阵型」预览：r=1 前排 / r=2 后排，c=1..3 为从左到右的列。
     slots 的顺序就是武将的填充顺序（先前排后后排），与游戏内一致。 */
  const FORMATIONS = {
    '一字阵': {
      note: '前排受到伤害降低 8%',
      slots: [{ r: 1, c: 1 }, { r: 1, c: 2 }, { r: 1, c: 3 }]
    },
    '箕形阵': {
      note: '前排受到伤害降低 6%，后排造成伤害提升 12%',
      slots: [{ r: 1, c: 2 }, { r: 2, c: 2 }, { r: 2, c: 3 }]
    },
    '雁形阵': {
      note: '前排统率提升 20 点，后排造成伤害提升 15%',
      slots: [{ r: 1, c: 2 }, { r: 1, c: 3 }, { r: 2, c: 1 }]
    },
    '方圆阵': {
      note: '前排受到伤害降低 5%，后排连击率提升 40%',
      slots: [{ r: 1, c: 1 }, { r: 1, c: 2 }, { r: 2, c: 3 }]
    },
    '锥形阵': {
      note: '前排造成伤害提升 16%，后排受到伤害降低 5%',
      slots: [{ r: 1, c: 2 }, { r: 2, c: 1 }, { r: 2, c: 3 }]
    },
    '鱼鳞阵': {
      note: '前排规避率提升 12%，后排会心和奇谋几率提升 8%',
      slots: [{ r: 1, c: 1 }, { r: 2, c: 2 }, { r: 2, c: 3 }]
    },
    '钩行阵': {
      note: '前排受到伤害降低 8%，后排连击率提升 25%',
      slots: [{ r: 1, c: 3 }, { r: 2, c: 1 }, { r: 2, c: 2 }]
    },
    '偃月阵': {
      note: '前排造成伤害提升 14%，后排受到伤害降低 5%',
      slots: [{ r: 1, c: 1 }, { r: 1, c: 3 }, { r: 2, c: 2 }]
    }
  };

  /** 取阵型名对应的中文别名（游戏里也叫「阵型名」），并给出站位与特性 */
  function formationOf(name) {
    const key = String(name || '').replace(/阵$/, '') + '阵';
    if (FORMATIONS[key]) return { name: key, note: FORMATIONS[key].note, slots: FORMATIONS[key].slots };
    return null;
  }

  /* ---------------- 阵容配置详情浮层 ----------------
     同一套阵容（相同的武将组合）玩家常常换技能 / 兵书 / 装备 / 战马，
     这里把每一种配置分别列出。武将卡样式参考游戏内战报：卡面 + 技能 + 装备。 */
  /** 一个武将的配置卡（紧凑版：技能/兵书横排标签，装马单行） */
  function heroCard(h) {
    const card = U.el('div', { class: 'hc-hero' });
    const avatar = AC.heroIcon ? AC.heroIcon(h.name, 'hc-hero-face') : U.el('div', { class: 'hc-hero-face' });

    card.appendChild(U.el('div', { class: 'hc-hero-head' }, [
      avatar,
      U.el('div', { class: 'hc-hero-id' }, [
        U.el('div', { class: 'hc-hero-name' }, [
          U.el('span', { text: h.name || '-' }),
          h.troop ? U.troopBadge(h.troop) : null
        ]),
        U.el('div', { class: 'hc-hero-sub' }, [
          U.el('span', { text: 'Lv ' + (h.level === null || h.level === undefined ? '-' : Math.round(h.level)) }),
          (h.red === null || h.red === undefined) ? null : U.el('span', { class: 'hc-red', text: '红 ' + h.red }),
          (h.pin === null || h.pin === undefined) ? null : U.el('span', { text: '品 ' + h.pin })
        ])
      ])
    ]));

    /** 一行标签：左侧固定小标题，右侧自动换行的标签 */
    function chipRow(label, chips) {
      const list = chips.filter(Boolean);
      if (!list.length) return null;
      return U.el('div', { class: 'hc-block' }, [
        U.el('span', { class: 'hc-block-t', text: label }),
        U.el('div', { class: 'hc-chips' }, list)
      ]);
    }

    // 技能（带品级）
    const skillChips = [];
    (h.skills || []).forEach(function (s, i) {
      if (!s) return;
      const pin = (h.skillPins || [])[i];
      skillChips.push(U.el('span', { class: 'hc-chip', title: s }, [
        U.el('span', { text: s }),
        (pin === null || pin === undefined) ? null : U.el('span', { class: 'hc-pin', text: pin + '品' })
      ]));
    });
    card.appendChild(chipRow('技能', skillChips));

    // 兵书
    card.appendChild(chipRow('兵书', (h.books || []).map(function (bk) {
      return bk ? U.el('span', { class: 'hc-chip', title: bk, text: bk }) : null;
    })));

    // 装备 / 战马：各压成一行（名称 + 特技 + 特效）
    card.appendChild(chipRow('装备', h.equip ? [
      U.el('span', { class: 'hc-chip hc-chip-gear', title: h.equip, text: h.equip }),
      h.equipSkill ? U.el('span', { class: 'hc-extra', text: '特技·' + h.equipSkill }) : null,
      h.equipEffect ? U.el('span', { class: 'hc-extra', text: '特效·' + h.equipEffect }) : null
    ] : []));
    card.appendChild(chipRow('战马', h.horse ? [
      U.el('span', { class: 'hc-chip hc-chip-gear', title: h.horse, text: h.horse }),
      h.horseSkill ? U.el('span', { class: 'hc-extra', text: '特技·' + h.horseSkill }) : null,
      h.horseEffect ? U.el('span', { class: 'hc-extra', text: '特效·' + h.horseEffect }) : null
    ] : []));

    return card;
  }

  /** 一个配置块：可选头部（场次/胜率）+ 阵型条 + 按阵型站位的武将 */
  function configBlock(cfg, index, opts) {
    opts = opts || {};
    const box = U.el('div', { class: 'hc-cfg' + (index === 0 ? ' main' : '') });

    if (!opts.hideHead) {
      box.appendChild(U.el('div', { class: 'hc-cfg-head' }, [
        U.el('span', { class: 'hc-cfg-rank', text: index === 0 ? '最常用' : '配置 ' + (index + 1) }),
        U.el('span', { class: 'hc-cfg-n', text: cfg.n + ' 场' }),
        (cfg.rate === null || cfg.rate === undefined) ? null
          : U.el('span', { class: 'hc-cfg-rate', style: { color: U.rateColor(cfg.rate) }, text: '胜率 ' + U.fmtPct(cfg.rate, 0) }),
        (cfg.redAvg === null || cfg.redAvg === undefined) ? null
          : U.el('span', { class: 'hc-cfg-red', text: '均红 ' + cfg.redAvg.toFixed(1) }),
        cfg.lastTs ? U.el('span', {
          class: 'hc-cfg-time',
          text: '最近 ' + new Date(cfg.lastTs).toLocaleString('zh-CN', { hour12: false })
        }) : null
      ]));
    }

    // 阵型：有对应阵型就按游戏内的前后排站位摆放，否则退回平铺
    const fm = formationOf(cfg.formation);
    box.appendChild(U.el('div', { class: 'hc-fm-bar' }, [
      U.el('span', { class: 'hc-fm-name', text: cfg.formation || '阵型未知' }),
      fm ? U.el('span', { class: 'hc-fm-note', text: fm.note })
        : U.el('span', { class: 'hc-fm-note', text: '（该阵型暂无站位数据，已按顺序平铺）' })
    ]));

    if (fm) {
      const board = U.el('div', { class: 'fm-board' });
      [[1, '前排'], [2, '后排']].forEach(function (lane) {
        const r = lane[0];
        const slots = fm.slots.filter(function (s) { return s.r === r; });
        const wrap = U.el('div', { class: 'fm-lane' + (slots.length ? '' : ' empty') }, [
          U.el('div', { class: 'fm-lane-t', text: lane[1] + (slots.length ? '（' + slots.length + ' 人）' : '（无人）') })
        ]);
        const grid = U.el('div', { class: 'fm-slots' });
        slots.forEach(function (s) {
          grid.appendChild(U.el('div', { class: 'fm-slot', style: { gridColumn: String(s.c) } }));
        });
        wrap.appendChild(grid);
        board.appendChild(wrap);
      });
      const slotNodes = Array.prototype.slice.call(board.querySelectorAll('.fm-slot'));
      (cfg.heroes || []).forEach(function (h, i) {
        const target = slotNodes[i] || slotNodes[slotNodes.length - 1];
        if (target) {
          target.appendChild(heroCard(h));
          target.classList.add('filled');
        }
      });
      box.appendChild(board);
    } else {
      const grid = U.el('div', { class: 'hc-heroes' });
      (cfg.heroes || []).forEach(function (h) { grid.appendChild(heroCard(h)); });
      box.appendChild(grid);
    }
    return box;
  }

  /** 通用浮层外壳：返回 { mask, body, close } */
  function makePopup() {
    const mask = U.el('div', { class: 'bl-mask' });
    const panel = U.el('div', { class: 'bl-panel hc-panel' });
    const body = U.el('div', { class: 'hc-body' });
    function close() {
      mask.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function finish(titleNode) {
      panel.appendChild(U.el('div', { class: 'bl-title' }, [
        titleNode,
        U.el('button', { class: 'bl-close', text: '×', title: '关闭（Esc）', onclick: close })
      ]));
      panel.appendChild(body);
      mask.appendChild(panel);
      mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
      document.body.appendChild(mask);
      document.addEventListener('keydown', onKey);
    }
    return { mask: mask, body: body, close: close, finish: finish };
  }

  function openCompConfig(playerName, player, comp) {
    const configs = comp.configList || [];
    const pop = makePopup();

    pop.finish(U.el('div', { class: 'bl-title-l' }, [
      U.el('b', { text: playerName }),
      U.el('span', { text: ' · ' }),
      U.el('span', {}, [U.compWithTroop(comp.display, comp.troopSig)]),
      U.el('span', { class: 'hc-count', text: '共 ' + configs.length + ' 种配置 · ' + comp.n + ' 场' })
    ]));

    if (!configs.length) {
      pop.body.appendChild(U.el('div', { class: 'hint', text: '这套阵容没有可展示的配置明细（需要导入带技能 / 装备列的明细表）。' }));
    } else {
      configs.forEach(function (cfg, i) {
        pop.body.appendChild(configBlock(cfg, i));
      });
    }
  }

  /**
   * 通用入口：按一份配置列表弹窗（阵容详情页的「推荐配置」等复用）
   * opts.sorts      形如 [{key:'n',label:'按场次'},{key:'rate',label:'按胜率'}]，给了就显示排序切换
   * opts.defaultSort 默认排序键
   * opts.sub(key, n) 副标题（随排序键变化，可传字符串）
   */
  function openConfigList(title, sub, configs, opts) {
    configs = configs || [];
    opts = opts || {};
    const sorts = opts.sorts || null;
    let sortKey = opts.defaultSort || (sorts ? sorts[0].key : null);
    const pop = makePopup();

    const subNode = U.el('span', { class: 'hc-count' });
    const sortBar = U.el('div', { class: 'hc-sort' });

    /** 小样本保护：胜率排序时按收缩胜率比较，避免「1 场 100%」霸榜 */
    function shrunk(c) {
      const n = c.n || 0;
      if (!n) return 0.5;
      return (c.rate * n + 0.5 * 3) / (n + 3);
    }

    function sortList() {
      if (!sorts) return configs.slice();
      const list = configs.slice();
      if (sortKey === 'rate') {
        list.sort(function (a, b) { return shrunk(b) - shrunk(a) || (b.n || 0) - (a.n || 0); });
      } else if (sortKey === 'exchange') {
        list.sort(function (a, b) {
          const ae = (a.exchange === null || a.exchange === undefined) ? 99 : a.exchange;
          const be = (b.exchange === null || b.exchange === undefined) ? 99 : b.exchange;
          return ae - be || (b.n || 0) - (a.n || 0);
        });
      } else {
        list.sort(function (a, b) { return (b.n || 0) - (a.n || 0) || shrunk(b) - shrunk(a); });
      }
      return list;
    }

    function render() {
      pop.body.innerHTML = '';
      const list = sortList();
      subNode.textContent = typeof sub === 'function' ? sub(sortKey, list.length) : (sub || '');
      if (!list.length) {
        pop.body.appendChild(U.el('div', { class: 'hint', text: '这套阵容没有可展示的配置明细（需要导入带技能 / 装备列的明细表）。' }));
        return;
      }
      list.forEach(function (cfg, i) {
        pop.body.appendChild(configBlock(cfg, i));
      });
    }

    if (sorts) {
      sorts.forEach(function (s) {
        sortBar.appendChild(U.el('button', {
          class: 'hc-sort-btn' + (s.key === sortKey ? ' on' : ''),
          title: s.tip || '',
          text: s.label,
          onclick: function () {
            if (sortKey === s.key) return;
            sortKey = s.key;
            sortBar.querySelectorAll('.hc-sort-btn').forEach(function (b) { b.classList.remove('on'); });
            this.classList.add('on');
            render();
          }
        }));
      });
    }

    pop.finish(U.el('div', { class: 'bl-title-l' }, [
      U.el('b', { text: title }),
      subNode,
      sorts ? sortBar : null
    ]));

    render();
  }

  /** 战报浮层里某一方的配置详情（单场：直接取该场的武将快照 + 阵型） */
  function openSideConfig(playerName, side, opts) {
    opts = opts || {};
    const pop = makePopup();

    pop.finish(U.el('div', { class: 'bl-title-l' }, [
      U.el('b', { text: playerName }),
      U.el('span', { text: ' · ' }),
      U.el('span', {}, [U.compWithTroop(side.compRaw || side.display || '-', side.troopSig)]),
      opts.sub ? U.el('span', { class: 'hc-count', text: opts.sub }) : null
    ]));

    pop.body.appendChild(configBlock({
      heroes: side.heroes || [],
      formation: side.formation || '',
      n: null, rate: null, redAvg: null, lastTs: 0
    }, 0, { hideHead: true }));
  }

  function blank(name) {
    return {
      name: name, n: 0, win: 0, loss: 0, draw: 0,
      asAtk: 0, asDef: 0, winAsAtk: 0, winAsDef: 0,
      costOut: 0, costIn: 0, origin: 0, rounds: 0,
      redSum: 0, redN: 0, pinSum: 0, pinN: 0,
      comps: new Map(), formations: new Map(), players: new Map(),
      hours: new Array(24).fill(0)
    };
  }

  function build(result) {
    const map = new Map();

    result.battles.forEach(function (b) {
      const sides = [
        { me: b.atk, opp: b.def, role: 'atk' },
        { me: b.def, opp: b.atk, role: 'def' }
      ];
      sides.forEach(function (s) {
        const name = s.me.alliance || '（无同盟）';
        let a = map.get(name);
        if (!a) { a = blank(name); map.set(name, a); }

        const won = b.result !== 'draw' && b.result === s.role;
        const costOut = (s.me.wounded || 0) + (s.me.dead || 0);
        const costIn = (s.opp.wounded || 0) + (s.opp.dead || 0);

        a.n++;
        if (b.result === 'draw') a.draw++;
        else if (won) a.win++;
        else a.loss++;
        if (s.role === 'atk') { a.asAtk++; if (won) a.winAsAtk++; }
        else { a.asDef++; if (won) a.winAsDef++; }
        a.costOut += costOut;
        a.costIn += costIn;
        a.origin += s.me.origin || 0;
        a.rounds += b.round || 0;
        if (s.me.redAvg !== null && s.me.redAvg !== undefined) { a.redSum += s.me.redAvg; a.redN++; }
        if (s.me.pinAvg !== null && s.me.pinAvg !== undefined) { a.pinSum += s.me.pinAvg; a.pinN++; }
        if (b.ts) a.hours[new Date(b.ts).getHours()]++;

        const ck = s.me.key;
        if (ck) {
          let c = a.comps.get(ck);
          if (!c) {
            c = { key: ck, display: s.me.compRaw || ck, n: 0, win: 0, loss: 0, draw: 0, costOut: 0, costIn: 0, formations: new Map() };
            a.comps.set(ck, c);
          }
          c.n++;
          c.costOut += costOut;
          c.costIn += costIn;
          if (b.result === 'draw') c.draw++;
          else if (won) c.win++;
          else c.loss++;
          const f = s.me.formation || '未知阵';
          const cf = c.formations.get(f) || { name: f, n: 0 };
          cf.n++;
          c.formations.set(f, cf);
        }

        const fk = s.me.formation || '未知阵';
        let fo = a.formations.get(fk);
        if (!fo) { fo = { name: fk, n: 0, win: 0, loss: 0, draw: 0 }; a.formations.set(fk, fo); }
        fo.n++;
        if (b.result === 'draw') fo.draw++;
        else if (won) fo.win++;
        else fo.loss++;

        if (s.me.player) {
          let po = a.players.get(s.me.player);
          if (!po) {
            po = { name: s.me.player, n: 0, win: 0, loss: 0, draw: 0, costOut: 0, costIn: 0, comps: new Map(), redSum: 0, redN: 0 };
            a.players.set(s.me.player, po);
          }
          po.n++;
          po.costOut += costOut;
          po.costIn += costIn;
          if (s.me.redAvg !== null && s.me.redAvg !== undefined) { po.redSum += s.me.redAvg; po.redN++; }
          if (b.result === 'draw') po.draw++;
          else if (won) po.win++;
          else po.loss++;
          if (ck) {
            let pc = po.comps.get(ck);
            if (!pc) {
              pc = {
                key: ck, display: s.me.compRaw || ck, troopSig: s.me.troopSig || '',
                n: 0, win: 0, draw: 0, configs: new Map()
              };
              po.comps.set(ck, pc);
            }
            pc.n++;
            if (b.result === 'draw') pc.draw++;
            else if (won) pc.win++;
            // 同一套阵容，玩家也可能换技能 / 兵书 / 装备 / 战马 / 阵型 —— 逐套留档
            const cfgSig = compConfigSig(s.me.heroes, s.me.formation);
            let cfg = pc.configs.get(cfgSig);
            if (!cfg) {
              cfg = {
                sig: cfgSig,
                heroes: (s.me.heroes || []).slice(),
                troopSig: s.me.troopSig || '',
                formation: s.me.formation || '',
                n: 0, win: 0, draw: 0, lastTs: 0
              };
              pc.configs.set(cfgSig, cfg);
            }
            cfg.n++;
            if (b.result === 'draw') cfg.draw++;
            else if (won) cfg.win++;
            if (b.ts && b.ts > cfg.lastTs) cfg.lastTs = b.ts;
          }
        }
      });
    });

    /* ---- 派生指标 ---- */
    map.forEach(function (a) {
      const denom = a.n || 1;
      a.rate = (a.win + a.draw * 0.5) / denom;
      a.exchange = a.costIn > 0 ? a.costOut / a.costIn : null;
      a.redAvg = a.redN ? a.redSum / a.redN : null;
      a.pinAvg = a.pinN ? a.pinSum / a.pinN : null;
      a.avgRound = a.n ? a.rounds / a.n : 0;
      a.asAtkRate = a.asAtk ? (a.winAsAtk + (a.draw * a.asAtk / denom) * 0.5) / a.asAtk : 0;
      a.asDefRate = a.asDef ? (a.winAsDef + (a.draw * a.asDef / denom) * 0.5) / a.asDef : 0;
      a.atkShare = a.asAtk / denom;

      a.compList = Array.from(a.comps.values()).sort(function (x, y) { return y.n - x.n; });
      // 补上兵种串（来自对应阵容节点），便于各处显示
      a.compList.forEach(function (c) {
        const nd = result.nodeMap.get(c.key);
        if (nd && nd.troopSig) c.troopSig = nd.troopSig;
      });
      a.formationList = Array.from(a.formations.values()).sort(function (x, y) { return y.n - x.n; });
      a.playerList = Array.from(a.players.values()).sort(function (x, y) { return y.n - x.n; });
      a.playerCount = a.players.size;

      a.compList.forEach(function (c) {
        c.rate = (c.win + c.draw * 0.5) / (c.n || 1);
        c.exchange = c.costIn > 0 ? c.costOut / c.costIn : null;
        c.share = c.n / denom;
        let bf = '', bn = -1;
        c.formations.forEach(function (v) { if (v.n > bn) { bn = v.n; bf = v.name; } });
        c.mainFormation = bf;
      });
      a.formationList.forEach(function (f) {
        f.rate = (f.win + f.draw * 0.5) / (f.n || 1);
        f.share = f.n / denom;
      });
      a.playerList.forEach(function (p) {
        p.rate = (p.win + p.draw * 0.5) / (p.n || 1);
        p.exchange = p.costIn > 0 ? p.costOut / p.costIn : null;
        p.redAvg = p.redN ? p.redSum / p.redN : null;
        p.comps = Array.from(p.comps.values()).sort(function (x, y) { return y.n - x.n; });
        p.comps.forEach(function (pc) {
          pc.rate = (pc.win + pc.draw * 0.5) / (pc.n || 1);
          pc.configList = Array.from(pc.configs.values())
            .sort(function (x, y) { return y.n - x.n || y.lastTs - x.lastTs; });
          pc.configList.forEach(function (cfg) {
            cfg.rate = (cfg.win + cfg.draw * 0.5) / (cfg.n || 1);
            const reds = (cfg.heroes || []).map(function (h) { return h.red; })
              .filter(function (v) { return v !== null && v !== undefined; });
            cfg.redAvg = reds.length ? reds.reduce(function (a, b) { return a + b; }, 0) / reds.length : null;
          });
        });
      });

      // 阵容集中度：top1 占比 + 赫芬达尔指数（越大越容易被针对）
      a.top1Share = a.compList.length ? a.compList[0].n / denom : 0;
      a.hhi = a.compList.reduce(function (s, c) { return s + Math.pow(c.n / denom, 2); }, 0);
      a.effectiveComps = a.hhi > 0 ? 1 / a.hhi : 0;   // 有效阵容数

      let ph = 0, pv = -1;
      a.hours.forEach(function (v, i) { if (v > pv) { pv = v; ph = i; } });
      a.peakHour = ph;
      a.peakCount = pv;
      const active = a.hours.map(function (v, i) { return { h: i, n: v }; }).filter(function (x) { return x.n > 0; });
      a.activeFrom = active.length ? active[0].h : 0;
      a.activeTo = active.length ? active[active.length - 1].h : 0;
    });

    return Array.from(map.values()).sort(function (a, b) { return b.n - a.n; });
  }

  /* ==================== 二、反制建议 ==================== */

  /**
   * 反制建议
   *
   * 设计要点（相比早期版本的修正）：
   *  1) 不在"没有交手数据"的队伍上按 50% 填充——那等于把「没打过」当成「打不过」，
   *     会把所有候选的期望胜率一起压低，结论永远变成"压不住"。
   *     这里分母只取**能评估的部分**，得到条件胜率；覆盖面另用门槛与标注体现。
   *  2) 覆盖面用**硬门槛**保证（默认至少能评估其 35% 的出场），而不是惩罚性拉低。
   *  3) 不再排除对方自己在用的主力阵容——镜像对拼是真实可选项；
   *     内战部分没有对抗数据，单独标注为"无法评估"，不参与计算。
   *  4) 候选仍有打击面门槛（全局出场次数），避免冷门阵容入选。
   *
   * @returns [{ key, display, expRate, rawRate, coverage, mirrorShare, evidence, reach, detail }]
   */
  function counterAdvice(result, ally, options) {
    const opts = Object.assign({
      minSample: 2,          // 单套队伍至少交手几场才算「有数据」
      shrinkK: 3,            // 单场对阵的小样本收缩强度
      evidenceK: 3,          // 证据量收缩（温和）
      minCandidateN: 5,      // 候选阵容的打击面门槛：全局至少出场多少次
      minCoverage: 0.35,     // 至少要能评估该同盟这么多比例的出场
      generalCoverage: 0.6,  // 能评估这么多算「通用方案」
      riskRate: 0.5          // 低于这个胜率就算「要小心的对手」
    }, options || {});

    const dist = ally.compList;
    if (!dist.length) return [];
    const total = ally.n;

    const out = [];
    result.nodeMap.forEach(function (node) {
      if (node.n < opts.minCandidateN) return;

      let wsum = 0, wtot = 0, evidence = 0, mirror = 0;
      const detail = [];
      const risks = [];                                  // 它打不过的对方主流队伍

      dist.forEach(function (c) {
        const w = c.n / total;
        // 与该候选同名：属于内战，没有对抗数据，单独标注但不参与计算
        if (c.key === node.key) { mirror += w; return; }
        const p = AC.analyzer.getPair(result, c.key, node.key);
        if (!p || p.n < opts.minSample) return;          // 没交手过：跳过，不填充
        const myRate = p.lo === node.key ? p.rateLo : 1 - p.rateLo;
        const shrunk = (myRate * p.n + 0.5 * opts.shrinkK) / (p.n + opts.shrinkK);
        wsum += w * shrunk;
        wtot += w;
        evidence += p.n;
        detail.push({ comp: c.display, key: c.key, share: w, rate: myRate, shrunk: shrunk, n: p.n, troopSig: c.troopSig });
        // 打不过的：按对方使用频率排，越常用越要提醒
        if (myRate < opts.riskRate) {
          risks.push({ comp: c.display, key: c.key, share: w, rate: myRate, n: p.n, troopSig: c.troopSig });
        }
      });

      if (wtot < opts.minCoverage) return;               // 能评估的出场太少，不足以推荐

      const raw = wsum / wtot;                           // 条件胜率：只在其能打的那些队伍上
      const adjusted = (raw * evidence + 0.5 * opts.evidenceK) / (evidence + opts.evidenceK);

      detail.sort(function (a, b) { return b.share - a.share; });
      risks.sort(function (a, b) { return b.share - a.share; });
      out.push({
        key: node.key,
        display: node.display,
        n: node.n,
        rate: node.rate,                                 // 该阵容的全局胜率，作为参考
        expRate: adjusted,                               // 排序与展示用
        rawRate: raw,                                    // 未做证据量收缩的条件胜率
        coverage: wtot,                                  // 能评估的出场占比
        mirrorShare: mirror,                             // 对方也在用这套的比例（无法评估）
        evidence: evidence,                              // 实际交手场次
        reach: node.opponents ? node.opponents.size : 0,
        troopSig: node.troopSig,
        detail: detail,
        risks: risks                                     // 打不过的对方队伍
      });
    });

    out.sort(function (a, b) {
      const aG = a.coverage >= opts.generalCoverage ? 1 : 0;
      const bG = b.coverage >= opts.generalCoverage ? 1 : 0;
      if (aG !== bG) return bG - aG;                     // 通用方案优先
      if (Math.abs(b.expRate - a.expRate) > 1e-9) return b.expRate - a.expRate;
      return b.coverage - a.coverage || b.n - a.n;       // 同分时覆盖面更广、打击面更大的优先
    });
    return out;
  }

  /** 针对该同盟每套主流队伍，列出最能压制它的阵容 */
  function bestAgainst(result, ally, options) {
    const opts = Object.assign({ minSample: 2, top: 3, comps: 6, minCandidateN: 5, shrinkK: 3 }, options || {});
    return ally.compList.slice(0, opts.comps).map(function (c) {
      const list = [];
      result.nodeMap.forEach(function (node) {
        if (node.key === c.key) return;
        if (node.n < opts.minCandidateN) return;          // 同样要求候选有足够打击面
        const p = AC.analyzer.getPair(result, c.key, node.key);
        if (!p || p.n < opts.minSample) return;
        const rate = p.lo === node.key ? p.rateLo : 1 - p.rateLo;
        // 用收缩后的胜率排序，避免「2 场全胜」压过「20 场赢 65%」
        const shrunk = (rate * p.n + 0.5 * opts.shrinkK) / (p.n + opts.shrinkK);
        list.push({ key: node.key, display: node.display, rate: rate, shrunk: shrunk, n: p.n, troopSig: node.troopSig });
      });
      list.sort(function (a, b) { return b.shrunk - a.shrunk || b.n - a.n; });
      return { comp: c, best: list.slice(0, opts.top) };
    });
  }

  /* ==================== 三、渲染 ==================== */

  function bar(pct, color) {
    return U.el('div', { class: 'mini-bar' }, [
      U.el('i', { style: { width: U.clamp(pct, 0, 1) * 100 + '%', background: color || U.rateColor(0.5) } })
    ]);
  }

  function metric(k, v, sub) {
    return U.el('div', { class: 'insp-cell' }, [
      U.el('div', { class: 'k', text: k }),
      U.el('div', { class: 'v', text: v }),
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

  function AllianceView(listHost, detailHost, callbacks) {
    this.listHost = listHost;
    this.detailHost = detailHost;
    this.cb = callbacks || {};
    this.result = null;
    this.alliances = [];
    this.selected = null;
  }

  AllianceView.prototype.render = function (result) {
    this.result = result;
    this.alliances = build(result);

    if (!this.alliances.length) {
      this.listHost.innerHTML = '';
      this.detailHost.innerHTML = '';
      this.detailHost.appendChild(U.el('div', { class: 'empty-state', style: { position: 'static', padding: '60px 0' } }, [
        U.el('h3', { text: '没有可分析的同盟数据' }),
        U.el('p', { text: '检查一下样本过滤条件，或先导入战报表。' })
      ]));
      return;
    }

    const keep = this.selected && this.alliances.some(function (a) { return a.name === this.selected; }, this);
    this.renderList();
    this.select(keep ? this.selected : this.alliances[0].name);
  };

  AllianceView.prototype.renderList = function () {
    const self = this;
    this.listHost.innerHTML = '';
    this.alliances.forEach(function (a) {
      const item = U.el('div', { class: 'ally-item', 'data-name': a.name }, [
        U.el('div', { class: 'ai-top' }, [
          U.el('div', { class: 'ai-name', title: a.name, text: a.name }),
          U.el('div', { class: 'ai-rate', text: U.fmtPct(a.rate, 0) })
        ]),
        U.el('div', { class: 'ai-meta', text: a.n + ' 场 · ' + a.playerCount + ' 人' }),
        bar(a.rate, U.rateColor(a.rate))
      ]);
      item.addEventListener('click', function () { self.select(a.name); });
      self.listHost.appendChild(item);
    });
  };

  AllianceView.prototype.select = function (name) {
    this.selected = name;
    const self = this;
    Array.prototype.forEach.call(this.listHost.children, function (node) {
      node.classList.toggle('active', node.dataset.name === name);
    });
    const ally = this.alliances.find(function (a) { return a.name === name; });
    if (ally) this.renderDetail(ally, this.result);
    if (this.cb.onSelect) this.cb.onSelect(ally);
  };

  AllianceView.prototype.renderDetail = function (ally, result) {
    const host = this.detailHost;
    const self = this;
    host.innerHTML = '';

    const advice = counterAdvice(result, ally);
    const perComp = bestAgainst(result, ally);

    /* ---- 头部 ---- */
    host.appendChild(U.el('div', { class: 'ally-head' }, [
      U.el('h2', { text: ally.name }),
      U.el('div', { class: 'ally-head-meta', text: ally.n + ' 场对局 · ' + ally.playerCount + ' 名成员 · 平均 ' + ally.avgRound.toFixed(1) + ' 回合' })
    ]));

    /* ---- 一句话结论 ---- */
    if (advice.length && ally.compList.length) {
      const top = advice[0];
      const main = ally.compList[0];
      const concentrated = ally.top1Share >= 0.5;
      const broad = top.coverage >= 0.6;
      let cls = '';

      // 拼装工具：T 普通文字 / hl 强调数字 / comp 阵容名 / line 一行
      const T = function (s) { return U.el('span', { text: s }); };
      const hl = function (s, c) { return U.el('span', { class: c, text: s }); };
      const comp = function (s) { return U.el('span', { class: 'ac-comp', text: '「' + s + '」' }); };
      const line = function (children) { return U.el('div', { class: 'ac-line' }, children); };
      const parts = [];

      if (top.expRate < 0.5) {
        cls = ' warn';
        parts.push(line([
          T('现有样本里，'),
          hl('没有哪套阵容能稳定压住这个同盟', 'ac-warn'),
          T('——能评估的场次中，表现最好的 '),
          comp(top.display),
          T(' 也只有 '),
          hl(U.fmtPct(top.expRate), 'ac-bad'),
          T('，低于五五开。')
        ]));
        parts.push(line([
          T('建议：'),
          hl('不要正面硬拼', 'ac-warn'),
          T('，先把他们的对局样本补多一些再看。')
        ]));
      } else if (broad) {
        parts.push(line([
          T('重心：'),
          hl(U.fmtPct(main.share, 0), 'ac-strong'),
          T(' 的出场集中在 '),
          comp(main.display),
          concentrated ? hl('，打法固定、容易被针对。', 'ac-note') : T('。')
        ]));
        parts.push(line([
          T('推荐：'),
          comp(top.display),
          T(' 能对上其 '),
          hl(U.fmtPct(top.coverage, 0), 'ac-strong'),
          T(' 的出场，胜率 '),
          hl(U.fmtPct(top.expRate), 'ac-good'),
          hl('（累计交手 ' + top.evidence + ' 场）', 'ac-dim')
        ]));
        if (top.risks && top.risks.length) {
          parts.push(line([hl('注意：', 'ac-warn'), T('这套也有打不动的对手，遇到请避开或换阵——')]));
          top.risks.slice(0, 2).forEach(function (r) {
            parts.push(line([
              hl('·', 'ac-warn'),
              comp(r.comp),
              T('占其 '),
              hl(U.fmtPct(r.share, 0) + ' 出场', 'ac-dim'),
              T('，这套打它只有 '),
              hl(U.fmtPct(r.rate, 0), 'ac-bad')
            ]));
          });
        }
      } else {
        cls = ' warn';
        parts.push(line([
          T('这个同盟阵容很分散：最常用的一套也只占 '),
          hl(U.fmtPct(main.share, 0), 'ac-strong'),
          T('，'),
          hl('没有哪套能吃下大部分场面', 'ac-warn'),
          T('。')
        ]));
        parts.push(line([
          T('覆盖面最广的 '),
          comp(top.display),
          T(' 也只对得上其 '),
          hl(U.fmtPct(top.coverage, 0), 'ac-note'),
          T(' 的出场。')
        ]));
        parts.push(line([T('建议按下方'), hl('「针对其主流队伍的单点克制」', 'ac-note'), T('逐套准备。')]));
      }

      host.appendChild(U.el('div', { class: 'ally-conclusion' + cls },
        [U.el('b', { class: 'ac-title', text: '结论' })].concat(parts)));
    }

    /* ---- 指标卡 ---- */
    host.appendChild(U.el('div', { class: 'ally-metrics' }, [
      metric('出场场次', ally.n + ' 场', ally.asAtk + ' 攻 / ' + ally.asDef + ' 守'),
      metric('整体胜率', U.fmtPct(ally.rate), ally.win + '胜 ' + ally.loss + '负 ' + ally.draw + '平'),
      metric('战损比', ally.exchange === null ? '-' : ally.exchange.toFixed(2), '越小说明打得越省'),
      metric('阵容集中度', U.fmtPct(ally.top1Share, 0), '有效阵容数 ' + ally.effectiveComps.toFixed(1)),
      metric('作攻胜率', U.fmtPct(ally.asAtkRate, 0), '主动出击 ' + ally.asAtk + ' 场'),
      metric('作守胜率', U.fmtPct(ally.asDefRate, 0), '被动防守 ' + ally.asDef + ' 场'),
      metric('平均红度', ally.redAvg === null || ally.redAvg === undefined ? '-' : ally.redAvg.toFixed(2),
        '投入程度，影响很大'),
      metric('平均品级', ally.pinAvg === null || ally.pinAvg === undefined ? '-' : ally.pinAvg.toFixed(2),
        '越高说明培养越充分')
    ]));

    /* ---- 主力玩家（可按 出场次数 / 胜率 / 红度 筛选，条件可叠加） ---- */
    const ps = section('主力玩家', '按出场次数');
    if (!self.playerFilter) self.playerFilter = { minN: 0, minRate: 0, reds: [] };
    const pf = self.playerFilter;
    const pBody = U.el('div');

    /** 组装表格（依当前筛选条件） */
    function buildPlayerTable() {
      const list = ally.playerList.filter(function (p) {
        if (p.n < pf.minN) return false;
        if (pf.minRate > 0 && p.rate * 100 < pf.minRate - 1e-9) return false;
        if (pf.reds.length) {
          const r = (p.redAvg === null || p.redAvg === undefined) ? null : Math.round(p.redAvg);
          if (r === null || pf.reds.indexOf(r) < 0) return false;
        }
        return true;
      });

      const box = U.el('div');
      box.appendChild(U.el('div', { class: 'pt-sum' }, [
        U.el('span', { text: '符合条件 ' }),
        U.el('b', { text: String(list.length) }),
        U.el('span', { text: ' 人 / 共 ' + ally.playerList.length + ' 人' }),
        list.length > 15 ? U.el('span', { class: 'pt-more', text: '（按场次排序显示前 15）' }) : null
      ]));

      const table = U.el('div', { class: 'ally-table' });
      table.appendChild(U.el('div', { class: 'at-head' }, [
        U.el('div', { text: '玩家' }), U.el('div', { text: '场次' }),
        U.el('div', { text: '胜率' }), U.el('div', { text: '战损比' }),
        U.el('div', { text: '均红' }), U.el('div', { text: '常驻阵容' })
      ]));
      if (!list.length) {
        table.appendChild(U.el('div', { class: 'pt-empty', text: '没有符合当前筛选的玩家，试着放宽条件。' }));
      }
      list.slice(0, 15).forEach(function (p) {
        table.appendChild(U.el('div', { class: 'at-row' }, [
          U.el('div', { class: 'at-name', title: p.name, text: p.name }),
          U.el('div', { text: p.n + ' 场' }),
          U.el('div', { class: 'at-rate', style: { color: U.rateColor(p.rate) }, text: U.fmtPct(p.rate, 0) }),
          U.el('div', { text: p.exchange === null ? '-' : p.exchange.toFixed(2) }),
          U.el('div', {
            class: 'at-red',
            style: { color: p.redAvg === null ? '#5d6f8f' : U.rateColor(Math.min(1, (p.redAvg || 0) / 5)) },
            text: p.redAvg === null ? '-' : p.redAvg.toFixed(1)
          }),
          U.el('div', { class: 'at-comp' }, [
            p.comps.length
              ? U.compWithTroop(p.comps[0].display, p.comps[0].troopSig || (result.nodeMap.get(p.comps[0].key) || {}).troopSig)
              : U.el('span', { text: '-' }),
            p.comps.length
              ? U.el('button', {
                class: 'at-detail', text: '详情',
                title: '查看这套阵容的完整配置（技能 / 兵书 / 装备 / 战马）；同一套阵容换过配置会分别列出',
                onclick: function (e) {
                  e.stopPropagation();
                  openCompConfig(p.name, p, p.comps[0]);
                }
              })
              : null
          ])
        ]));
      });
      box.appendChild(table);
      return box;
    }

    /** 筛选栏：三组条件可任意叠加 */
    function buildPlayerFilter() {
      const bar = U.el('div', { class: 'pt-filter' });
      const refresh = function () {
        pBody.innerHTML = '';
        pBody.appendChild(buildPlayerTable());
      };

      // ① 最少出场次数
      const nVal = U.el('b', { text: String(pf.minN) });
      bar.appendChild(U.el('label', { class: 'ptf' }, [
        U.el('span', { class: 'ptf-k' }, [U.el('span', { text: '最少场次 ' }), nVal]),
        U.el('input', {
          type: 'range', min: '0', max: '50', step: '1', value: String(pf.minN),
          oninput: function (e) { pf.minN = Number(e.target.value); nVal.textContent = pf.minN; refresh(); }
        })
      ]));

      // ② 最低胜率
      const rVal = U.el('b', { text: pf.minRate + '%' });
      bar.appendChild(U.el('label', { class: 'ptf' }, [
        U.el('span', { class: 'ptf-k' }, [U.el('span', { text: '最低胜率 ' }), rVal]),
        U.el('input', {
          type: 'range', min: '0', max: '100', step: '5', value: String(pf.minRate),
          oninput: function (e) { pf.minRate = Number(e.target.value); rVal.textContent = pf.minRate + '%'; refresh(); }
        })
      ]));

      // ③ 红度多选（可勾多个档位；全不选＝不限）
      const reds = U.el('div', { class: 'ptf-reds' });
      [0, 1, 2, 3, 4, 5].forEach(function (r) {
        reds.appendChild(U.el('button', {
          class: 'ptf-red' + (pf.reds.indexOf(r) >= 0 ? ' on' : ''),
          title: '只看平均红度约为 ' + r + ' 的玩家（可多选）',
          text: r + ' 红',
          onclick: function () {
            const i = pf.reds.indexOf(r);
            if (i >= 0) pf.reds.splice(i, 1); else pf.reds.push(r);
            this.classList.toggle('on');
            refresh();
          }
        }));
      });
      bar.appendChild(U.el('div', { class: 'ptf-group' }, [
        U.el('span', { class: 'ptf-k' }, [
          U.el('span', { text: '红度 ' }),
          U.el('span', { class: 'ptf-tip', text: '可多选' })
        ]),
        reds
      ]));

      bar.appendChild(U.el('button', {
        class: 'ptf-reset', text: '重置筛选',
        onclick: function () {
          pf.minN = 0; pf.minRate = 0; pf.reds.length = 0;
          nVal.textContent = '0'; rVal.textContent = '0%';
          bar.querySelectorAll('input[type=range]').forEach(function (inp) { inp.value = '0'; });
          bar.querySelectorAll('.ptf-red').forEach(function (b) { b.classList.remove('on'); });
          refresh();
        }
      }));

      return bar;
    }

    ps.appendChild(buildPlayerFilter());
    ps.appendChild(pBody);
    pBody.appendChild(buildPlayerTable());
    host.appendChild(ps);

    /* ---- 主流队伍 ---- */
    const cs = section('主流队伍', '占该同盟全部出场');
    const cWrap = U.el('div', { class: 'comp-list' });
    ally.compList.slice(0, 10).forEach(function (c) {
      const row = U.el('div', { class: 'comp-row' }, [
        U.el('div', { class: 'cr-line' }, [
          U.compWithTroop(c.display, c.troopSig, 'cr-name'),
          c.mainFormation ? U.el('span', { class: 'tag', text: c.mainFormation }) : null,
          U.el('div', { class: 'cr-share', text: U.fmtPct(c.share, 0) })
        ]),
        bar(c.share, 'linear-gradient(90deg,#4ea8ff,#7c5cff)'),
        U.el('div', { class: 'cr-sub' }, [
          U.el('span', { text: c.n + ' 场' }),
          U.el('span', { style: { color: U.rateColor(c.rate) }, text: '胜率 ' + U.fmtPct(c.rate, 0) }),
          U.el('span', { text: '战损比 ' + (c.exchange === null ? '-' : c.exchange.toFixed(2)) })
        ])
      ]);
      if (self.cb.onPickComp) {
        row.addEventListener('click', function () { self.cb.onPickComp(c.key); });
      }
      cWrap.appendChild(row);
    });
    cs.appendChild(cWrap);
    host.appendChild(cs);

    /* ---- 反制推荐 ---- */
    const as = section('如何克制该同盟 · 推荐阵容', '综合期望胜率，未覆盖部分按中性 50% 估算');
    if (!advice.length) {
      as.appendChild(U.el('p', { class: 'hint', text: '样本不足，暂时无法给出可靠的反制推荐。可以调低「最少对阵场次」再试。' }));
    } else {
      const general = advice.filter(function (a) { return a.coverage >= 0.6; });
      const targeted = advice.filter(function (a) { return a.coverage < 0.6; });

      const makeGroup = function (title, note, list, highlightFirst) {
        if (!list.length) return null;
        const box = U.el('div', { class: 'advice-group' }, [
          U.el('div', { class: 'advice-group-title' }, [
            U.el('span', { class: 'agt-name', text: title }),
            U.el('span', { class: 'agt-note', text: note })
          ])
        ]);
        list.slice(0, 4).forEach(function (a, i) {
          const edge = a.expRate >= 0.55 ? { t: '明显优势', c: 'good' }
            : a.expRate >= 0.5 ? { t: '微弱优势', c: 'slight' }
              : { t: '不占优', c: 'bad' };
          const card = U.el('div', { class: 'advice-card' + (highlightFirst && i === 0 ? ' best' : '') }, [
            U.el('div', { class: 'ad-top' }, [
              U.el('div', { class: 'ad-rank', text: '推荐 ' + (i + 1) }),
              U.el('div', { class: 'ad-name' }, [U.compWithTroop(a.display, a.troopSig)]),
              U.el('div', { class: 'ad-edge ' + edge.c, text: edge.t }),
              U.el('div', { class: 'ad-rate', style: { color: U.rateColor(a.expRate) }, text: U.fmtPct(a.expRate) })
            ]),
            U.el('div', { class: 'ad-sub' }, [
              U.el('span', {
                text: '能评估其 ' + U.fmtPct(a.coverage, 0) + ' 的出场 · 实交手 ' + a.evidence + ' 场' +
                  (a.mirrorShare > 0.01 ? '（另有 ' + U.fmtPct(a.mirrorShare, 0) + ' 是他们也在用这套，无对抗数据）' : '')
              }),
              U.el('span', { text: ' · 该阵容全局出场 ' + a.n + ' 次 / 胜率 ' + U.fmtPct(a.rate, 0) + ' · 打过 ' + a.reach + ' 套阵容' })
            ])
          ]);
          const detail = U.el('div', { class: 'ad-detail' });
          if (!a.detail.length) {
            detail.appendChild(U.el('div', { class: 'ad-detail-row' }, [
              U.el('span', { class: 'ad-d-name', text: '暂无与之交手过的该同盟队伍' })
            ]));
          }
          a.detail.slice(0, 4).forEach(function (d) {
            detail.appendChild(U.el('div', { class: 'ad-detail-row' }, [
              U.el('span', { class: 'ad-d-name', title: d.comp }, [
                U.el('span', { text: '打「' + d.comp + '」' }),
                U.troopBadges(d.troopSig)
              ]),
              U.el('span', { class: 'ad-d-n', text: '占其 ' + U.fmtPct(d.share, 0) + ' / ' + d.n + ' 场' }),
              U.el('span', { class: 'ad-d-rate', style: { color: U.rateColor(d.rate) }, text: U.fmtPct(d.rate, 0) })
            ]));
          });
          card.appendChild(detail);

          // 风险提示：这套阵容最怕对方哪几套队伍
          if (a.risks && a.risks.length) {
            const riskBox = U.el('div', { class: 'ad-risks' }, [
              U.el('div', { class: 'ad-risk-title', text: '⚠ 用它要当心这几套（对方常用且打不过）' })
            ]);
            a.risks.slice(0, 3).forEach(function (r) {
              const row = U.el('div', { class: 'ad-risk-row' }, [
                U.el('span', { class: 'ad-risk-name', title: r.comp }, [
                  U.el('span', { text: r.comp }),
                  U.troopBadges(r.troopSig)
                ]),
                U.el('span', { class: 'ad-risk-n', text: '占其 ' + U.fmtPct(r.share, 0) + ' / ' + r.n + ' 场' }),
                U.el('span', { class: 'ad-risk-rate', text: '仅 ' + U.fmtPct(r.rate, 0) })
              ]);
              if (self.cb.onPickComp) {
                row.addEventListener('click', function (ev) {
                  ev.stopPropagation();                    // 别触发整卡的跳转
                  self.cb.onPickComp(r.key);
                });
              }
              riskBox.appendChild(row);
            });
            card.appendChild(riskBox);
          }

          if (self.cb.onPickComp) {
            card.addEventListener('click', function () { self.cb.onPickComp(a.key); });
          }
          box.appendChild(card);
        });
        return box;
      };

      const g1 = makeGroup('通用方案', '能对上该同盟 60% 以上的出场，可以直接当主力用', general, true);
      if (g1) as.appendChild(g1);
      else {
        as.appendChild(U.el('p', { class: 'hint', text: '没有哪套阵容能对上该同盟 60% 以上的出场——他们阵容比较散，建议按下面的针对性方案准备。' }));
      }

      const g2 = makeGroup('针对性方案', '能对上 35%~60% 的出场，适合预判到对手出某套时使用', targeted, false);
      if (g2) as.appendChild(g2);

      // 被排除掉的「他们主力阵容」本身就是全局强势阵容，这点要讲清楚，否则用户会觉得信息缺失
      const ownStrong = ally.compList
        .filter(function (c) { return c.share >= 0.05 && c.n >= 10; })
        .map(function (c) {
          const g = result.nodeMap.get(c.key);
          return { display: c.display, share: c.share, global: g ? g.rate : null, n: g ? g.n : 0 };
        })
        .filter(function (x) { return x.global !== null && x.global >= 0.5; })
        .sort(function (a, b) { return b.global - a.global; })
        .slice(0, 3);

      if (ownStrong.length) {
        as.appendChild(U.el('p', { class: 'hint', text: '注意：他们的主力阵容本身就偏强——' +
          ownStrong.map(function (x) {
            return '「' + x.display + '」占其 ' + U.fmtPct(x.share, 0) + ' 的出场、全局胜率 ' +
              U.fmtPct(x.global, 0) + '（' + x.n + ' 场）';
          }).join('；') +
          '。这类阵容不会出现在上面的推荐里，如果你手上也有，镜像对拼只能靠临场发挥，数据无法判断优劣。' }));
      }

      as.appendChild(U.el('p', { class: 'hint', text: '胜率算法：Σ(该同盟使用各队伍的比例 × 推荐阵容对该队伍的胜率) ÷ Σ(这些比例)——只统计双方真正交手过的组合，没交手过的不计入，而是用「能对上多少出场」体现覆盖面。候选阵容另有打击面门槛（全局至少出场 5 次），并按交手场次做了温和收缩。对方自己也在用的阵容同样可以入选（镜像对拼），只是那部分内战没有对抗数据。' }));
    }
    host.appendChild(as);

    /* ---- 逐队伍单点克制 ---- */
    const bs = section('针对其主流队伍的单点克制', '按对局样本筛选，建议至少 2 场');
    perComp.slice(0, 4).forEach(function (item) {
      const block = U.el('div', { class: 'percomp' }, [
        U.el('div', { class: 'pc-head' }, [
          U.el('span', { class: 'pc-name' }, [U.compWithTroop(item.comp.display, item.comp.troopSig)]),
          U.el('span', { class: 'pc-meta', text: item.comp.n + ' 场 · 该同盟胜率 ' + U.fmtPct(item.comp.rate, 0) })
        ])
      ]);
      if (!item.best.length) {
        block.appendChild(U.el('div', { class: 'hint', text: '暂无足够样本的对手阵容。' }));
      } else {
        item.best.forEach(function (b) {
          const row = U.el('div', { class: 'pc-row' }, [
            U.compWithTroop(b.display, b.troopSig, 'pc-opp'),
            U.el('span', { class: 'pc-n', text: b.n + ' 场' }),
            U.el('span', { class: 'pc-rate', style: { color: U.rateColor(b.rate) }, text: U.fmtPct(b.rate, 0) }),
            b.n < 5 ? U.el('span', { class: 'pc-weak', text: '样本少' }) : null
          ]);
          if (self.cb.onPickComp) {
            row.addEventListener('click', function () { self.cb.onPickComp(b.key); });
          }
          block.appendChild(row);
        });
      }
      bs.appendChild(block);
    });
    if (!perComp.length) bs.appendChild(U.el('p', { class: 'hint', text: '暂无数据。' }));
    host.appendChild(bs);

    /* ---- 惯用阵型 ---- */
    const fs = section('惯用阵型', '胜负是否依赖某个阵法');
    const fWrap = U.el('div', { class: 'comp-list' });
    ally.formationList.forEach(function (f) {
      fWrap.appendChild(U.el('div', { class: 'comp-row' }, [
        U.el('div', { class: 'cr-line' }, [
          U.el('div', { class: 'cr-name', text: f.name }),
          U.el('div', { class: 'cr-share', text: U.fmtPct(f.share, 0) })
        ]),
        bar(f.share, U.rateColor(f.rate)),
        U.el('div', { class: 'cr-sub' }, [
          U.el('span', { text: f.n + ' 场' }),
          U.el('span', { style: { color: U.rateColor(f.rate) }, text: '胜率 ' + U.fmtPct(f.rate, 0) })
        ])
      ]));
    });
    fs.appendChild(fWrap);
    host.appendChild(fs);

    /* ---- 活跃时段 ---- */
    const hs = section('活跃时段', '按小时统计出场次数');
    const max = Math.max.apply(null, ally.hours) || 1;
    const chart = U.el('div', { class: 'hour-chart' });
    ally.hours.forEach(function (v, h) {
      chart.appendChild(U.el('div', {
        class: 'hc-col',
        title: h + ':00 — ' + v + ' 场',
        style: { height: Math.max(2, (v / max) * 100) + '%', opacity: v ? 1 : 0.28 }
      }));
    });
    hs.appendChild(chart);
    hs.appendChild(U.el('div', { class: 'hour-axis' }, [
      U.el('span', { text: '0时' }),
      U.el('span', { text: '6时' }),
      U.el('span', { text: '12时' }),
      U.el('span', { text: '18时' }),
      U.el('span', { text: '23时' })
    ]));
    hs.appendChild(U.el('p', { class: 'hint', text: '最活跃时段：' + ally.peakHour + ':00 前后（' + ally.peakCount + ' 场）' }));
    host.appendChild(hs);
  };

  AC.AllianceView = AllianceView;
  AC.allianceAnalysis = { build: build, counterAdvice: counterAdvice, bestAgainst: bestAgainst };
  AC.openCompConfig = openCompConfig;   // 便于调试与分享
  AC.openSideConfig = openSideConfig;   // 供玩家页的战报浮层复用（单场一方的配置）
  AC.openConfigList = openConfigList;   // 通用配置列表弹窗（阵容详情页的推荐配置等）

  /** 阵型站位图鉴（调试 / 核对站位用）：把已录入的阵型各画一遍 */
  function previewFormations() {
    const mask = U.el('div', { class: 'bl-mask' });
    const panel = U.el('div', { class: 'bl-panel hc-panel' });
    const body = U.el('div', { class: 'hc-body' });
    function close() { mask.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    Object.keys(FORMATIONS).forEach(function (name) {
      const fm = FORMATIONS[name];
      const box = U.el('div', { class: 'hc-cfg' });
      box.appendChild(U.el('div', { class: 'hc-cfg-head' }, [
        U.el('span', { class: 'hc-cfg-rank', text: name }),
        U.el('span', { class: 'hc-cfg-n', text: fm.note })
      ]));
      const board = U.el('div', { class: 'fm-board' });
      [[1, '前排'], [2, '后排']].forEach(function (lane) {
        const slots = fm.slots.filter(function (s) { return s.r === lane[0]; });
        const wrap = U.el('div', { class: 'fm-lane' + (slots.length ? '' : ' empty') }, [
          U.el('div', { class: 'fm-lane-t', text: lane[1] + '（' + slots.length + ' 人）' })
        ]);
        const grid = U.el('div', { class: 'fm-slots' });
        slots.forEach(function (s) {
          grid.appendChild(U.el('div', {
            class: 'fm-slot filled',
            style: { gridColumn: String(s.c) }
          }, [
            U.el('div', { class: 'fm-demo', text: '武将' + (fm.slots.indexOf(s) + 1) })
          ]));
        });
        wrap.appendChild(grid);
        board.appendChild(wrap);
      });
      box.appendChild(board);
      body.appendChild(box);
    });

    panel.appendChild(U.el('div', { class: 'bl-title' }, [
      U.el('div', { class: 'bl-title-l' }, [U.el('b', { text: '阵型站位表（' + Object.keys(FORMATIONS).length + ' 种）' })]),
      U.el('button', { class: 'bl-close', text: '×', title: '关闭（Esc）', onclick: close })
    ]));
    panel.appendChild(body);
    mask.appendChild(panel);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.body.appendChild(mask);
    document.addEventListener('keydown', onKey);
  }
  AC.previewFormations = previewFormations;

  // URL 带 #cfg 时自动打开第一个玩家的阵容配置浮层
  if (location.hash === '#cfg') {
    setTimeout(function () {
      const btn = document.querySelector('.at-detail');
      if (btn) btn.click();
    }, 800);
  }
  // URL 带 #fm 时打开阵型站位表
  if (location.hash === '#fm') {
    setTimeout(previewFormations, 800);
  }
})(window.AC);
