// 在 Node 中离线验证解析 / 规范化 / 聚合逻辑（不依赖浏览器）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.argv[2] || '.');
const csvPath = process.argv[3];

const sandbox = { window: {}, console, performance: { now: () => Date.now() }, TextDecoder, URL, Blob: class {}, setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['js/util.js', 'js/csv.js', 'js/model.js', 'js/analyzer.js', 'js/store.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
});

const AC = sandbox.window.AC;
const text = fs.readFileSync(csvPath, 'utf8');

const parsed = AC.csv.parseTable(text);
console.log('解析数据行:', parsed.rows.length);
console.log('识别到的标准字段:', Object.keys(parsed.mapping.index).join(', '));
console.log('未映射列:', parsed.mapping.unmapped.map((u) => u.raw).join(' | ') || '(无)');

const battles = parsed.rows.map((r) => AC.model.toBattle(r)).filter(Boolean);
console.log('规范化战斗记录:', battles.length, ' 丢弃:', parsed.rows.length - battles.length);

const opts = { dimension: 'comp', minPair: 2, minAppear: 3, minLevel: 40, onlyFull: true, excludeMirror: true };
const res = AC.analyzer.analyze(battles, opts);
console.log('\n=== 默认过滤后 ===');
console.log('生效对局:', res.stats.totalKept, ' 排除内战:', res.stats.skippedMirror, ' 样本过滤:', res.stats.skippedFilter);
console.log('阵容节点:', res.stats.nodeCount, ' 展示:', res.stats.nodeShown, ' 对阵组合:', res.stats.pairCount, ' 有向克制:', res.stats.edgeCount);
console.log('平均回合:', res.stats.avgRound.toFixed(2));

console.log('\n=== 净压制力 top 10（阵容维度）===');
res.nodeList.slice().sort((a, b) => b.netPower - a.netPower).slice(0, 10).forEach((n) => {
  console.log(
    (n.netPower >= 0 ? '+' : '') + (n.netPower * 100).toFixed(1) + '%',
    String(n.n).padStart(4) + '场',
    '胜率', (n.rate * 100).toFixed(0) + '%',
    n.display
  );
});

console.log('\n=== 各阵容胜率一览（出场 >= 3）===');
res.nodeList.filter((n) => n.n >= 3).sort((a, b) => b.rate - a.rate).forEach((n) => {
  console.log(
    String(n.n).padStart(4) + '场',
    (n.rate * 100).toFixed(0).padStart(3) + '%',
    '战损比', n.exchange === null ? '-' : n.exchange.toFixed(2),
    '  ' + n.display
  );
});

// 交叉验证：手工独立统计 top 两个阵容的对阵
const norm = (s) => s.split('/').map((x) => x.trim()).sort().join(' / ');
const A = norm('SP周瑜 / 诸葛亮 / 诸葛瑾');
const B = norm('SP诸葛亮 / 姜维 / 钟会');
let n = 0, aWin = 0, bWin = 0, draw = 0;
for (const b of battles) {
  const ak = AC.model.compKey(b.atk.units), dk = AC.model.compKey(b.def.units);
  if (!((ak === A && dk === B) || (ak === B && dk === A))) continue;
  const aIsAtk = ak === A;
  n++;
  if (b.result === 'draw') draw++;
  else if ((b.result === 'atk') === aIsAtk) aWin++; else bWin++;
}
const p = AC.analyzer.getPair(res, A, B);
console.log('\n=== 交叉验证：' + A + ' VS ' + B + ' ===');
console.log('独立统计: n=' + n, 'A胜=' + aWin, 'B胜=' + bWin, '平=' + draw);
console.log('分析器结果: n=' + (p ? p.n : 0), 'winLo=' + (p ? p.winLo : 0), 'winHi=' + (p ? p.winHi : 0), 'draw=' + (p ? p.draw : 0),
  'rate=' + (p ? (p.rateLo * 100).toFixed(1) + '%' : '-'), 'score=' + (p ? (p.score * 100).toFixed(1) + '%' : '-'));
if (p) {
  console.log('攻守拆分: A作攻', p.nLoAsAtk + '场 胜率' + (p.winLoRateAsAtk === null ? '-' : (p.winLoRateAsAtk * 100).toFixed(0) + '%'),
    '| A作守', p.nLoAsDef + '场 胜率' + (p.winLoRateAsDef === null ? '-' : (p.winLoRateAsDef * 100).toFixed(0) + '%'));
}
const ok = p && p.n === n && p.winLo === aWin && p.winHi === bWin && p.draw === draw;
console.log('一致性:', ok ? 'PASS' : 'FAIL');

// 阵型维度
const fres = AC.analyzer.analyze(battles, Object.assign({}, opts, { dimension: 'formation' }));
console.log('\n=== 阵型维度 ===');
console.log('阵型数:', fres.stats.nodeShown, ' 克制边:', fres.stats.edgeCount);
fres.nodeList.forEach((n) => console.log('  ' + String(n.n).padStart(4) + '场', (n.rate * 100).toFixed(0).padStart(3) + '%', n.display));
console.log('\n阵型互克:');
fres.pairList.filter((p) => p.n >= 5).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).forEach((p) => {
  const lead = p.score > 0 ? p.lo : p.hi;
  const rate = p.score > 0 ? p.rateLo : 1 - p.rateLo;
  console.log('  ' + lead + ' 克 ' + (p.score > 0 ? p.hi : p.lo) + '  n=' + p.n + '  ' + (rate * 100).toFixed(0) + '%  score=' + (Math.abs(p.score) * 100).toFixed(1) + '%');
});
