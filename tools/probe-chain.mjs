// 「打平续战多段」对统计的影响分析（直接调用生产函数 AC.model / AC.analyzer）
// 用法：node tools/probe-chain.mjs [项目根目录]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.argv[2] || '.');
const sandbox = {
  window: {}, console, performance: { now: () => Date.now() },
  TextDecoder, URL, setTimeout, clearTimeout, location: { hash: '' }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['js/util.js', 'js/csv.js', 'js/model.js', 'js/detail.js', 'js/analyzer.js', 'js/alliance.js', 'js/player.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
});
const AC = sandbox.window.AC;

const csvText = fs.readFileSync(path.join(root, 'samples/alliance_detail_sample.csv'), 'utf8');
const raw = AC.detail.parse(csvText).battles;
console.log('原始战报段数:', raw.length);

/* ---------- 1) 生产合并函数 ---------- */
const chains = AC.model.linkChains(raw);
const multi = chains.filter((c) => c.length > 1);
const segInMulti = multi.reduce((s, c) => s + c.length, 0);
const dist = {};
multi.forEach((c) => { dist[c.length] = (dist[c.length] || 0) + 1; });

console.log('\n=== 规模 ===');
console.log('链总数:', chains.length, '| 多段链:', multi.length, JSON.stringify(dist));
console.log('属于多段链的段:', segInMulti, '(', (segInMulti / raw.length * 100).toFixed(1), '% )');
console.log('合并后战斗数:', chains.length, '(比原始少', raw.length - chains.length, '场)');

const midRes = {}, tailRes = {};
multi.forEach((c) => {
  c.slice(0, -1).forEach((b) => { midRes[b.result] = (midRes[b.result] || 0) + 1; });
  tailRes[c[c.length - 1].result] = (tailRes[c[c.length - 1].result] || 0) + 1;
});
console.log('中间段 result 分布:', JSON.stringify(midRes), '| 最终段:', JSON.stringify(tailRes));

const mg = AC.model.mergeChains(raw);
console.log('mergeChains 返回: list', mg.list.length, '| merged', mg.merged, '| rawSegs', mg.rawSegs);
// 合并体自检：首末衔接的样例
const sample = multi[0];
if (sample) {
  const m = AC.model.mergeChain(sample);
  console.log('合并样例: 段数', sample.length,
    '| result', sample[0].result, '->', m.result,
    '| atk origin', m.atk.origin, 'remain', m.atk.remain,
    '| round 合计', m.round, '| 武勋', m.atk.wuxun, '| chainSegs', m.chainSegs);
}

/* ---------- 2) 生产 analyze 的两种口径对比 ---------- */
const OPT = { dimension: 'comp', minPair: 2, minAppear: 3, excludeMirror: true };
const rOff = AC.analyzer.analyze(raw, Object.assign({ mergeChains: false }, OPT));
const rOn = AC.analyzer.analyze(raw, OPT);

console.log('\n=== analyze 对比（mergeChains: false -> true）===');
console.log('生效对局:   ', rOff.stats.totalKept, '->', rOn.stats.totalKept);
console.log('统计分母:   ', rOff.stats.totalInput, '->', rOn.stats.totalInput, '| 续战合并', rOn.stats.chainedMerged, '次');
const d0 = rOff.battles.filter((b) => b.result === 'draw').length;
const d1 = rOn.battles.filter((b) => b.result === 'draw').length;
console.log('其中平局:   ', d0, '->', d1, '(虚增', d0 - d1, '场)');
console.log('全局平局率: ', (d0 / rOff.stats.totalKept * 100).toFixed(1) + '%', '->', (d1 / rOn.stats.totalKept * 100).toFixed(1) + '%');
console.log('allBattles（被筛选排除计数用）:', rOff.allBattles.length, '->', rOn.allBattles.length);

const diff = [];
rOff.nodeList.forEach((n) => {
  const m = rOn.nodeMap.get(n.key);
  if (!m || n.n < 10) return;
  diff.push({ name: n.display, a: n.rate, b: m.rate, d: m.rate - n.rate, n0: n.n, n1: m.n });
});
diff.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
console.log('\n阵容胜率变化最大的 5 个:');
diff.slice(0, 5).forEach((x) => {
  console.log('  ' + (x.d > 0 ? '+' : '') + (x.d * 100).toFixed(1) + 'pp  ' +
    (x.a * 100).toFixed(0) + '%(' + x.n0 + '场) -> ' + (x.b * 100).toFixed(0) + '%(' + x.n1 + '场)  ' + x.name);
});

// 残兵段不再单独进统计
const segsOverGap = (list) => list.filter((b) => Math.abs((b.atk.origin || 0) - (b.def.origin || 0)) > 3000).length;
console.log('\n兵力差 >3000 的对局:', segsOverGap(rOff.battles), '->', segsOverGap(rOn.battles),
  '（残兵段不再作为独立对局混进兵力公平样本）');
