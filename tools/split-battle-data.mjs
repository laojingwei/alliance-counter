/* 战报数据分片：把 viewer 导出的完整 battle-data.js 拆成多个小分片
   ------------------------------------------------------------
   为什么需要：
     Cloudflare Pages（alliance-counter.pages.dev）限制单个资源文件最大 25 MiB。
     完整数据文件约 27 MiB，会让整个部署直接失败：
       Error: Pages only supports files up to 25 MiB in size
     拆片后每个文件都远小于上限，浏览器端由 js/battle-data.js 合并回一份，
     其余代码只认 window.AC.battleData，无需任何改动。

   用法：
     node tools/split-battle-data.mjs                 # 拆 js/battle-data.js，每片上限 14 MiB
     node tools/split-battle-data.mjs <完整文件> [每片MiB]

   标准流程：
     1) sanmou-viewer「战报数据 → 导出数据文件」得到完整 battle-data.js
     2) 覆盖 alliance-counter/js/battle-data.js
     3) node tools/split-battle-data.mjs
        → 生成 js/battle-data.1.js ... battle-data.N.js，并把 js/battle-data.js 换成装载器
     4) index.html 里按 1..N 顺序引入各分片（见脚本末尾提示）

   注意：运行后 js/battle-data.js 已变成装载器（只有几行）。再次运行本脚本前，
        必须先用 viewer 导出的完整文件覆盖它，否则脚本会报错退出。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'js');
const LOADER = path.join(jsDir, 'battle-data.js');

const srcArg = process.argv[2] || LOADER;
const limitMiB = Number(process.argv[3] || 14);

if (!Number.isFinite(limitMiB) || limitMiB <= 0 || limitMiB >= 25) {
  console.error('每片上限必须是 0~25 之间的数值（Cloudflare Pages 硬上限是 25 MiB）');
  process.exit(1);
}
const limitBytes = Math.floor(limitMiB * 1024 * 1024);

if (!fs.existsSync(srcArg)) {
  console.error('找不到源文件：' + srcArg);
  process.exit(1);
}

const text = fs.readFileSync(srcArg, 'utf8');

if (/__AC_BD_PARTS/.test(text)) {
  console.error('源文件已经是分片或装载器（含 __AC_BD_PARTS），不是 viewer 导出的完整数据文件。');
  console.error('请先用 sanmou-viewer 重新导出的 battle-data.js 覆盖 ' + path.relative(root, srcArg) + '，再运行本脚本。');
  process.exit(1);
}

// 用沙箱执行源文件，取 window.AC.battleData（与页面里的加载方式一致）
const sandbox = { AC: {} };
try {
  new Function('window', text)(sandbox);
} catch (e) {
  console.error('执行源文件失败：' + e.message);
  process.exit(1);
}

const data = sandbox.AC && sandbox.AC.battleData;
if (!data || !Array.isArray(data.records) || !data.records.length) {
  console.error('源文件里没有 window.AC.battleData.records，不是 viewer 导出的战报数据。');
  process.exit(1);
}

const records = data.records;
const head = {
  schema: data.schema || 'ac-battle-data-v1',
  generatedAt: data.generatedAt || '',
  source: data.source || '',
  stats: data.stats || null
};

console.log('源文件：' + path.relative(root, srcArg));
console.log('记录数：' + records.length + ' 条');
console.log('每片上限：' + limitMiB + ' MiB');

// 按记录切分，按 UTF-8 字节累计（含分隔符）
const parts = [];
let cur = [];
let curBytes = 0;
for (let i = 0; i < records.length; i++) {
  const s = JSON.stringify(records[i]);
  const bytes = Buffer.byteLength(s, 'utf8') + 2;
  if (cur.length && curBytes + bytes > limitBytes) {
    parts.push(cur);
    cur = [];
    curBytes = 0;
  }
  cur.push(s);
  curBytes += bytes;
}
if (cur.length) parts.push(cur);

const total = parts.length;

// 写出各分片
for (let i = 0; i < total; i++) {
  const n = i + 1;
  const lines = [];
  lines.push('/* Sanmou 战报数据分片 ' + n + '/' + total + '（由 tools/split-battle-data.mjs 生成，勿手改）');
  lines.push('   整份数据被拆成 ' + total + ' 片，由 js/battle-data.js 合并回 window.AC.battleData；');
  lines.push('   index.html 必须按 1..' + total + ' 的顺序引入本文件。 */');
  lines.push('(window.__AC_BD_PARTS = window.__AC_BD_PARTS || []).push({');
  if (i === 0) {
    lines.push('  schema: ' + JSON.stringify(head.schema) + ',');
    lines.push('  generatedAt: ' + JSON.stringify(head.generatedAt) + ',');
    lines.push('  source: ' + JSON.stringify(head.source) + ',');
    lines.push('  stats: ' + JSON.stringify(head.stats) + ',');
  }
  lines.push('  records: [');
  lines.push(parts[i].join(',\n'));
  lines.push(']');
  lines.push('});');
  lines.push('');

  const file = path.join(jsDir, 'battle-data.' + n + '.js');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  const size = fs.statSync(file).size;
  const mib = size / 1024 / 1024;
  console.log('  → js/battle-data.' + n + '.js  ' + mib.toFixed(2) + ' MiB（' + parts[i].length + ' 条）'
    + (mib > 25 ? '  ❌ 超过 Pages 上限！' : ''));
}

// 清掉上一次留下的多余分片（例如上次 3 片、这次 2 片）
for (const f of fs.readdirSync(jsDir)) {
  const m = f.match(/^battle-data\.(\d+)\.js$/);
  if (m && Number(m[1]) > total) {
    fs.unlinkSync(path.join(jsDir, f));
    console.log('  - 删除多余分片 js/' + f);
  }
}

// 装载器：合并各片，组装 window.AC.battleData
const loader = [
  '/* Sanmou 战报数据装载器（由 tools/split-battle-data.mjs 生成，勿手改）',
  '   ------------------------------------------------------------',
  '   数据本体在 js/battle-data.1.js ... battle-data.' + total + '.js 里，',
  '   必须在本文件之前按序引入。',
  '   拆片原因：Cloudflare Pages 单个资源上限 25 MiB，整份数据约 27 MiB 会让部署失败。',
  '   本文件把各片合并回 window.AC.battleData —— 其余代码只认它，无需改动。 */',
  'window.AC = window.AC || {};',
  '(function () {',
  '  var EXPECTED = ' + total + ';',
  '  var parts = window.__AC_BD_PARTS || [];',
  '  // 任何一片没加载成功（onerror 标记）或片数不符时，宁可不给数据，',
  '  // 也不让页面拿着半份数据算出结论。',
  '  if (window.__acBdPartFail || parts.length !== EXPECTED) return;',
  '  var out = { schema: \'\', records: [] };',
  '  for (var i = 0; i < parts.length; i++) {',
  '    var p = parts[i] || {};',
  '    if (!out.schema && p.schema) out.schema = p.schema;',
  '    if (p.generatedAt) out.generatedAt = p.generatedAt;',
  '    if (p.source) out.source = p.source;',
  '    if (p.stats) out.stats = p.stats;',
  '    if (p.records && p.records.length) out.records = out.records.concat(p.records);',
  '  }',
  '  window.AC.battleData = out;',
  '  window.__AC_BD_PARTS = null;',
  '})();',
  ''
].join('\n');
fs.writeFileSync(LOADER, loader, 'utf8');

const totalSize = fs.readdirSync(jsDir)
  .filter((f) => /^battle-data\.\d+\.js$/.test(f))
  .reduce((a, f) => a + fs.statSync(path.join(jsDir, f)).size, 0);

console.log('');
console.log('完成：' + records.length + ' 条 → ' + total + ' 片，共 ' + (totalSize / 1024 / 1024).toFixed(2) + ' MiB');
console.log('js/battle-data.js 已换成装载器（' + fs.statSync(LOADER).size + ' 字节）');
console.log('');
console.log('记得确认 index.html 里按这个顺序引入了（每片都要带 onerror 标记）：');
for (let i = 1; i <= total; i++) {
  console.log('  <script src="js/battle-data.' + i + '.js?v=…" onerror="window.__acBdPartFail=true"></script>');
}
console.log('  <script src="js/battle-data.js?v=…" onerror="window.__noBattleData=true"></script>');
