/* 输出「诸葛亮 / 诸葛瑾 / SP周瑜」最高连赢的完整证据链：玩家、时间、每一场的兵力与对手、原始行号 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const sandbox = { window: {}, console, TextDecoder, performance: { now: () => Date.now() } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/util.js', 'js/csv.js', 'js/model.js', 'js/detail.js', 'js/analyzer.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const AC = sandbox.window.AC;
const csvPath = path.join(root, 'samples/real_full_sample.csv');
const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const battles = AC.detail.parse(text).battles;

const opts = { dimension: 'comp', minPair: 2, minAppear: 5, minLevel: 30, onlyFull: false, onlyForceParity: false, onlyRedParity: false };
const res = AC.analyzer.analyze(battles, opts);
const target = res.nodeList.find((n) => n.display.indexOf('诸葛瑾') >= 0);
console.log('目标阵容:', target.display);
console.log('节点: 出战', target.n, '场 | 筛选后口径 keep =', res.stats.totalKept, '场');
console.log('连胜: 最高连赢', target.streakBest, '场 | 3连以上', target.streakStrong, '次 | streakBestAll(全量口径)', target.streakBestAll);
console.log('连胜分项 =', target.sStreak.toFixed(1), '（公式 (best-1)/6*100，best=' + target.streakBest + '）');

// 用与分析器完全一致的逻辑重建：只取 keep 的战斗（筛选后）+ 只认 block + 排除无伤局
const recs = [];
res.battles.forEach((b) => {
  if (b.recordType === 'child') return;
  [['atk', 'def'], ['def', 'atk']].forEach((pair) => {
    const side = b[pair[0]], foe = b[pair[1]];
    if (!side || !side.player) return;
    const key = side.key;
    if (key !== target.key) return;
    recs.push({
      battleId: b.id, ts: b.ts, time: b.time, player: side.player, origin: side.origin, remain: side.remain,
      won: b.result === pair[0], noLoss: ((side.origin || 0) - (side.remain || 0)) <= 0 && ((foe.origin || 0) - (foe.remain || 0)) <= 0,
      foe: foe.player, foeComp: foe.compRaw, place: b.place, result: b.result, side: pair[0],
      draws: b.draws, subs: b.subs
    });
  });
});
console.log('\n筛选后属于该阵容的参战记录', recs.length, '条');

const byPlayer = new Map();
recs.forEach((r) => { if (!byPlayer.has(r.player)) byPlayer.set(r.player, []); byPlayer.get(r.player).push(r); });

const RUN_TOL = 200, RUN_RATE = 0.01;
let best = 0, bestInfo = null;
byPlayer.forEach((list, player) => {
  list.sort((a, b) => a.ts - b.ts);
  let seq = 0, last = null, cur = [];
  list.forEach((it) => {
    const linked = last && last.remain !== null && it.origin !== null && it.ts >= last.ts &&
      Math.abs(it.origin - last.remain) <= Math.max(RUN_TOL, last.remain * RUN_RATE);
    if (!linked) { seq = 0; cur = []; }
    if (it.won && !it.noLoss) {
      seq++; cur.push(it);
      if (seq > best) { best = seq; bestInfo = { player, items: cur.slice() }; }
    } else { seq = 0; cur = []; }
    last = it;
  });
});
console.log('\n=== 最高连赢 = ' + best + ' 场 ===');
if (bestInfo) {
  console.log('玩家:', bestInfo.player);
  bestInfo.items.forEach((it, i) => {
    console.log('  #' + (i + 1) + ' ' + it.time + ' | 战斗编号 ' + it.battleId + ' | 我方(' + it.side + ') 兵力 ' +
      it.origin + ' -> ' + it.remain + ' | 对手 ' + it.foe + ' [' + it.foeComp + '] | 结果 ' + it.result +
      ' | 平局数 ' + it.draws + ' 子战报 ' + it.subs + ' @' + it.place);
  });
}

// 该玩家在该阵容下的全部（筛选后）记录，看这一段前后的上下文
if (bestInfo) {
  const list = byPlayer.get(bestInfo.player).slice().sort((a, b) => a.ts - b.ts);
  console.log('\n=== 该玩家（' + bestInfo.player + '）该阵容的全部筛选后记录，共 ' + list.length + ' 条 ===');
  list.forEach((r, i) => console.log('  ' + String(i + 1).padStart(3) + ' ' + r.time + ' ' + (r.won ? '胜' : '负') +
    ' ' + r.origin + '->' + r.remain + ' vs ' + r.foe + ' @' + r.place + ' | ' + r.battleId + (r.noLoss ? ' [毫发无伤]' : '')));
}

// 找出这些战斗在原始 CSV 里的行号（按战斗编号定位），便于用户核对
const wantIds = new Set((bestInfo ? bestInfo.items : []).map((x) => x.battleId));
console.log('\n=== 原始 CSV 行号定位 ===');
const rl = readline.createInterface({ input: fs.createReadStream(csvPath, 'utf8'), crlfDelay: Infinity });
let lineNo = 0;
const found = [];
for await (const line of rl) {
  lineNo++;
  if (lineNo === 1) { console.log('  表头在第 1 行'); continue; }
  for (const id of wantIds) {
    if (line.indexOf(id) >= 0) { found.push({ id, lineNo, preview: line.slice(0, 150) }); break; }
  }
}
const grouped = {};
found.forEach((f) => { (grouped[f.id] = grouped[f.id] || []).push(f.lineNo); });
Object.keys(grouped).forEach((id) => console.log('  战斗编号 ' + id + ' -> 命中行 ' + grouped[id].join(', ')));
console.log('  （每个战斗编号在明细表里有 6 行：攻守各 3 个武将）');
