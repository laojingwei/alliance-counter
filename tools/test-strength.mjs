/* ============================================================
   强度排行口径验证（打斗广度）
   - 合成数据：构造两支「战绩完全相同、只差交手面宽窄」的队伍，
     断言广度计入强度分后宽的那支排前面
   - 合成数据：底分为负的弱队不会因为「打得多 / 打得杂」被抬起来
   - 真实样本（可选）：跑一遍，检查强度分口径自洽、无 NaN
   用法：node tools/test-strength.mjs [battle-data.js路径]（默认 js/battle-data.js）
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const sandbox = { window: {}, console, TextDecoder, performance: { now: () => Date.now() } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/util.js', 'js/model.js', 'js/sanmou-source.js', 'js/store.js', 'js/analyzer.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const AC = sandbox.window.AC;
const U = AC.util;

let failed = 0;
function check(ok, label, extra) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (extra === undefined ? '' : '  ' + extra));
  if (!ok) failed++;
}

/* ---------------- 合成战报 ---------------- */

const TROOPS = 30000;
const CH = '挑战者';
const CH_COMP = '甲 / 乙 / 丙';
let seq = 0;

function sideOf(who) {
  const comp = who === CH ? CH_COMP : oppComp(who);
  return {
    alliance: '测试盟', player: who, formation: '雁形阵',
    compRaw: comp, comp: comp, key: comp, units: comp.split(' / '),
    levels: [50, 50, 50], minLevel: 50, size: 3,
    origin: TROOPS, remain: Math.round(TROOPS * 0.6), wounded: 3000, dead: 3000,
    redAvg: 1, pinAvg: 1, troopSig: '枪弓骑', lossRate: 0.2
  };
}

/** 造一场战斗：chWins = 挑战者这一方是否获胜；result 就是「哪一方赢」（atk=攻方赢） */
function mk(atkName, defName, chWins, ts) {
  const chIsAtk = atkName === CH;
  const chWon = chWins;
  return {
    id: 'syn_' + (++seq),
    place: '100,100',
    time: new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
    ts: ts,
    result: (chWon === chIsAtk) ? 'atk' : 'def',
    round: 5,
    atk: sideOf(atkName),
    def: sideOf(defName)
  };
}

/** 每支对手队伍用各不相同、且都与「甲 / 乙 / 丙」不同的阵容 */
function oppComp(name) {
  if (name === '死对头') return '丁 / 戊 / 己';
  const i = Number(String(name).replace(/\D/g, '')) || 0;
  const ch = (k) => String.fromCharCode(0x4e00 + ((i * 7 + k * 131) % 2000));
  return ch(1) + ' / ' + ch(2) + ' / ' + ch(3);
}

/** 挑战者「甲 / 乙 / 丙」对每个对手打 pairN 场、赢 winRate；攻守各半 */
function buildPairs(opponents, pairN, winRate, startTs) {
  const list = [];
  let ts = startTs;
  for (const opp of opponents) {
    const wins = Math.round(pairN * winRate);
    for (let i = 0; i < pairN; i++) {
      const chWins = i < wins;
      const chIsAtk = i % 2 === 0;
      list.push(chIsAtk
        ? mk(CH, opp, chWins, ts + i * 60000)
        : mk(opp, CH, chWins, ts + i * 60000));
    }
    ts += pairN * 60000 + 60000;
  }
  return list;
}

// 合成数据里双方兵力相同，所以兵力对等过滤开着也不会掉场次；关掉它是为了不误伤「兵力不等」的构造
const OPTS = { dimension: 'comp', minPair: 1, minAppear: 1, minLevel: 0, onlyFull: true, excludeMirror: true, mergeChains: false, onlyForceParity: false };
const CHALLENGER = '甲 / 乙 / 丙';

/* ---------------- 连胜（兵力衔接）合成数据 ----------------
   一次出战 = 用上一场的剩余兵力接着打；输了 / 没有能接上的下一场 就结束。
   这里造一条真实的连续链，再混进「兵被打散后重新集结」的干扰项。 */
function mkSide(player, comp, origin, remain, wounded) {
  const w = (wounded === undefined) ? 0 : wounded;          // 伤兵默认 0：损失全记阵亡（= 下一场开战兵力等于剩余）
  const lost = Math.max(0, (origin || 0) - (remain || 0));
  return {
    alliance: '测试盟', player: player, formation: '雁形阵',
    compRaw: comp, comp: comp, key: comp, units: comp.split(' / '),
    levels: [50, 50, 50], minLevel: 50, size: 3,
    origin: origin, remain: remain, wounded: w, dead: Math.max(0, lost - w),
    redAvg: 1, pinAvg: 1, troopSig: '枪弓骑', lossRate: origin ? (origin - remain) / origin : 0
  };
}
let sync = 0;
/** 造一场：挑战者（指定阵容）对某支对手，可指定双方兵力与胜负 */
function mkFight(ts, oppComp, oppPlayer, atkIsCh, chOrigin, chRemain, chWins, oppOrigin, oppRemain, chWounded) {
  const chSide = mkSide('连战王', CHALLENGER, chOrigin, chRemain, chWounded);
  const foeSide = mkSide(oppPlayer, oppComp, oppOrigin, oppRemain);
  const atk = atkIsCh ? chSide : foeSide;
  const def = atkIsCh ? foeSide : chSide;
  return {
    id: 'synrun_' + (++sync),
    place: '200,200',
    time: new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
    ts: ts,
    result: (chWins === atkIsCh) ? 'atk' : 'def',   // 挑战者赢且它作攻 -> 攻方胜
    round: 5,
    atk: atk,
    def: def
  };
}

console.log('=== 0. 连胜识别：兵力衔接才算同一次出战 ===');
{
  const T0 = Date.UTC(2026, 5, 1);
  const battles = [];
  // 一次出战：30000 -> 28000 -> 25000，连赢 3 场（每一场的开战兵力 = 上一场剩余）
  // 对手兵力都设成相同的 27000：既让「兵力对等」过滤不掉场次，也不进「以少打多」统计
  const FOE = 27000;
  battles.push(mkFight(T0, '对手A', '玩家A', true, 30000, 28000, true, FOE, 12000));
  battles.push(mkFight(T0 + 3600e3, '对手B', '玩家B', false, 28000, 25000, true, FOE, 12000));
  battles.push(mkFight(T0 + 7200e3, '对手C', '玩家C', true, 25000, 20000, true, FOE, 12000));
  // 第 4 场：兵接得上但输了 -> 本次出战结束
  battles.push(mkFight(T0 + 9000e3, '对手D', '玩家D', true, 20000, 0, false, FOE, 12000));
  // 干扰项：兵被打散后重新集结（开战兵力接不上上一场剩余）-> 不能算同一次出战
  battles.push(mkFight(T0 + 20 * 3600e3, '对手E', '玩家E', true, 33000, 33000, true, FOE, 12000));

  const res = AC.analyzer.analyze(battles, Object.assign({}, OPTS, { onlyForceParity: false }));
  const ch = findChallenger(res);
  check(!!ch, '挑战者阵容进了统计', ch ? 'n=' + ch.n : '');
  check(ch.streakBest === 3, '兵力衔接链识别出「最高连赢 3 场」', 'streakBest=' + (ch && ch.streakBest));
  check(ch.streakStrong >= 1, '3 连以上次数统计正确',
    '段数=' + (ch && ch.streakAll) + ' 含2连以上=' + (ch && ch.streakMulti));
  // 同一场战斗只能算一次：合成数据里恰好 5 条参战记录落在连赢段中，
  // 多出来就说明「一条链的记录被挂到链上每场」这类重复统计又出现了（曾把 5 场算成 17 条）
  // 连胜段只统计「赢下来」的场次：合成数据里 3 连胜 + 1 场胜（兵重新集结那次）
  check(res.stats.runStats.streakBattles === 4, '连赢场次只算获胜场（败局不计）',
    'streakBattles=' + res.stats.runStats.streakBattles);
  check(res.stats.runStats.streakRuns >= 2, '连赢段数正常', 'runs=' + res.stats.runStats.streakRuns);
}

function findChallenger(res) {
  return res.nodeList.find((n) => n.display === CHALLENGER) || null;
}

// 伤兵会在战后恢复：下一场的开战兵力 = 上一场剩余 + 上一场伤兵（实测 8010 对相邻场次里 57% 精确成立）
{
  const FOE = '丁 / 戊 / 己';
  const TB = Date.UTC(2026, 5, 2);
  const B1 = [
    mkFight(TB, FOE, 'A', true, 30000, 28000, true, 27000, 12000, 1500),         // 30000 -> 28000，伤 1500
    mkFight(TB + 60e3, FOE, 'B', true, 29500, 27000, true, 27000, 12000, 2000),  // 开战 29500 = 28000 + 1500
    mkFight(TB + 120e3, FOE, 'C', true, 29000, 26000, true, 27000, 12000, 0)     // 开战 29000 = 27000 + 2000
  ];
  const rr = AC.analyzer.analyze(B1, OPTS);
  const nn = rr.nodeList.find(function (x) { return x.display === CH_COMP; });
  check(nn && nn.streakBest === 3, '伤兵恢复也算连战（开战 = 上场剩余 + 上场伤兵）',
    'streakBest=' + (nn ? nn.streakBest : 'n/a'));

  const B2 = [
    mkFight(TB, FOE, 'A', true, 30000, 28000, true, 27000, 12000, 1500),
    mkFight(TB + 60e3, FOE, 'B', true, 33000, 27000, true, 27000, 12000, 0)      // 33000：补了新兵，不是同一波
  ];
  const rr2 = AC.analyzer.analyze(B2, OPTS);
  const nn2 = rr2.nodeList.find(function (x) { return x.display === CH_COMP; });
  check(nn2 && nn2.streakBest === 1, '补了新兵的不算同一波连战', 'streakBest=' + (nn2 ? nn2.streakBest : 'n/a'));
}

console.log('=== 1. 战绩完全相同，只差「赢过多少支不同队伍」 ===');
{
  // 窄：只跟「死对头」打 150 场；宽：跟 15 支不同队伍各打 10 场。
  // 两边每个对手都是 60% 胜率（fair 赢面 ~57%，都算赢过），所以整体胜率、公平压制力都一样，
  // 唯一差别是「赢下来的对手种类」。
  const wide = [];
  for (let i = 1; i <= 15; i++) wide.push('对手' + i);
  const r1 = AC.analyzer.analyze(buildPairs(['死对头'], 150, 0.6, Date.UTC(2026, 0, 1)), OPTS);
  const r2 = AC.analyzer.analyze(buildPairs(wide, 10, 0.6, Date.UTC(2026, 1, 1)), OPTS);
  const a = findChallenger(r1), b = findChallenger(r2);

  check(!!a && !!b, '两队都进了统计', '窄 n=' + (a && a.n) + ' 宽 n=' + (b && b.n));
  check(Math.abs(a.rate - b.rate) < 1e-9, '两队总胜率完全相同', (a.rate * 100).toFixed(1) + '% vs ' + (b.rate * 100).toFixed(1) + '%');
  check(Math.abs(a.netPowerFair - b.netPowerFair) < 0.03, '两队公平压制力基本相同（每对按场次加权，允许小幅差）',
    U.fmtSigned(a.netPowerFair, 1) + ' vs ' + U.fmtSigned(b.netPowerFair, 1));
  check(b.oppTypes === 15 && a.oppTypes === 1, '交过手：窄 1 支 / 宽 15 支', a.oppTypes + ' / ' + b.oppTypes);
  check(b.beatKinds === 15 && a.beatKinds === 1, '赢过：窄 1 支 / 宽 15 支', a.beatKinds + ' / ' + b.beatKinds);
  check(b.sSpan - a.sSpan > 20, '打击面分拉开差距（只赢 1 支 = 0 分）', a.sSpan.toFixed(0) + ' -> ' + b.sSpan.toFixed(0));
  check(b.strength > a.strength, '赢过多种队伍的强度分更高',
    a.strength.toFixed(1) + ' vs ' + b.strength.toFixed(1));
  check(AC.analyzer.strengthOf(a) === a.strength && AC.analyzer.strengthOf(b) === b.strength, 'strengthOf 与节点口径一致');
}

console.log('\n=== 2. 弱队不会因为「打得多、打得杂」被抬高 ===');
{
  const wide = [];
  for (let i = 1; i <= 15; i++) wide.push('对手' + i);
  const r1 = AC.analyzer.analyze(buildPairs(['死对头'], 150, 0.35, Date.UTC(2026, 0, 1)), OPTS);
  const r2 = AC.analyzer.analyze(buildPairs(wide, 10, 0.35, Date.UTC(2026, 1, 1)), OPTS);
  const a = findChallenger(r1), b = findChallenger(r2);
  check(a.netPowerFair < -0.05 && b.netPowerFair < -0.05, '两队公平压制力都为明显负值',
    U.fmtSigned(a.netPowerFair, 1) + ' / ' + U.fmtSigned(b.netPowerFair, 1));
  check(a.beatKinds === 0 && b.beatKinds === 0, '打不过的阵容：赢过 0 支（交手再多也没用）', a.beatKinds + ' / ' + b.beatKinds);
  check(a.sSpan === 0 && b.sSpan === 0, '打击面分为 0（一支都没赢过）',
    a.sSpan.toFixed(0) + ' / ' + b.sSpan.toFixed(0));
  // 底分很负（-7.7% ~ -14.4%），就算样本大也只该落在「偏弱」区间，不该进强队档
  check(a.strength < 55 && b.strength < 55, '弱队不会因为「打得多」被抬成强队',
    a.strength.toFixed(1) + ' / ' + b.strength.toFixed(1));
  check(b.strength - a.strength < 12, '同一支弱队：交手面宽也只略有差别（打击面权重 32% 但不是全部）',
    a.strength.toFixed(1) + ' -> ' + b.strength.toFixed(1));
}

console.log('\n=== 3. 综合强度分口径自洽 ===');
{
  const wide = [];
  for (let i = 1; i <= 12; i++) wide.push('对手' + i);
  const res = AC.analyzer.analyze(buildPairs(wide, 8, 0.55, Date.UTC(2026, 2, 1)), OPTS);
  let bad = 0, worst = null;
  const KEYS = ['sSpan', 'sWin', 'sStreak', 'sLoss', 'sDis'];
  res.nodeList.forEach((n) => {
    const flag = function () { bad++; worst = n; };
    if (!isFinite(n.strength) || n.strength < 0 || n.strength > 100) flag();
    KEYS.forEach((k) => { if (!isFinite(n[k]) || n[k] < 0 || n[k] > 100) flag(); });
    if (n.beatKinds > n.oppTypes) flag();                 // 赢过的不可能多于交过手的
    if (n.beatKinds === 0 && n.sSpan !== 0) flag();       // 一支没赢过 -> 打击面 0
    if (!isFinite(n.streakMax) || n.streakMax < 0) flag();
    if (!isFinite(n.effBeat) || n.effBeat < 0) flag();
  });
  // 综合分 = 有数据分项的加权平均：用同一套权重手算一遍核对
  const W = { sSpan: 0.32, sWin: 0.26, sStreak: 0.18, sLoss: 0.12, sDis: 0.12 };
  let sumBad = 0;
  res.nodeList.forEach((n) => {
    const has = { sSpan: true, sWin: true, sStreak: true, sLoss: n.lossN >= 3, sDis: n.nDis >= 3 && n.rateDis !== null };
    const capOf = (v) => v <= 60 ? v : 60 + (v - 60) * ((n.scoreCap - 60) / 40);
    let s = 0, w = 0;
    KEYS.forEach((k) => { if (has[k]) { s += capOf(Math.min(100, n[k])) * W[k]; w += W[k]; } });
    if (w > 0 && Math.abs(s / w - n.strength) > 1) sumBad++;
  });
  check(bad === 0, '每个节点：强度分与五项分都在 0~100，赢过 <= 交过手，未赢过则打击面为 0',
    bad ? '异常 ' + bad + ' 个，例：' + (worst && worst.display) : res.nodeList.length + ' 个节点全部通过');
  check(sumBad === 0, '综合分等于「有数据分项」的加权平均（手算复核）', '不符 ' + sumBad + ' 个');
}

/* ---------------- 真实样本回归（可选） ---------------- */
const csv = process.argv[2] || 'js/battle-data.js';
{
  const file = path.isAbsolute(csv) ? csv : path.join(root, csv);
  if (!fs.existsSync(file)) {
    console.log('\n数据文件不存在，跳过真实数据回归：' + file);
  } else {
    console.log('\n=== 4. 真实样本回归：' + path.basename(file) + ' ===');
    // 数据可能被拆成多片（Cloudflare Pages 单文件上限 25 MiB，见 tools/split-battle-data.mjs）：
    // 同目录下若有 battle-data.N.js，就按数字序依次执行，最后执行传入的装载器文件。
    const dir = path.dirname(file);
    const partFiles = fs.readdirSync(dir)
      .filter((f) => /^battle-data\.\d+\.js$/.test(f))
      .sort((a, b) => Number(a.match(/\.(\d+)\./)[1]) - Number(b.match(/\.(\d+)\./)[1]))
      .map((f) => path.join(dir, f));
    const runFiles = partFiles.length ? partFiles.concat([file]) : [file];
    runFiles.forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f }));
    const battles = AC.sanmou.toBattles();
    const res = AC.analyzer.analyze(battles, {
      dimension: 'comp', minPair: 2, minAppear: 3, minLevel: 40,
      onlyFull: true, onlyForceParity: false, onlyRedParity: true, redParityGap: 1
    });
    const list = res.nodeList.slice().sort((a, b) => b.strength - a.strength);
    let bad = 0;
    list.forEach((n) => {
      if (!isFinite(n.strength) || n.strength < 0 || n.strength > 100) bad++;
      if (!isFinite(n.effBeat) || !isFinite(n.streakMax)) bad++;
      if (n.oppTypes < 1) bad++;
      if (n.beatKinds > n.oppTypes) bad++;
      if (n.beatKinds === 0 && n.sSpan !== 0) bad++;
    });
    check(bad === 0, '真实数据：综合分在 0~100、赢过 <= 交过手、未赢过则打击面为 0', list.length + ' 个阵容');
    console.log('  生效 ' + res.stats.totalKept + ' 场 · 阵容 ' + list.length + ' 个（已按强度分排序，前 8）');
    list.slice(0, 8).forEach((n, i) => {
      console.log('   #' + (i + 1) + ' ' + String(n.n).padStart(4) + '场  ' +
        '综合 ' + n.strength.toFixed(1) +
        '（打击面 ' + n.sSpan.toFixed(0) + ' 胜率 ' + n.sWin.toFixed(0) + ' 连胜 ' + n.sStreak.toFixed(0) +
        ' 战损 ' + n.sLoss.toFixed(0) + ' 劣势 ' + n.sDis.toFixed(0) + '）' +
        '  | 赢过 ' + n.beatKinds + '/' + n.oppTypes + ' 支 · 最长 ' + n.streakMax + ' 连' +
        '  | ' + n.display);
    });
  }
}

console.log('\n' + (failed ? 'FAILED ' + failed + ' 项' : 'ALL PASS'));
process.exit(failed ? 1 : 0);
