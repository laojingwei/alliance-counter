/* 验证：1) 自实现的 MD5 与 Node crypto 一致  2) 跨批次假名稳定  3) 不碰撞 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console, TextDecoder, unescape, encodeURIComponent };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/csv.js', 'js/anonymize.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, '..', f), 'utf8'), sandbox, { filename: f });
}
const AC = sandbox.window.AC;

/* ---- 1. MD5 正确性 ---- */
const vectors = ['', 'abc', 'message digest', '1234567890', '诸葛亮', '同舟', '玩家_张三', 'a'.repeat(200)];
let ok = true;
console.log('=== MD5 与 Node crypto 对比 ===');
vectors.forEach((v) => {
  const mine = AC.anonymize.md5(v);
  const ref = crypto.createHash('md5').update(v, 'utf8').digest('hex');
  const same = mine === ref;
  if (!same) ok = false;
  console.log('  ' + JSON.stringify(v.length > 22 ? v.slice(0, 22) + '…' : v).padEnd(26) +
    ' ' + mine.slice(0, 16) + '…  ' + (same ? 'PASS' : 'FAIL (期望 ' + ref.slice(0, 16) + '…)'));
});
console.log('MD5 实现正确性:', ok ? 'PASS' : 'FAIL');

/* ---- 2. 跨批次稳定性 ---- */
console.log('\n=== 跨批次一致性（同一原名 -> 同一假名）===');
const names = ['同舟', '洪武盛世', '长生殿', '大漢'];
const rand = (seed) => { let x = seed; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };

const mapA = new Map(), mapB = new Map();
names.forEach((n) => {
  mapA.set(n, AC.anonymize.pseudoName('同盟', n, 5));
});
// 换一个"批次"：顺序打乱、还混入新名字
const shuffled = names.slice().reverse().concat(['新同盟X']);
shuffled.forEach((n) => {
  mapB.set(n, AC.anonymize.pseudoName('同盟', n, 5));
});
let stable = true;
names.forEach((n) => {
  const same = mapA.get(n) === mapB.get(n);
  if (!same) stable = false;
  console.log('  ' + n.padEnd(10) + ' 第一批 ' + mapA.get(n) + '   第二批 ' + mapB.get(n) + '   ' + (same ? 'PASS' : 'FAIL'));
});
console.log('跨批次稳定性:', stable ? 'PASS' : 'FAIL');

/* ---- 3. 碰撞检查 ---- */
console.log('\n=== 假名碰撞检查 ===');
const players = [];
const file = process.argv[2];
if (file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const matrix = AC.csv.parseText(text);
  const header = matrix[0].map((h) => String(h).trim());
  const pi = header.indexOf('玩家'), ai = header.indexOf('同盟');
  const pset = new Set(), aset = new Set();
  matrix.slice(1).forEach((c) => {
    if (c[pi]) pset.add(c[pi]);
    if (c[ai]) aset.add(c[ai]);
  });
  const seen = new Map();
  let collide = 0;
  pset.forEach((n) => {
    const p = AC.anonymize.pseudoName('玩家', n, 5);
    if (seen.has(p)) { collide++; console.log('  碰撞: ' + n + ' 与 ' + seen.get(p) + ' 都 -> ' + p); }
    seen.set(p, n);
  });
  console.log('玩家 ' + pset.size + ' 个（已脱敏名）-> 假名 ' + seen.size + ' 个，碰撞 ' + collide + ' 次');
  const aseen = new Map();
  let acollide = 0;
  aset.forEach((n) => {
    const p = AC.anonymize.pseudoName('同盟', n, 5);
    if (aseen.has(p)) acollide++;
    aseen.set(p, n);
  });
  console.log('同盟 ' + aset.size + ' 个 -> 假名 ' + aseen.size + ' 个，碰撞 ' + acollide + ' 次');

  // 确定性：同一输入反复调用必须得到相同结果
  const a1 = [...pset].map((n) => AC.anonymize.pseudoName('玩家', n, 5));
  const a2 = [...pset].map((n) => AC.anonymize.pseudoName('玩家', n, 5));
  console.log('假名派生确定性:', a1.every((v, i) => v === a2[i]) ? 'PASS' : 'FAIL');
}

/* ---- 4. 示例输出 ---- */
console.log('\n=== 假名示例 ===');
['同舟', '洪武盛世', '高端技师', '大炮叠叠'].forEach((n) => {
  console.log('  ' + n.padEnd(10) + ' -> ' + AC.anonymize.pseudoName('玩家', n, 5) + ' / ' + AC.anonymize.pseudoName('同盟', n, 5));
});
