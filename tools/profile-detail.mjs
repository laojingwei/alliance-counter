/* ============================================================
   明细表全面画像（新版 139 列）
   1) 战斗结构  2) 每列非空率/唯一值/样例  3) 关键字段分布与胜率关系
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console, TextDecoder };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/util.js', 'js/csv.js', 'js/model.js', 'js/detail.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, '..', f), 'utf8'), sandbox, { filename: f });
}
const AC = sandbox.window.AC;

const t0 = Date.now();
const text = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
const matrix = AC.csv.parseText(text);
const parseMs = Date.now() - t0;
const header = matrix[0].map((h) => String(h).trim());
const rows = matrix.slice(1).map((c) => {
  const o = {};
  for (let i = 0; i < header.length; i++) o[header[i]] = c[i] === undefined ? '' : String(c[i]).trim();
  return o;
});
console.log('列数:', header.length, '| 数据行:', rows.length, '| 解析耗时:', parseMs + 'ms');

/* ---- 1. 战斗结构 ---- */
const byBattle = new Map();
rows.forEach((r) => {
  const k = r['战斗编号'] || r['战斗Key'];
  if (!byBattle.has(k)) byBattle.set(k, []);
  byBattle.get(k).push(r);
});
const sizes = new Map();
byBattle.forEach((v) => sizes.set(v.length, (sizes.get(v.length) || 0) + 1));
console.log('唯一战斗数:', byBattle.size);
console.log('每场行数分布:', Array.from(sizes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + '行×' + v).join('  '));

/* ---- 2. 每列画像 ---- */
console.log('\n=== 每列画像（非空率 / 唯一值 / 样例）===');
const interest = [];
header.forEach((h) => {
  let nonEmpty = 0;
  const uniq = new Set();
  let sample = '';
  for (const r of rows) {
    const v = r[h];
    if (v !== '' && v !== undefined) {
      nonEmpty++;
      if (uniq.size < 300) uniq.add(v);
      if (!sample) sample = v;
    }
  }
  const rate = (nonEmpty / rows.length * 100).toFixed(0);
  console.log('  ' + h.padEnd(14, ' ') + ' ' + rate.padStart(3) + '%  唯一 ' + String(uniq.size).padStart(5) + '  例: ' + sample.slice(0, 42));
  if (uniq.size >= 2 && uniq.size <= 30 && nonEmpty > rows.length * 0.5) interest.push(h);
});

/* ---- 3. 低基数字段 = 候选分析维度 ---- */
console.log('\n=== 低基数字段（唯一值 2~30，可作为分析维度）===');
interest.forEach((h) => {
  const m = new Map();
  rows.forEach((r) => { const v = r[h]; if (v !== '') m.set(v, (m.get(v) || 0) + 1); });
  console.log('  ' + h + ': ' + Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '(' + v + ')').join('  '));
});

/* ---- 4. 关键字段与胜率 ---- */
function winRateBy(col) {
  const m = new Map();
  rows.forEach((r) => {
    const v = r[col];
    if (v === '' || v === '0') return;
    const o = m.get(v) || { n: 0, win: 0 };
    o.n++;
    if (r['方获胜'] === '是') o.win++;
    m.set(v, o);
  });
  return Array.from(m.entries()).sort((a, b) => b[1].n - a[1].n).slice(0, 12)
    .map(([k, v]) => k + ': ' + v.n + '次 ' + ((v.win / v.n) * 100).toFixed(1) + '%');
}

console.log('\n=== 关键维度 vs 方获胜率 ===');
['品', '红度', '编组', '兵种ID', '等级', '外部增益', '外部增益等级', '卦象', '战船类型', '赛季组件', '载具类型', '韬略道具', '技能1品', '兵书1品'].forEach((c) => {
  if (header.indexOf(c) < 0) return;
  console.log('\n--- ' + c + ' ---');
  console.log('  ' + winRateBy(c).join('\n  '));
});

/* ---- 5. 品 / 红度 与 武将 的关系 ---- */
console.log('\n=== 品 是否是武将固有属性 ===');
const heroAttr = new Map();
rows.forEach((r) => {
  const n = r['武将名'];
  if (!heroAttr.has(n)) heroAttr.set(n, { pin: new Set(), red: new Set(), comp: new Set(), troop: new Set() });
  const o = heroAttr.get(n);
  if (r['品']) o.pin.add(r['品']);
  if (r['红度']) o.red.add(r['红度']);
  if (r['编组']) o.comp.add(r['编组']);
  if (r['兵种ID']) o.troop.add(r['兵种ID']);
});
const multiPin = Array.from(heroAttr.entries()).filter(([, v]) => v.pin.size > 1);
console.log('武将数:', heroAttr.size, '| 品级不固定的武将:', multiPin.length);
console.log('样例:', Array.from(heroAttr.entries()).slice(0, 14).map(([k, v]) =>
  k + '[品' + Array.from(v.pin).join('') + ' 编' + Array.from(v.comp).join('') + ' 兵' + Array.from(v.troop).join('') + ' 红' + Array.from(v.red).sort().join('') + ']').join('  '));

/* ---- 6. 品 vs 红度 交叉 ---- */
console.log('\n=== 品 × 红度 的场次与胜率 ===');
const cross = new Map();
rows.forEach((r) => {
  const key = (r['品'] || '?') + '品-红' + (r['红度'] || '?');
  const o = cross.get(key) || { n: 0, win: 0 };
  o.n++;
  if (r['方获胜'] === '是') o.win++;
  cross.set(key, o);
});
console.log(Array.from(cross.entries()).sort().map(([k, v]) => k + ': ' + v.n + '次 ' + ((v.win / v.n) * 100).toFixed(0) + '%').join('\n'));
