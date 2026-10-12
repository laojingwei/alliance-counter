window.AC = window.AC || {};

/* ============================================================
   分析层：把战斗记录聚合为「节点 + 克制关系」
   核心是给小样本做收缩，避免 1 胜 0 负就被当成 100% 克制
   ============================================================ */
(function (AC) {
  'use strict';

  const M = AC.model;

  const DEFAULT_OPTS = {
    dimension: 'comp',      // comp | formation
    minPair: 1,             // 最少对阵场次
    minAppear: 1,           // 节点最少出场次数
    minLevel: 0,            // 双方单位最低等级（0 = 不限）
    onlyFull: false,        // 只统计双方满编且人数相同
    /* ---- 兵力差距控制：差距过大时胜负主要由兵力决定，体现不出阵容克制 ---- */
    onlyForceParity: false, // 只统计双方总兵力接近的对局
    forceParityGap: 3000,   // 「接近」的允许差距（双方原始兵力之差）
    excludeMirror: true,    // 排除同名内战
    excludeDraw: false,     // 平局是否退出胜率分母
    strongOnly: false,      // 只保留强克制
    shrinkK: 3,             // 收缩强度：越大越保守
    /* ---- 培养度控制：只有明细数据带红度/品级，宽表会自动跳过 ---- */
    onlyRedParity: false,   // 只统计双方平均红度接近的对局
    redParityGap: 1,        // 「接近」的阈值
    minRedAvg: 0,           // 双方平均红度下限（0 = 不限）
    onlyPinParity: false,   // 只统计双方平均品级接近的对局
    pinParityGap: 1,        // 品级「接近」的阈值
    /* ---- 培养度档位：把红度/品级分层来看克制关系 ---- */
    redTier: 'all',         // all | low | mid | high（按对局双方的平均红度）
    pinTier: 'all'          // all | low | mid | high（按双方的平均品级）
  };

  // 档位分界（对局双方平均）：<1.5 低；1.5~2.5 中；>=2.5 高
  const TIER_LOW = 1.5, TIER_HIGH = 2.5;

  /**
   * 「势均力敌」的兵力差上限（固定值，与过滤滑块解耦）。
   * 过滤滑块管的是「哪些场次进入统计」，这里管的是「进入统计的场次里，哪些算公平样本」。
   * 若两者共用同一阈值，把过滤设为不限就会让分层全部失效（没有均势样本）。
   */
  const FORCE_EVEN_GAP = 3000;

  function tierOf(level) {
    if (level === null || level === undefined) return null;
    if (level < TIER_LOW) return 'low';
    if (level < TIER_HIGH) return 'mid';
    return 'high';
  }

  const TIER_LABEL = { low: '低（<1.5）', mid: '中（1.5~2.5）', high: '高（≥2.5）' };

  function normalizeOpts(o) {
    const r = {};
    for (const k in DEFAULT_OPTS) r[k] = (o && o[k] !== undefined) ? o[k] : DEFAULT_OPTS[k];
    return r;
  }

  function has(v) { return v !== null && v !== undefined; }

  /** 该场对局是否满足等级 / 满编 / 培养度等样本过滤 */
  function pairSampleOk(atk, def, opts) {
    if (opts.onlyFull) {
      if (atk.size < 3 || def.size < 3 || atk.size !== def.size) return false;
    }
    // 兵力差距控制：-1 表示不限（等价于关闭开关）
    if (opts.onlyForceParity && opts.forceParityGap >= 0 && has(atk.origin) && has(def.origin)) {
      if (Math.abs(atk.origin - def.origin) > opts.forceParityGap) return false;
    }
    if (opts.minLevel > 0) {
      if (atk.levels.length && atk.minLevel < opts.minLevel) return false;
      if (def.levels.length && def.minLevel < opts.minLevel) return false;
    }
    // 红度控制：避免「满红打白板」污染阵容克制结论（差值 -1 表示不限）
    if (has(atk.redAvg) && has(def.redAvg)) {
      if (opts.onlyRedParity && opts.redParityGap >= 0 && Math.abs(atk.redAvg - def.redAvg) > opts.redParityGap) return false;
      if (opts.minRedAvg > 0 && Math.min(atk.redAvg, def.redAvg) < opts.minRedAvg) return false;
    }
    // 品级控制：同理
    if (has(atk.pinAvg) && has(def.pinAvg)) {
      if (opts.onlyPinParity && opts.pinParityGap >= 0 && Math.abs(atk.pinAvg - def.pinAvg) > opts.pinParityGap) return false;
    }
    // 培养度档位：只看某个红度/品级水平的对局（回答「高红环境下谁克谁」）
    if (has(atk.redAvg) && has(def.redAvg) && opts.redTier && opts.redTier !== 'all') {
      if (tierOf((atk.redAvg + def.redAvg) / 2) !== opts.redTier) return false;
    }
    if (has(atk.pinAvg) && has(def.pinAvg) && opts.pinTier && opts.pinTier !== 'all') {
      if (tierOf((atk.pinAvg + def.pinAvg) / 2) !== opts.pinTier) return false;
    }
    return true;
  }

  function newPair(lo, hi) {
    return {
      key: lo + '||' + hi, lo: lo, hi: hi,
      n: 0, winLo: 0, winHi: 0, draw: 0,
      nLoAsAtk: 0, nLoAsDef: 0,       // lo 方作攻/作守的场次
      winLoAsAtk: 0, winLoAsDef: 0,   // lo 方作攻/作守时的胜场
      costLo: 0, costHi: 0,           // 伤 + 亡 累计
      originLo: 0, originHi: 0,
      rounds: 0,
      redSum: 0, redN: 0, pinSum: 0, pinN: 0,
      byRed: new Map(), byPin: new Map(),   // 培养度档位 -> 胜负（看清「什么红度下谁克谁」）
      byForce: new Map(),                   // 兵力态势 -> 胜负：even 均势 / loUp lo 人多 / loDown lo 人少
      battleIds: []
    };
  }

  function newRank(side) {
    return {
      key: '',
      display: '',
      displayCount: {},
      units: (side && side.units) || [],
      n: 0, win: 0, loss: 0, draw: 0,
      costOut: 0, costIn: 0,
      redSum: 0, redN: 0, pinSum: 0, pinN: 0,
      troopCounts: {},
      players: {}, alliances: {}, formations: {},
      battleIds: [],
      opponents: new Map(),
      // 兵力态势 -> 胜负：even 兵力接近 / adv 本方人多 / dis 本方人少
      // 「强度」只认 even + dis，靠人多赢的场次不算本事
      byForce: { even: { n: 0, win: 0, loss: 0, draw: 0 }, adv: { n: 0, win: 0, loss: 0, draw: 0 }, dis: { n: 0, win: 0, loss: 0, draw: 0 } }
    };
  }

  function analyze(battles, options) {
    const opts = normalizeOpts(options);
    const dim = opts.dimension;

    const kept = [];
    let skipped = 0, skippedMirror = 0, skippedFilter = 0;

    const nodeMap = new Map();
    const pairMap = new Map();

    function getNode(key, side) {
      let node = nodeMap.get(key);
      if (!node) { node = newRank(side); node.key = key; nodeMap.set(key, node); }
      const dn = dim === 'formation' ? (side.formation || key) : (side.compRaw || side.formation || key);
      node.displayCount[dn] = (node.displayCount[dn] || 0) + 1;
      if (dim === 'comp' && !node.units.length && side.units && side.units.length) node.units = side.units;
      return node;
    }

    for (let i = 0; i < battles.length; i++) {
      const b = battles[i];
      if (b.result === 'unknown') { skipped++; continue; }

      const atkKey = M.groupKey(b, 'atk', dim);
      const defKey = M.groupKey(b, 'def', dim);
      if (!atkKey || !defKey) { skipped++; continue; }

      if (opts.excludeMirror && atkKey === defKey) { skippedMirror++; continue; }
      if (!pairSampleOk(b.atk, b.def, opts)) { skippedFilter++; continue; }

      kept.push(b);

      // ---------- 节点统计 ----------
      const nAtk = getNode(atkKey, b.atk);
      const nDef = getNode(defKey, b.def);
      const costAtk = (b.atk.wounded || 0) + (b.atk.dead || 0);
      const costDef = (b.def.wounded || 0) + (b.def.dead || 0);

      const pairsOfNode = [[nAtk, b.atk, costAtk, costDef, 'atk', b.def], [nDef, b.def, costDef, costAtk, 'def', b.atk]];
      for (let t = 0; t < 2; t++) {
        const node = pairsOfNode[t][0], side = pairsOfNode[t][1], role = pairsOfNode[t][4], foe = pairsOfNode[t][5];
        node.n++;
        node.costOut += pairsOfNode[t][2];
        node.costIn += pairsOfNode[t][3];
        node.battleIds.push(b.id);
        // 兵力态势（本场视角）：本方兵力相对对手是多、是少、还是接近
        if (has(side.origin) && has(foe.origin)) {
          const d = side.origin - foe.origin;
          const kind = Math.abs(d) <= FORCE_EVEN_GAP ? 'even' : (d > 0 ? 'adv' : 'dis');
          const fb = node.byForce[kind];
          fb.n++;
          if (b.result === 'draw') fb.draw++;
          else if (b.result === role) fb.win++;
          else fb.loss++;
        }
        if (side.player) node.players[side.player] = (node.players[side.player] || 0) + 1;
        if (side.alliance) node.alliances[side.alliance] = (node.alliances[side.alliance] || 0) + 1;
        if (side.formation) node.formations[side.formation] = (node.formations[side.formation] || 0) + 1;
        if (has(side.redAvg)) { node.redSum += side.redAvg; node.redN++; }
        if (has(side.pinAvg)) { node.pinSum += side.pinAvg; node.pinN++; }
        if (side.troopSig) node.troopCounts[side.troopSig] = (node.troopCounts[side.troopSig] || 0) + 1;
        if (b.result === 'draw') node.draw++;
        else if (b.result === role) node.win++;
        else node.loss++;
      }

      // ---------- 对阵统计（按字典序归一到 lo/hi，消除攻守先后手偏置）----------
      const swap = atkKey > defKey;
      const k1 = swap ? defKey : atkKey;
      const s1IsAtk = !swap;
      const s1 = swap ? b.def : b.atk;
      const s2 = swap ? b.atk : b.def;
      const c1 = swap ? costDef : costAtk;
      const c2 = swap ? costAtk : costDef;

      const pk = k1 + '||' + (swap ? atkKey : defKey);
      let pair = pairMap.get(pk);
      if (!pair) { pair = newPair(k1, swap ? atkKey : defKey); pairMap.set(pk, pair); }

      pair.n++;
      pair.battleIds.push(b.id);
      pair.rounds += (b.round || 0);
      pair.costLo += c1; pair.costHi += c2;
      pair.originLo += (s1.origin || 0); pair.originHi += (s2.origin || 0);
      if (s1IsAtk) pair.nLoAsAtk++; else pair.nLoAsDef++;

      const loWon = (b.result === 'atk') === s1IsAtk;
      if (b.result === 'draw') pair.draw++;
      else if (loWon) {
        pair.winLo++;
        if (s1IsAtk) pair.winLoAsAtk++; else pair.winLoAsDef++;
      } else pair.winHi++;

      // 兵力态势（lo 视角）：lo 方兵力相对 hi 是多、是少、还是接近
      if (has(s1.origin) && has(s2.origin)) {
        const dLo = s1.origin - s2.origin;
        const kind = Math.abs(dLo) <= FORCE_EVEN_GAP ? 'even' : (dLo > 0 ? 'loUp' : 'loDown');
        let fb = pair.byForce.get(kind);
        if (!fb) { fb = { n: 0, winLo: 0, winHi: 0, draw: 0 }; pair.byForce.set(kind, fb); }
        fb.n++;
        if (b.result === 'draw') fb.draw++;
        else if (loWon) fb.winLo++;
        else fb.winHi++;
      }

      // 培养度分档：记下这对阵容在不同红度/品级水平下的胜负
      if (has(s1.redAvg) && has(s2.redAvg)) {
        const lvl = Math.round((s1.redAvg + s2.redAvg) / 2);
        let rb = pair.byRed.get(lvl);
        if (!rb) { rb = { n: 0, winLo: 0, draw: 0, redSum: 0 }; pair.byRed.set(lvl, rb); }
        rb.n++;
        rb.redSum += (s1.redAvg + s2.redAvg) / 2;
        if (b.result === 'draw') rb.draw++;
        else if (loWon) rb.winLo++;
        pair.redSum += (s1.redAvg + s2.redAvg) / 2;
        pair.redN++;
      }
      if (has(s1.pinAvg) && has(s2.pinAvg)) {
        const lvl = Math.round((s1.pinAvg + s2.pinAvg) / 2);
        let pb = pair.byPin.get(lvl);
        if (!pb) { pb = { n: 0, winLo: 0, draw: 0 }; pair.byPin.set(lvl, pb); }
        pb.n++;
        if (b.result === 'draw') pb.draw++;
        else if (loWon) pb.winLo++;
        pair.pinSum += (s1.pinAvg + s2.pinAvg) / 2;
        pair.pinN++;
      }

      // 节点 -> 对手 明细
      const oA = nAtk.opponents.get(defKey) || { n: 0, win: 0, loss: 0, draw: 0 };
      const oB = nDef.opponents.get(atkKey) || { n: 0, win: 0, loss: 0, draw: 0 };
      oA.n++; oB.n++;
      if (b.result === 'draw') { oA.draw++; oB.draw++; }
      else if (b.result === 'atk') { oA.win++; oB.loss++; }
      else { oA.loss++; oB.win++; }
      nAtk.opponents.set(defKey, oA);
      nDef.opponents.set(atkKey, oB);
    }

    // ---------- 指标计算 ----------
    const k = opts.shrinkK;
    pairMap.forEach(function (p) {
      const decided = p.winLo + p.winHi;
      const denom = opts.excludeDraw ? decided : p.n;
      const rateLo = denom ? (p.winLo + (opts.excludeDraw ? 0 : p.draw * 0.5)) / denom : 0.5;
      p.denom = denom;
      p.rateLo = rateLo;
      p.shrunkLo = (rateLo * denom + 0.5 * k) / (denom + k);
      p.score = p.shrunkLo - 0.5;                                     // > 0 表示 lo 克 hi

      /* ---- 公平口径：只认「势均力敌」与「以少打多」----
         靠兵力优势赢下来的场次不能算强度，否则堆兵就能刷高压制力。 */
      function bucketOf(keys) {
        let n = 0, winLo = 0, winHi = 0, draw = 0;
        keys.forEach(function (fk) {
          const bb = p.byForce.get(fk);
          if (!bb) return;
          n += bb.n; winLo += bb.winLo; winHi += bb.winHi; draw += bb.draw;
        });
        return { n: n, winLo: winLo, winHi: winHi, draw: draw };
      }
      function rateIn(bucket) {
        if (!bucket || !bucket.n) return null;
        const dec = bucket.winLo + (bucket.winHi || 0);
        const den = opts.excludeDraw ? dec : bucket.n;
        return den ? (bucket.winLo + (opts.excludeDraw ? 0 : bucket.draw * 0.5)) / den : null;
      }

      const bEven = bucketOf(['even']);
      const bLoFair = bucketOf(['even', 'loDown']);   // lo 的公平样本：均势 + lo 人少
      const bHiFair = bucketOf(['even', 'loUp']);     // hi 的公平样本：均势 + hi 人少
      const bLoUp = p.byForce.get('loUp') || { n: 0 };
      const bLoDown = p.byForce.get('loDown') || { n: 0 };

      p.nEven = bEven.n; p.rateLoEven = rateIn(bEven);
      p.nFair = bLoFair.n; p.rateLoFair = rateIn(bLoFair);
      p.nFairHi = bHiFair.n; p.rateHiFair = rateIn(bHiFair);
      p.nLoUp = bLoUp.n; p.nLoDown = bLoDown.n;
      p.rateLoUp = rateIn(bLoUp);
      p.rateLoDown = rateIn(bLoDown);

      if (p.nFair > 0) {
        const decFair = opts.excludeDraw ? (bLoFair.winLo + bLoFair.winHi) : bLoFair.n;
        p.shrunkLoFair = (p.rateLoFair * decFair + 0.5 * k) / (decFair + k);
        p.scoreFair = p.shrunkLoFair - 0.5;
      } else {
        // 完全没有公平样本（例如所有对局都靠人多）：强度无从谈起，记中性
        p.shrunkLoFair = 0.5;
        p.scoreFair = 0;
      }
      p.conf = denom / (denom + k);
      p.avgRound = p.n ? p.rounds / p.n : 0;
      p.lossLo = p.originLo ? p.costLo / p.originLo : null;
      p.lossHi = p.originHi ? p.costHi / p.originHi : null;
      p.lossGap = (p.lossHi !== null && p.lossLo !== null) ? p.lossHi - p.lossLo : null; // > 0 表示 lo 打得更省
      // 平均开战兵力：看清双方是以多少兵力交手的
      p.avgOriginLo = p.n ? p.originLo / p.n : 0;
      p.avgOriginHi = p.n ? p.originHi / p.n : 0;
      p.nHiAsAtk = p.n - p.nLoAsAtk;
      p.winLoRateAsAtk = p.nLoAsAtk ? p.winLoAsAtk / p.nLoAsAtk : null;
      p.winLoRateAsDef = p.nLoAsDef ? p.winLoAsDef / p.nLoAsDef : null;
      // 培养度：这对阵容整体处于什么水平，以及各档位下的胜负
      p.redAvgAll = p.redN ? p.redSum / p.redN : null;
      p.pinAvgAll = p.pinN ? p.pinSum / p.pinN : null;
      const toList = function (map) {
        return Array.from(map.entries()).map(function (e) {
          const v = e[1];
          return {
            level: Number(e[0]), n: v.n, winLo: v.winLo, draw: v.draw,
            rateLo: v.n ? (v.winLo + v.draw * 0.5) / v.n : 0.5
          };
        }).sort(function (a, b) { return a.level - b.level; });
      };
      p.byRedList = toList(p.byRed);
      p.byPinList = toList(p.byPin);
    });

    nodeMap.forEach(function (node) {
      const decided = node.win + node.loss;
      const denom = opts.excludeDraw ? decided : node.n;
      node.rate = denom ? (node.win + (opts.excludeDraw ? 0 : node.draw * 0.5)) / denom : 0.5;
      node.shrunk = (node.rate * denom + 0.5 * k) / (denom + k);
      node.avgCostOut = node.costOut / Math.max(1, node.n);
      node.avgCostIn = node.costIn / Math.max(1, node.n);
      node.exchange = node.avgCostIn > 0 ? node.avgCostOut / node.avgCostIn : null; // 越小越赚
      node.redAvg = node.redN ? node.redSum / node.redN : null;
      node.pinAvg = node.pinN ? node.pinSum / node.pinN : null;
      // 该阵容最常见的兵种串（如「枪弓弓」）——同一阵容偶尔换兵种，取出现最多的
      node.troopSig = '';
      let bestTroopN = -1;
      for (const tk in node.troopCounts) {
        if (node.troopCounts[tk] > bestTroopN) { bestTroopN = node.troopCounts[tk]; node.troopSig = tk; }
      }

      let best = '', bestC = -1;
      for (const d in node.displayCount) { if (node.displayCount[d] > bestC) { bestC = node.displayCount[d]; best = d; } }
      node.display = best || node.key;

      // 兵力态势各档胜率：看清这个阵容主要是靠什么赢的
      function nodeForceRate(fb) {
        const dec = fb.win + fb.loss;
        const den = opts.excludeDraw ? dec : fb.n;
        return den ? (fb.win + (opts.excludeDraw ? 0 : fb.draw * 0.5)) / den : null;
      }
      node.nEven = node.byForce.even.n; node.rateEven = nodeForceRate(node.byForce.even);
      node.nAdv = node.byForce.adv.n; node.rateAdv = nodeForceRate(node.byForce.adv);
      node.nDis = node.byForce.dis.n; node.rateDis = nodeForceRate(node.byForce.dis);
      // 公平样本 = 势均力敌 + 以少打多（靠人多赢的不算本事）
      const fairNode = {
        n: node.byForce.even.n + node.byForce.dis.n,
        win: node.byForce.even.win + node.byForce.dis.win,
        loss: node.byForce.even.loss + node.byForce.dis.loss,
        draw: node.byForce.even.draw + node.byForce.dis.draw
      };
      node.nFair = fairNode.n;
      node.rateFair = nodeForceRate(fairNode);

      // 净压制力：对所有对手的加权平均优势
      //   netPower     旧口径（含靠兵力优势赢的场次，会虚高）
      //   netPowerFair 公平口径，只用「势均力敌 + 以少打多」的场次——衡量真实强度
      let wsum = 0, w = 0, wsumF = 0, wF = 0;
      node.opponents.forEach(function (o, otherKey) {
        const p = pairMap.get(node.key < otherKey ? node.key + '||' + otherKey : otherKey + '||' + node.key);
        if (!p) return;
        const wt = Math.sqrt(o.n);
        const mine = p.lo === node.key ? p.score : -p.score;
        wsum += mine * wt; w += wt;
        const mineF = p.lo === node.key ? p.scoreFair : -p.scoreFair;
        wsumF += mineF * wt; wF += wt;
      });
      node.netPower = w ? wsum / w : 0;
      node.netPowerFair = wF ? wsumF / wF : 0;
      // 出场最多的阵型，作为该阵容的惯用阵
      let bf = '', bc = -1;
      for (const f in node.formations) { if (node.formations[f] > bc) { bc = node.formations[f]; bf = f; } }
      node.mainFormation = bf;
      let ba = '', bac = -1;
      for (const a in node.alliances) { if (node.alliances[a] > bac) { bac = node.alliances[a]; ba = a; } }
      node.mainAlliance = ba;
    });

    // ---------- 生成边 ----------
    const edges = [];
    const edgeDropped = { byPair: 0, byAppear: 0, byStrong: 0, byBalance: 0 };
    pairMap.forEach(function (p) {
      if (p.n < opts.minPair) { edgeDropped.byPair++; return; }
      const nLo = nodeMap.get(p.lo), nHi = nodeMap.get(p.hi);
      if (!nLo || !nHi) return;
      if (nLo.n < opts.minAppear || nHi.n < opts.minAppear) { edgeDropped.byAppear++; return; }
      const abs = Math.abs(p.score);
      if (opts.strongOnly && abs < 0.25) { edgeDropped.byStrong++; return; }
      if (abs < 0.02) { edgeDropped.byBalance++; return; }
      const loWins = p.score > 0;
      edges.push({
        source: loWins ? p.lo : p.hi,
        target: loWins ? p.hi : p.lo,
        pair: p,
        n: p.n,
        rate: loWins ? p.rateLo : 1 - p.rateLo,
        score: abs,
        signed: p.score,
        conf: p.conf
      });
    });

    const nodeList = Array.from(nodeMap.values())
      .filter(function (nd) { return nd.n >= opts.minAppear; })
      .sort(function (a, b) { return b.n - a.n || b.rate - a.rate; });

    const stats = {
      totalInput: battles.length,
      totalKept: kept.length,
      skipped: skipped,
      skippedMirror: skippedMirror,
      skippedFilter: skippedFilter,
      nodeCount: nodeMap.size,
      nodeShown: nodeList.length,
      pairCount: pairMap.size,
      edgeCount: edges.length,
      edgeDropped: edgeDropped,
      avgRound: kept.length ? kept.reduce(function (a, b) { return a + (b.round || 0); }, 0) / kept.length : 0,
      timeFrom: null,
      timeTo: null
    };
    kept.forEach(function (b) {
      if (!b.ts) return;
      if (stats.timeFrom === null || b.ts < stats.timeFrom) stats.timeFrom = b.ts;
      if (stats.timeTo === null || b.ts > stats.timeTo) stats.timeTo = b.ts;
    });

    return {
      opts: opts,
      battles: kept,
      allBattles: battles,
      nodeMap: nodeMap,
      nodeList: nodeList,
      pairMap: pairMap,
      pairList: Array.from(pairMap.values()),
      edges: edges,
      stats: stats
    };
  }

  function pairKeyOf(k1, k2) { return k1 < k2 ? k1 + '||' + k2 : k2 + '||' + k1; }

  /** 取两个分组之间的对阵数据（与先后顺序无关） */
  function getPair(result, k1, k2) {
    return result.pairMap.get(pairKeyOf(k1, k2)) || null;
  }

  /** 取某个分组参与的全部原始战斗 */
  function battlesOf(result, key, dim) {
    return result.battles.filter(function (b) {
      return M.groupKey(b, 'atk', dim) === key || M.groupKey(b, 'def', dim) === key;
    });
  }

  AC.analyzer = {
    analyze: analyze,
    getPair: getPair,
    battlesOf: battlesOf,
    pairKeyOf: pairKeyOf,
    pairSampleOk: pairSampleOk,
    DEFAULT_OPTS: DEFAULT_OPTS
  };
})(window.AC);
