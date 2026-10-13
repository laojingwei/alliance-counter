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
    /* ---- 培养度控制：数据来自 Sanmou 明细，天然带红度/品级 ---- */
    onlyRedParity: false,   // 只统计双方平均红度接近的对局
    redParityGap: 1,        // 「接近」的阈值
    minRedAvg: 0,           // 双方平均红度下限（0 = 不限）
    onlyPinParity: false,   // 只统计双方平均品级接近的对局
    pinParityGap: 1,        // 品级「接近」的阈值
    /* ---- 培养度档位：把红度/品级分层来看克制关系 ---- */
    redTier: 'all',         // all | low | mid | high（按对局双方的平均红度）
    pinTier: 'all',         // all | low | mid | high（按双方的平均品级）
    /* ---- 强度分：五维加权（打击面 / 胜率 / 连胜 / 战损 / 劣势）---- */
    breadthCoef: 0.10,      // 打赢面打满时的加成（用于 strengthBonus 展示）
    breadthTau: 3,          // 打赢面收缩强度：出场场次少时，有效打赢数向「只赢过 1 支」回落
    winSpanMinN: 3,         // 「打赢过某支队伍」的交手场次门槛：不到 3 场不认（和全局收缩口径一致）
    wuxunRef: 4200,         // 连胜成色的满分线：实测连赢段平均单场武勋 p50≈3650、p90≈4120，所以取 4200 当满分
    wuxunHigh: 3600,        // 「高质量连赢」门槛：落在实测分布的 p50 附近，一半左右的段算达标
    wuxunLow: 2500,         // 成色下限：低于它的连赢基本是打残兵/低等级，只给 0~30 分成色
    runLinkTol: 200,        // 兵力衔接容差（绝对值）：这一场开战兵力 ≈ 上一场剩余兵力
    runLinkRate: 0.01,      // 兵力衔接容差（比例）：大兵力时用比例放宽
    spanRef: 6,             // 打击面满分参照：合成量（种类数 + 0.35×加权优势）到 6 记满分
    streakRef: 0.7,         // 连胜满分参照：平均一次出战连赢 3 场（含金量 0.67）算满分
    lossRef: 0.45,          // 战损满分参照：赢时我方掉兵占双方的 45% 记 0 分，低于它才有分
    scoreTau: 12,           // 样本充分度 n/(n+tau)：样本越少，综合分向 0 收缩越多
    scorePenalty: 0.55      // 收缩深度：样本为 0 时只保留 45% 的分
  };

  // 档位分界（对局双方平均）：<1.5 低；1.5~2.5 中；>=2.5 高
  const TIER_LOW = 1.5, TIER_HIGH = 2.5;

  /**
   * 「势均力敌」的兵力差上限（固定值，与过滤滑块解耦）。
   * 过滤滑块管的是「哪些场次进入统计」，这里管的是「进入统计的场次里，哪些算公平样本」。
   * 若两者共用同一阈值，把过滤设为不限就会让分层全部失效（没有均势样本）。
   */
  const FORCE_EVEN_GAP = 3000;

  /** 把对手列表整理成「打赢面」所需的数组：每支对手交过几次手、公平赢面多少 */
  function oppRows(node, pairMap) {
    const out = [];
    node.opponents.forEach(function (o, otherKey) {
      const key = node.key < otherKey ? node.key + '||' + otherKey : otherKey + '||' + node.key;
      const p = pairMap ? pairMap.get(key) : null;
      let winFace = 0.5, scoreFair = 0;
      if (p) {
        scoreFair = p.lo === node.key ? p.scoreFair : -p.scoreFair;
        winFace = 0.5 + scoreFair;
      }
      out.push({ key: otherKey, n: o.n, winFace: winFace, scoreFair: scoreFair, beaten: false, span: 0 });
    });
    return out;
  }

/**
 * 综合强度分（0~100）：给玩家看的「这套队伍到底强不强」。
 *
 * 由五个分项加权，每一项都先归一化到 0~100，再乘「样本充分度」做保守化：
 *
 *   打击面 span   32%  打赢过多少支不同队伍（赢面 > 50% 且交手 >= 3 场才算赢过）
 *   胜率   win    28%  公平压制力（只认势均力敌与以少打多，堆兵刷的不算）
 *   连胜   streak 18%  一次出战能连赢几场（见 markRuns：同玩家 15 分钟内连续交战算一次出战）
 *   战损   loss   12%  赢下来的场次里，我方掉兵占双方掉兵的比例（越小越省）
 *   劣势   dis    10%  兵力比对方少时还能赢——以少打多能力（样本 < 3 场记中性）
 *
 * 样本充分度 n/(n+12)：几场数据不足以证明一套队伍强，越少越向 0 收缩（评分保守）。
 */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** 分位数（已排序数组） */
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

/** 按 [min,max] 线性映射到 0~100（超出范围截断） */
function norm(v, min, max) {
  if (max <= min) return 50;
  return 100 * clamp01((v - min) / (max - min));
}

/**
 * 满分参照线：按当前数据自动标定，避免写死的常数在新数据里失准。
 * 用「头部 p90（记满分）」与「尾部 p25（记 0 分）」两条线把各分项映射到 0~100：
 * 强队自然接近 80~100，中游落在 40~60，弱队 20~40，换赛季 / 换样本量都能用。
 */
function autoRefs(nodeMap, pairMap) {
  const span = [], streak = [], loss = [], win = [], dis = [];
  nodeMap.forEach(function (nd) {
    let bw = 0;
    if (nd.opponents) {
      nd.opponents.forEach(function (o, otherKey) {
        const p = pairMap.get(nd.key < otherKey ? nd.key + '||' + otherKey : otherKey + '||' + nd.key);
        if (!p) return;
        const mine = p.lo === nd.key ? p.scoreFair : -p.scoreFair;
        if (o.n >= 3 && mine > 0) bw += Math.min(1, mine * 4);   // 按对手加权，不乘场次
      });
    }
    span.push((nd.beatKinds || 0) + bw * 0.35);
    if (nd.streakAll) streak.push(nd.streakMulti / nd.streakAll);
    if (nd.lossN >= 5 && nd.fairLoss !== null) loss.push(nd.fairLoss);
    if (nd.nFair >= 5) win.push(nd.rateFair === null ? 0.5 : nd.rateFair);
    if (nd.nDis >= 5 && nd.rateDis !== null) dis.push(nd.rateDis);
  });
  const S = function (a) { a.sort(function (x, y) { return x - y; }); return a; };
  S(span); S(streak); S(loss); S(win); S(dis);
  return {
    spanMax: Math.max(2, quantile(span, 0.9)),
    spanMin: Math.max(0.5, quantile(span, 0.25)),
    streakMax: Math.max(0.05, quantile(streak, 0.9)),
    streakMin: quantile(streak, 0.25),
    lossMin: quantile(loss, 0.1) || 0.12,
    lossMax: Math.max((quantile(loss, 0.1) || 0.12) + 0.06, quantile(loss, 0.75) || 0.35),
    winMax: Math.max(0.55, quantile(win, 0.9)),
    winMin: Math.min(0.45, quantile(win, 0.25)),
    disMax: Math.max(0.45, quantile(dis, 0.9)),
    disMin: Math.min(0.35, quantile(dis, 0.25))
  };
}

/**
 * 「一次出战」与「连赢」的识别。
 *
 * 战报里没有「连战场次」这列（实测全为空），只能按**兵力衔接**还原：
 *   - **一次出战**：一支部队从满兵出战，赢一场后**用剩下的兵接着打**，
 *     所以「下一场的开战兵力 ≈ 这一场的剩余兵力」（1% 或 200 以内）；
 *     中间隔多久不重要——打一阵、撤下去补给、过很久再碰上一场，只要兵力接得上就是同一次出战。
 *   - **本次出战结束**：打输了／平局（兵被打散或卡住），或者**再也没有能接上剩余兵力的下一场**。
 *   - **连赢**：一次出战里连续的胜利场数，直到输／平／接不上为止。
 *
 * 同一个玩家可能同时操控多支部队（不同阵容），所以按「玩家 + 阵容键」分开追踪，
 * 每场战斗的剩余兵力只允许被一条链认领，避免一支部队的战绩被重复计入。
 */
function markRuns(battles, opts) {
  const tol = opts.runLinkTol > 0 ? opts.runLinkTol : 200;        // 兵力衔接容差（绝对值）
  const tolRate = opts.runLinkRate > 0 ? opts.runLinkRate : 0.01; // 大兵力时按比例放宽

  const byUnit = new Map();      // 「玩家|阵容键」-> 该部队的交战记录
  battles.forEach(function (b) {
    // 输入已按「一次交战一场」过滤（见 analyze 里的 statSrc），这里直接使用。
    // 防御：万一上游传了未过滤的数据，child（同一场交战的续战段）跳过。
    if (b.recordType === 'child') return;
    ['atk', 'def'].forEach(function (role) {
      const side = b[role];
      if (!side || !side.player) return;
      const key = side.player + '|' + (side.key || side.formation || '');
      let arr = byUnit.get(key);
      if (!arr) { arr = []; byUnit.set(key, arr); }
      const foe = role === 'atk' ? b.def : b.atk;
      arr.push({
        b: b, id: b.id, ts: b.ts || 0, place: b.place || '', role: role, player: side.player,
        won: b.result === 'draw' ? null : (b.result === role),
        origin: (side.origin === null || side.origin === undefined) ? null : side.origin,
        remain: (side.remain === null || side.remain === undefined) ? null : side.remain,
        // 伤兵：战后会恢复，下一场的开战兵力 = 本场剩余 + 本场伤兵（连战判定的关键）
        wounded: (side.wounded === null || side.wounded === undefined) ? 0 : side.wounded,
        wuxun: (side.wuxun === null || side.wuxun === undefined) ? 0 : side.wuxun,
        loss: Math.max(0, (side.origin || 0) - (side.remain || 0)),
        foeLoss: Math.max(0, (foe.origin || 0) - (foe.remain || 0)),
        // 我方零损失 = 练兵/空战，不算真打（实测有 33000→33000、22127→22127 连着打空城的情况）。
        // 只看我方：打 0 兵的空城/辎重，对方本来就没兵，用「双方都无伤」会漏判。
        noLoss: ((side.origin || 0) - (side.remain || 0)) <= 0,
        atkKey: b.atk.key, defKey: b.def.key,
        next: null           // 下一场（兵力接得上的那一场）
      });
    });
  });

  /* 连战（一次出战）的判定：下一场的开战兵力 = 上一场的剩余兵力 + 上一场的伤兵。
     伤兵会在战后恢复，所以不能只比「剩余兵力」——实测 8010 对相邻场次里，
     这个等式有 57% 精确成立，而只比剩余兵力只有 9% 命中（会把真连战判成各自独立的一场）。 */
  const expectedOrigin = function (a) { return (a.remain || 0) + (a.wounded || 0); };
  const linked = function (a, b) {
    if (a.remain === null || b.origin === null) return false;
    // 时间必须**严格**往后：同秒的记录是并发（团战里的多支部队、block+child 同秒落盘），
    // 不是「上一场打完接着打下一场」。
    // 这里曾经写成 b.ts < a.ts 才拒绝（同秒放行），结果两条同秒且兵力恰好衔接的记录
    // 会互相声明 next/prev 形成环，后面 while (head.prev) 沿环走就死循环——
    // 实测 10k 场数据在 n≈2000 的切片上触发页面假死。必须严格递增。
    if (b.ts <= a.ts) return false;
    const exp = expectedOrigin(a);
    return Math.abs(b.origin - exp) <= Math.max(tol, exp * tolRate);
  };

  // 收口一个连赢段：统计段数/场数，并给段内涉及的每个阵容记「自己打出的最强连赢」
  // 双方毫发无伤的对局（演练/空战）在段内已被排除，不会把「连打 5 场不掉兵」算成五连
  const closeSeq = function (seq) {
    if (!seq || seq.len <= 0) return;
    stat.streakRuns++;
    stat.streakBattles += seq.len;
    const seen = {};
    seq.items.forEach(function (it) {
      [it.atkKey, it.defKey].forEach(function (k) {
        if (!k || seen[k]) return;
        seen[k] = 1;
        if (!stat.bestByComp.has(k)) stat.bestByComp.set(k, { best: 0, times: 0, sum: 0, runs: 0 });
        const rec = stat.bestByComp.get(k);
        rec.runs++;
        rec.sum += seq.len;
        if (seq.len > rec.best) { rec.best = seq.len; rec.times = 1; }
        else if (seq.len === rec.best) rec.times++;
      });
    });
  };

  // 按「开战兵力」建索引：由剩余兵力反查候选的下一场
  const stat = { runs: 0, multi: 0, streakRuns: 0, streakBattles: 0, maxStreak: 0, units: byUnit.size, linked: 0, bestByComp: new Map(), runItemsByBattle: new Map() };
  byUnit.forEach(function (arr) {
    arr.sort(function (a, b) { return a.ts - b.ts; });
    const byOrigin = new Map();      // origin -> 候选战斗数组
    arr.forEach(function (x) {
      if (x.origin === null) return;
      const bucket = Math.round(x.origin / Math.max(1, tol));
      let list = byOrigin.get(bucket);
      if (!list) { list = []; byOrigin.set(bucket, list); }
      list.push(x);
    });

    arr.forEach(function (a) {
      if (a.remain === null) return;
      const exp = expectedOrigin(a);                       // 本场「结束时的可用兵力」= 剩余 + 伤兵
      const bucket = Math.round(exp / Math.max(1, tol));
      for (let k = bucket - 1; k <= bucket + 1; k++) {
        const list = byOrigin.get(k);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const cand = list[i];
          if (cand === a || cand.claimed) continue;
          if (!linked(a, cand)) continue;
          a.next = cand;
          cand.prev = a;
          cand.claimed = true;        // 一支部队的剩余兵力只被认领一次
          stat.linked++;
          break;
        }
        if (a.next) break;
      }
    });
    // 把每场战斗归属到「本次出战」：同一个出战里的任意一场都能反查整条出战链
    arr.forEach(function (a) {
      if (!a.next && !a.prev) { a.itemsInRun = [a]; return; }
      let head = a;
      let guard = 0;                       // 防御：链上理论无环，保险起见限步数
      while (head.prev && guard++ < arr.length) head = head.prev;
      const items = [];
      let p = head;
      guard = 0;
      while (p && guard++ <= arr.length) { p.itemsInRun = items; items.push(p); p = p.next; }
    });

    // 顺着 next 走：一次出战 = 一条兵力衔接链。
    //   兵力衔接只回答「是不是同一波」；连赢断不断只看胜负：
    //   赢一场 +1；输 / 平 立即断连（不管兵力接不接得上）；双方毫发无伤的演练局不计数、不断连。
    //   走到输／平 后，链后面剩下的仍算新的出战，必须继续走完。
    arr.forEach(function (a) {
      if (a.handled) return;
      let run = { n: 0 }, seq = null;
      let cur = a;
      let guard = 0;                       // 防御：同上，限步数防环
      while (cur && guard++ <= arr.length) {
        if (!cur.handled) {
          cur.handled = true;
          run.n++;
          // 只把「这一场」的记录挂到这一场上：挂整条链会让同一场被重复统计
          if (!cur.b.__runItems) cur.b.__runItems = [];
          cur.b.__runItems.push(cur);
          if (cur.noLoss === true) {
            // 演练/空战：不计数、不断连，直接跳过
          } else if (cur.won === true) {
            if (!seq) seq = { player: cur.player, len: 0, startId: cur.id, items: [] };
            seq.len++;
            seq.items.push({ atkKey: cur.atkKey, defKey: cur.defKey, player: cur.player, role: cur.role });
            cur.b.__run = seq;
            if (seq.len > stat.maxStreak) stat.maxStreak = seq.len;
          } else {
            // 输 / 平：连赢立刻断掉，并且把兵力链也在此截断——
            // 败仗之后再用残兵打仗，那是新的一波，不该跟前面的胜利串成一段
            if (seq) { closeSeq(seq); seq = null; }
            cur.prev = null;
            cur.claimed = false;
            break;
          }
        }
        cur = cur.next;
      }
      if (seq) closeSeq(seq);         // 链尾收口
      stat.runs++;
      if (run.n > 1) stat.multi++;
    });
  });
  return stat;
}

function computeStrength(node, ctx) {
  const opts = (ctx && ctx.opts) || DEFAULT_OPTS;
  const refs = (ctx && ctx.refs) || {};
  const minWinN = opts.winSpanMinN > 0 ? opts.winSpanMinN : 1;

  /* ---------- ① 打击面：赢过多少支不同队伍 ---------- */
  const rows = node._oppRows || oppRows(node, ctx && ctx.pairMap);
  let beatKinds = 0, beatWeight = 0, beatSumSq = 0;
  rows.forEach(function (r) {
    const beaten = r.n >= minWinN && r.winFace > 0.5;
    r.beaten = beaten;
    if (!beaten) return;
    beatKinds++;
    // 压线赢（赢面刚过 50%）的对手按优势打点折扣：算赢过，但不算「稳稳拿下」
    // 注意：权重按「对手」算（0~1），不再乘交手场次——否则跟一支队打 100 场就能把打击面顶满
    const w = Math.min(1, (r.winFace - 0.5) * 4);
    r.beatW = w;
    beatWeight += w;
    beatSumSq += w * w;
  });
  // 有效打赢数：只赢一支 = 1，均匀赢 N 支 = N（权重含交手场次，压线的对手几乎不计）
  const effBeat = (beatWeight > 0 && beatSumSq > 0) ? (beatWeight * beatWeight) / beatSumSq : 0;
  // 打击面用「赢过的种类数 + 优势加成 - 1」合成：只赢过 1 支 = 0 分（打击面窄），
  // 再对数压缩到 0~100（4 支 ≈ 32 分，8 支 ≈ 51 分，15 支 ≈ 74 分）
  const spanRaw = Math.max(0, beatKinds + beatWeight * 0.5 - 1);
  const sSpan = spanRaw <= 0 ? 0 : Math.min(100, 100 * clamp01(Math.log(1 + spanRaw) / Math.log(1 + 14)));

  /* ---------- ② 公平胜率 ---------- */
  const base = (node.netPowerFair === undefined || node.netPowerFair === null)
    ? (node.netPower || 0)
    : node.netPowerFair;
  const sWin = norm(0.5 + base, refs.winMin || 0.4, refs.winMax || 0.6);

  /* ---------- ③ 连胜：这套阵容打出的最强连赢（含武勋成色） ---------- */
  // 口径 = 某玩家用这套阵容在一次出战里连续打赢的最多场数（取该阵容的最高记录）。
  // 一次出战 = 用剩余兵力接着打，所以「连赢 N 场」是实打实的一波推平对方 N 支部队。
  // 场数评分：2 连 = 25 分、3 连 = 50 分、5 连 = 85 分、7 连及以上 = 100 分。
  const best = node.streakBest || 0;
  const streakByLen = best < 2 ? 0 : Math.min(100, 100 * clamp01((best - 1) / 6));
  const strongRuns = node.streakStrong || 0;   // 打出过 3 连及以上的次数
  // 武勋成色：连赢段里每场打赢对手拿到的平均武勋。
  // 几千几百 = 打的是残兵/低等级，体现不出强度（实测连赢段的平均武勋 p10≈2400、p50≈3900、p90≈4500）。
  const wuxunAvg = node.streakWuxunAvg || 0;
  const wuxunRef = opts.wuxunRef > 0 ? opts.wuxunRef : 8000;
  const wuxunLow = opts.wuxunLow > 0 ? opts.wuxunLow : 3000;   // 低于它就是「刷残兵」，成色按 0~30 分算
  let sStreakQuality;
  const hasWuxun = wuxunAvg > 0;
  if (!hasWuxun) {
    sStreakQuality = 100;                                     // 旧版导出没有武勋列：不做成色打折
  } else if (wuxunAvg <= wuxunLow) {
    sStreakQuality = 30 * clamp01(wuxunAvg / wuxunLow);        // 打残兵：成色最高只给 30 分
  } else {
    sStreakQuality = 30 + 70 * clamp01((wuxunAvg - wuxunLow) / Math.max(1, wuxunRef - wuxunLow));
  }
  // 连胜分 = 场数分 × 成色系数（打赢的对手越硬，这段连赢越值钱）
  const sStreak = streakByLen * (sStreakQuality / 100);
  node.streakWuxunQuality = sStreakQuality;

  /* ---------- ④ 战损：赢的时候省不省兵 ---------- */
  // fairLoss = 我方掉兵 / 双方掉兵（只看赢的公平场次：均势 + 以少打多）；越接近 0 越省
  const sLoss = (node.fairLoss === null || node.fairLoss === undefined || node.lossN < 3)
    ? 50
    : norm((refs.lossMax || 0.35) - node.fairLoss, 0, (refs.lossMax || 0.35) - (refs.lossMin || 0.12));

  /* ---------- ⑤ 劣势（以少打多）能力 ---------- */
  // 兵力比对方少：不但要能赢，还要比自己的公平胜率更好（说明「人少也能打」不是偶然）
  let sDis = 50;
  if (node.nDis >= 3 && node.rateDis !== null && node.rateDis !== undefined) {
    const lift = node.rateFair === null ? 0 : node.rateDis - node.rateFair;
    sDis = 0.7 * norm(node.rateDis, refs.disMin || 0.3, refs.disMax || 0.55) + 0.3 * norm(lift + 0.12, 0, 0.24);
  }

  /* ---------- 加权 + 样本保守化 ---------- */
  // 样本不足时压缩分项（只对「高于 60 分」的部分打折）：
  // 样本完全充分时保留 100%，样本极少时高光分只保留一半——避免几场好数据刷出榜首
  const cred = node.n / (node.n + (opts.scoreTau || 12));
  const cap = 60 + 40 * Math.pow(cred, 0.8);
  const capOf = function (v) { return v <= 60 ? v : 60 + (v - 60) * ((cap - 60) / 40); };
  // 权重按「对强度的解释力」分配：打击面最重（赢过多少种队伍），其次胜率，连胜/战损/劣势各占一份。
  // 没有样本的分项（比如过滤成「只统计兵力接近」时根本没有以少打多的场次）不占权重，
  // 剩下几项按比例重新归一化——否则缺一项就把所有阵容的总分一起压掉。
  const parts = [
    { w: 0.32, s: capOf(sSpan), has: true },
    { w: 0.26, s: capOf(sWin), has: true },
    { w: 0.15, s: capOf(sStreak), has: true },
    { w: 0.12, s: capOf(sLoss), has: node.lossN >= 3 },
    { w: 0.15, s: capOf(sDis), has: node.nDis >= 3 && node.rateDis !== null }
  ];
  let wsum = 0, wAll = 0;
  parts.forEach(function (p) { if (p.has) { wsum += p.s * p.w; wAll += p.w; } });
  const score = wAll > 0 ? wsum / wAll : 0;
  node.cred = cred;
  node.scoreCap = cap;
  node.partsUsed = wAll;
  // ---- 交手面（仅展示）----
  const tau = opts.breadthTau > 0 ? opts.breadthTau : 1;
  const sumSq = node.oppSumSq || 0;
  const rawEffOpp = sumSq > 0 ? (node.n * node.n) / sumSq : 0;
  const effOpp = rawEffOpp > 0 ? (node.n * rawEffOpp + 1 * tau) / (node.n + tau) : 1;

  node.effOpp = effOpp;
  node.beatKinds = beatKinds;
  node.beatWeight = beatWeight;
  node.effBeat = effBeat;
  node.breadth = clamp01(Math.log(1 + Math.max(1, effBeat)) / Math.log(1 + 12)); // 兼容旧字段：打赢面
  node.streakBest = best;
  node.strengthBase = base;                 // 兼容旧字段：公平压制力
  node.strengthBonus = node.breadth * (opts.breadthCoef || 0);
  node.sample = cred;
  // 分项（0~100，界面直接展示）：五项之和按权重合成综合分
  node.sSpan = sSpan;
  node.sWin = sWin;
  node.sStreak = sStreak;
  node.sLoss = sLoss;
  node.sDis = sDis;
  node.strength = score;
  return score;
}

/** 强度分取值：口径统一，排行 / 3D 高度 / 详情都用它 */
function strengthOf(node) {
  if (!node) return 0;
  if (node.strength !== undefined && node.strength !== null) return node.strength;
  const v = (node.netPowerFair === undefined || node.netPowerFair === null) ? node.netPower : node.netPowerFair;
  return v || 0;
}

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
      byForce: { even: { n: 0, win: 0, loss: 0, draw: 0, origin: 0 }, adv: { n: 0, win: 0, loss: 0, draw: 0, origin: 0 }, dis: { n: 0, win: 0, loss: 0, draw: 0, origin: 0 } },
      // 连赢段：一次出战内连续胜利的场数（同段只计一次，避免同一波连胜被重复加权）
      streakLens: {},
      streakN: 0,        // 参与过的连赢段数（含 1 连胜）
      streakSum: 0,      // 各段长度之和
      streakMax: 0,      // 最长一段
      streakIds: {},
      // 战损：只统计「赢下来的公平场次」——赢的时候掉兵越少越强
      lossSum: 0,
      lossN: 0,
      oppSumSq: 0,        // Σ 每个对手对战场次的平方：用来算「有效对手数」（交手面，仅展示）
      oppTypes: 0,        // 交手过的对手种类数
      topOppN: 0,         // 交手最多的那支对手打了多少场
      topOppKey: ''
    };
  }

  function analyze(battles, options) {
    const opts = normalizeOpts(options);
    const dim = opts.dimension;

    /* ---------------------------------------------------------------
       【统计口径】一次出战 = 1 场
       Sanmou 的战报结构（viewer 导出时已按 battleId 去重）：
         block —— 主战报（该次交战的最终结果）
         child —— 同一次交战内的续战段 / 团战分战报
       处理分两步：
         ① mergeChains：按「同一对玩家 + 同一地点 + 兵力衔接」把多段
            （block 与其后续 child）合成一条 —— 伤亡/回合/武勋累计，胜负取末段。
            实测 10,054 条 → 9,215 条（合并 658 条多段链）。
         ② 过滤剩余 child：没被任何链认领的 child（来源不全或兵力对不上），
            不作为独立交战计入统计。实测再排除 4,369 条 → 4,846 场。
       明细展示（战报浮层）仍保留原始每段，通过 childIds 关联。
       --------------------------------------------------------------- */
    const mergedRes = M.mergeChains(battles);
    const src = mergedRes.list;
    const statSrc = src.filter(function (b) { return b.recordType !== 'child'; });

    /* 连赢段：按「同玩家 + 部队」还原一次出战，再取出其中连续胜利的段（详见 markRuns）。 */
    const runStats = markRuns(statSrc, opts);

    const kept = [];
    /* 连胜原料：与统计同源（statSrc）。败局必须参与断连判定。 */
    const runItemsByComp = new Map();
    statSrc.forEach(function (bx) {
      [['atk', 'def'], ['def', 'atk']].forEach(function (pair) {
        const role = pair[0], side = bx[role];
        if (!side || !side.player || !side.key) return;
        let arr = runItemsByComp.get(side.key);
        if (!arr) { arr = []; runItemsByComp.set(side.key, arr); }
        arr.push({
          id: bx.id, player: side.player, ts: bx.ts || 0,
          origin: side.origin, remain: side.remain,
          wounded: side.wounded || 0,          // 连战判定要用：下一场开战 = 本场剩余 + 本场伤兵
          won: bx.result === 'draw' ? null : (bx.result === role),
          noLoss: ((side.origin || 0) - (side.remain || 0)) <= 0,
          wuxun: side.wuxun || 0
        });
      });
    });
    const runTol = opts.runLinkTol > 0 ? opts.runLinkTol : 200;        // 与 markRuns 同一套兵力衔接容差
    const runTolRate = opts.runLinkRate > 0 ? opts.runLinkRate : 0.01;
    /* 数据里到底有没有武勋：旧版导出（以及部分脚本生成的表）没有这一列。
       没有武勋时绝不能把「武勋 0」当成打空城，否则所有连胜都会被判成垃圾场次而清零。 */
    let wuxunTotal = 0, wuxunPos = 0;
    statSrc.forEach(function (bx) {
      [bx.atk, bx.def].forEach(function (s) {
        if (!s || !s.player) return;
        wuxunTotal++;
        if ((s.wuxun || 0) > 0) wuxunPos++;
      });
    });
    const hasWuxunData = wuxunTotal > 0 && (wuxunPos / wuxunTotal) > 0.1;
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

    for (let i = 0; i < statSrc.length; i++) {
      const b = statSrc[i];
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
        let forceKind = null;
        if (has(side.origin) && has(foe.origin)) {
          const d = side.origin - foe.origin;
          const kind = Math.abs(d) <= FORCE_EVEN_GAP ? 'even' : (d > 0 ? 'adv' : 'dis');
          forceKind = kind;
          const fb = node.byForce[kind];
          fb.n++;
          fb.origin += side.origin;
          if (b.result === 'draw') fb.draw++;
          else if (b.result === role) fb.win++;
          else fb.loss++;
        }
        // 战损（只认赢下来的公平场次：均势 + 以少打多）：fairLoss = 我方掉兵 / 双方掉兵，越小越省
        // 故意不统计以多打少的场次——人多打赢本来就不费兵，混进来会把战损一起刷虚
        if (forceKind === 'even' || forceKind === 'dis') {
          const won = b.result !== 'draw' && b.result === role;
          if (won) {
            const mine = Math.max(0, (side.origin || 0) - (side.remain || 0));
            const theirs = Math.max(0, (foe.origin || 0) - (foe.remain || 0));
            if (mine + theirs > 0) { node.lossSum += mine / (mine + theirs); node.lossN++; }
          }
        }
        // 连赢段：同一波攻势的那几场只算一次（否则同一段连胜会按场次重复计入）
        const wr = b.__run;
        if (wr && !node.streakIds[wr.startId]) {
          node.streakIds[wr.startId] = 1;
          node.streakN++;
          node.streakSum += wr.len;
          if (wr.len > node.streakMax) node.streakMax = wr.len;
          node.streakLens[wr.len] = (node.streakLens[wr.len] || 0) + 1;
        }
        if (side.player) {
          node.players[side.player] = (node.players[side.player] || 0) + 1;
          // 同时记「对手玩家」：同样一套阵容可能由不同玩家操作，两者口径都留着
          if (foe.player) {
            if (!node.foePlayers) node.foePlayers = new Map();
            const fp = node.foePlayers.get(foe.player) || { n: 0, win: 0, loss: 0, draw: 0 };
            fp.n++;
            if (b.result === 'draw') fp.draw++;
            else if (b.result === role) fp.win++;
            else fp.loss++;
            node.foePlayers.set(foe.player, fp);
          }
        }
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

      // 战损（赢的公平场次）：fairLoss = 我方掉兵 / 双方掉兵，越小越省
      node.fairLoss = node.lossN ? node.lossSum / node.lossN : null;
      // 劣势时的优势提升：以少打多还比自己的公平胜率更高，说明「人少也能打」不是偶然
      node.disLift = (node.rateDis !== null && node.rateFair !== null) ? node.rateDis - node.rateFair : null;

      // 连胜：这套阵容打出的最强连赢
      //   两条判据分开，互不干扰（之前把两者混在一起，才出现「胜-败-胜 算成三连」）：
      //     · 兵力衔接  → 回答「还是不是同一支部队在连续作战」
      //     · 胜负      → 回答「连赢断没断」：输 / 平 立刻断，与兵力接不接得上无关
      //   另有：双方毫发无伤的演练/空战不计数、也不断连。
      //   数据口径用**全量交战**：被样本过滤掉的败局同样是败局，不能当没发生。
      const items = runItemsByComp.get(node.key) || [];
      let bestStreak = 0, strong3 = 0;
      const perPlayer = new Map();
      items.forEach(function (it) {
        let list = perPlayer.get(it.player);
        if (!list) { list = []; perPlayer.set(it.player, list); }
        list.push(it);
      });
      // 武勋 = 这一场打赢对手的含金量：几千几百说明打的是残兵/低等级，撑不起「强度」；
      // 武勋 0 基本是打空城/辎重（实测 553 场），同样没有参考价值——但仅当数据确实有武勋列时才这么判
      const isJunk = function (it) {
        if (it.noLoss === true) return true;
        return hasWuxunData && (it.wuxun || 0) <= 0;
      };
      let highWuxunRuns = 0, bestRunWuxun = 0, bestRunLen = 0, runWuxunSum = 0, runWuxunN = 0;
      let bestRun = null;                    // 最强的一段连赢（用于详情页「看战报」）
      const strongRuns = [];                 // 所有 3 连及以上的段（带战斗编号，可核对）
      const wuxunRef = opts.wuxunHigh > 0 ? opts.wuxunHigh : 4000;   // 「高质量连赢」的判定门槛
      perPlayer.forEach(function (list) {
        list.sort(function (x, y) { return x.ts - y.ts; });
        let seq = 0, last = null, seqWuxun = 0, seqWuxunN = 0, curRun = [];
        const closeStreak = function () {
          if (seq >= 3) strong3++;
          // 武勋按「每一场的我方武勋」累加：段内平均更能说明对手成色（不受连赢场数影响）
          const avg = seqWuxunN ? seqWuxun / seqWuxunN : 0;
          if (seq > 0) {
            runWuxunSum += avg; runWuxunN++;
            if (avg >= wuxunRef) highWuxunRuns++;
            const rec = {
              player: curRun.length ? curRun[0].player : '',
              len: seq, wuxun: seqWuxun, wuxunAvg: avg,
              ids: curRun.map(function (z) { return z.id; }),
              startTs: curRun.length ? curRun[0].ts : 0,
              endTs: curRun.length ? curRun[curRun.length - 1].ts : 0
            };
            if (seq >= 3) strongRuns.push(rec);
            if (isFinite(seqWuxun) && (bestRun === null || rec.len > bestRun.len ||
              (rec.len === bestRun.len && rec.wuxun > bestRun.wuxun))) bestRun = rec;
            if (seqWuxun > bestRunWuxun) { bestRunWuxun = seqWuxun; bestRunLen = seq; }
          }
          seq = 0; seqWuxun = 0; seqWuxunN = 0; curRun = [];
        };
        list.forEach(function (it) {
          // 练功局与打空城（武勋 0）：不参与判定，也不打断「同一支部队」的连续性
          if (isJunk(it)) return;
          // 连战判定：开战兵力 ≈ 上一场剩余 + 上一场伤兵；时间必须严格往后（同刻的并发记录不串成一波）
          const expOrigin = last ? ((last.remain || 0) + (last.wounded || 0)) : 0;
          const linked = last && last.remain !== null && it.origin !== null &&
            it.ts > last.ts && Math.abs(it.origin - expOrigin) <= Math.max(runTol, expOrigin * runTolRate);
          if (!linked) closeStreak();          // 兵力接不上：这一波结束
          if (it.won === true) {
            // 统计原料（statSrc）已经只含 block（一次真实交战一场），
            // 所以这里每条记录都计数，无需再区分 recordType。
            seq++;                             // 赢一场：连赢 +1
            seqWuxun += it.wuxun || 0;
            seqWuxunN++;
            curRun.push(it);                   // 记下这一场的战斗编号，详情页可点开看战报
            if (seq > bestStreak) bestStreak = seq;
            last = it;                         // 赢下来的这一场，剩余兵力才作数
          } else {
            closeStreak();                     // 输 / 平：连赢立刻断
            last = null;
          }
        });
        closeStreak();
      });
      node.streakBest = bestStreak;
      node.streakStrong = strong3;
      node.streakBestRun = bestRun;              // 最强连赢段（含战斗编号，供详情页看战报）
      node.streakStrongRuns = strongRuns;        // 所有 3 连以上的段（可逐段核对）
      node.streakWuxunMax = bestRunWuxun;        // 最值钱的一段连赢，累计武勋
      node.streakWuxunBestLen = bestRunLen;        // 这段是几连
      node.streakHighWuxun = highWuxunRuns;        // 单场平均武勋达标的连赢段数
      node.streakWuxunAvg = runWuxunN ? (runWuxunSum / runWuxunN) : 0;   // 连赢段的平均单场武勋（成色）
      node.streakRuns = node.streakAll;
      node.streakAvgRun = node.streakAll ? (node.streakSum / node.streakAll) : 0;
      let all = 0, multi = 0;
      for (const lk in node.streakLens) {
        const len = Number(lk);
        all += node.streakLens[lk];
        if (len >= 2) multi += node.streakLens[lk];
      }
      node.streakMulti = multi;
      node.streakAll = all;
      node.streakMultiRate = all ? multi / all : 0;   // 出战里打出过 2 连以上的比例
      node.streakMax = Math.max(node.streakMax || 0, bestStreak);

      // 打赢面的原料：交过手的对手种类、以及「有效对手数」（按对局分布的集中程度折算）
      // 「对手」按当前分析维度取：阵容维度 = 不同阵容，阵型维度 = 不同阵型。
      // 这里只负责交手面；真正进强度分的是 computeStrength 里的「赢过谁」。
      let maxOpp = 0, oppTypes = 0, sumSq = 0, topKey = '';
      node.opponents.forEach(function (o, otherKey) {
        oppTypes++;
        sumSq += o.n * o.n;
        if (o.n > maxOpp) { maxOpp = o.n; topKey = otherKey; }
      });
      node.oppTypes = oppTypes;
      node.oppSumSq = sumSq;
      node.topOppN = maxOpp;
      node.topOppKey = topKey;
      node.topOppShare = node.n ? maxOpp / node.n : 0;
      // 对手玩家维度：同样一套阵容换不同人来操作也算「交手面」的一部分（仅作展示与参考）
      node.oppPlayerTypes = 0;
      node.oppPlayerSumSq = 0;
      if (node.foePlayers) {
        node.foePlayers.forEach(function (fp) {
          node.oppPlayerTypes++;
          node.oppPlayerSumSq += fp.n * fp.n;
        });
      }

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

    /* ---------- 综合强度分 ----------
       五维加权：打击面（赢过多少支队伍）/ 胜率（公平压制力）/ 连胜（一次出战连赢几场）/
       战损（赢的时候省不省兵）/ 劣势（以少打多能不能赢）。
       各分项的「满分参照」按当前数据的 p90 自动标定，不同赛季 / 不同样本量都能用，
       强队自然靠近 90~100，弱队落在 30~60。 */
    const refs = autoRefs(nodeMap, pairMap);
    const strengthCtx = { opts: opts, pairMap: pairMap, refs: refs };
    nodeMap.forEach(function (node) { computeStrength(node, strengthCtx); });

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
      totalInput: statSrc.length,      // 参与统计的场次（默认只含 block）：与 totalKept 同口径
      rawInput: mergedRes.rawSegs,     // 导入的原始段数
      chainedMerged: mergedRes.merged, // 合并掉的续战链数
      childExcluded: src.length - statSrc.length,  // 被排除的续战段数
      totalKept: kept.length,
      skipped: skipped,
      skippedMirror: skippedMirror,
      skippedFilter: skippedFilter,
      nodeCount: nodeMap.size,
      nodeShown: nodeList.length,
      pairCount: pairMap.size,
      edgeCount: edges.length,
      edgeDropped: edgeDropped,
      runStats: runStats,               // 出战 / 连赢统计（口径自检用）
      refs: refs,                       // 分项参照线（自动标定结果，自检与说明用）
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
      allBattles: src,                 // 合并续战、但未做样本过滤的全量（供「被筛选排除」计数）
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
    computeStrength: computeStrength,
    strengthOf: strengthOf,
    DEFAULT_OPTS: DEFAULT_OPTS
  };
})(window.AC);
