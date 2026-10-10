// 数据画像脚本：了解阵容分布、对局样本量、等级差分布
import fs from 'node:fs';

const src = process.argv[2];
const raw = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');

function splitLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
const head = splitLine(lines[0]);
const rows = lines.slice(1).map((l) => {
  const cells = splitLine(l);
  const o = {};
  head.forEach((h, i) => { o[h] = cells[i] ?? ''; });
  return o;
});

const norm = (s) => s.split('/').map((x) => x.trim()).filter(Boolean).sort().join(' / ');

const aComp = new Map();
const dComp = new Map();
const lvGap = new Map();
for (const r of rows) {
  const a = norm(r['攻方阵容']);
  const d = norm(r['守方阵容']);
  aComp.set(a, (aComp.get(a) || 0) + 1);
  dComp.set(d, (dComp.get(d) || 0) + 1);
  const al = (r['攻方等级'] || '').split('/').length;
  const dl = (r['守方等级'] || '').split('/').length;
  const k = `${al}v${dl}`;
  lvGap.set(k, (lvGap.get(k) || 0) + 1);
}

const all = new Map();
for (const [k, v] of aComp) all.set(k, (all.get(k) || 0) + v);
for (const [k, v] of dComp) all.set(k, (all.get(k) || 0) + v);

const sorted = [...all.entries()].sort((x, y) => y[1] - x[1]);
console.log('规范化后阵容总数:', all.size);
console.log('--- 出场频次 top 30 ---');
sorted.slice(0, 30).forEach(([k, v]) => console.log(String(v).padStart(4), k));

console.log('--- 人数结构（攻/守） ---');
console.log([...lvGap.entries()].sort().map(([k, v]) => `${k}:${v}`).join('  '));

// 对局 pair 样本量
const pairs = new Map();
for (const r of rows) {
  const a = norm(r['攻方阵容']);
  const d = norm(r['守方阵容']);
  if (a === d) continue;
  const k = `${a} ||| ${d}`;
  pairs.set(k, (pairs.get(k) || 0) + 1);
}
const pv = [...pairs.values()].sort((a, b) => b - a);
console.log('--- 有效对阵 pair 数:', pairs.size, ' 最多对局次数:', pv[0], ' 次数分布(前20):', pv.slice(0, 20).join(','));
const once = pv.filter((v) => v === 1).length;
console.log('仅 1 次对局的 pair 数:', once, `(${((once / pv.length) * 100).toFixed(1)}%)`);

// 自对战
const mirror = rows.filter((r) => norm(r['攻方阵容']) === norm(r['守方阵容'])).length;
console.log('同名阵容内战:', mirror);

// 低等级/刷分场
const low = rows.filter((r) => (r['攻方等级'] || '').split('/').some((x) => +x <= 5) || (r['守方等级'] || '').split('/').some((x) => +x <= 5)).length;
console.log('含 5 级以下单位的战斗:', low);

// 时间范围
const times = rows.map((r) => r['时间']).filter(Boolean).sort();
console.log('时间范围:', times[0], '->', times[times.length - 1]);
console.log('同盟:', [...new Set(rows.flatMap((r) => [r['攻方同盟'], r['守方同盟']]).filter(Boolean))].join(', '));
