/* ============================================================
   把「武将级明细表」做成内置示例数据
   1) 只保留分析用得到的列（原表 74 列 -> 精简）
   2) 强制脱敏（同盟名 / 玩家名）
   3) 输出精简 CSV + js/sample-data.js

   用法: node tools/make-detail-sample.mjs <明细表.csv> <输出.csv> <输出.js>
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { window: {}, console, TextDecoder };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['js/util.js', 'js/csv.js', 'js/model.js', 'js/detail.js', 'js/anonymize.js', 'js/analyzer.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, '..', f), 'utf8'), sandbox, { filename: f });
}
const AC = sandbox.window.AC;

const [inFile, outCsv, outJs] = process.argv.slice(2);
if (!inFile || !outCsv || !outJs) {
  console.error('用法: node tools/make-detail-sample.mjs <明细表.csv> <输出.csv> <输出.js>');
  process.exit(1);
}

// 分析需要的列：直接复用 detail.js 里的定义，避免两处不一致
const KEEP = AC.detail.DETAIL_HEADER;

const text = fs.readFileSync(inFile, 'utf8').replace(/^\uFEFF/, '');
let d = AC.detail.parse(text);
if (!d) { console.error('这不是明细表格式'); process.exit(2); }

/* 只保留「有效对局」，和网页端「生成内置数据」用的是同一套规则。
   剔除的对局在任何分析里都会被排除（内战没有克制方向、人数不足/等级过低是异常记录），
   留着只会白占内置数据的体积。加 --keep-all 可以跳过这一步。 */
const keepAll = process.argv.includes('--keep-all');
const VALID_RULES = {
  excludeMirror: false, onlyFull: true, minLevel: 30,
  minPair: 1, minAppear: 1, shrinkK: 3
};
if (!keepAll) {
  const kept = [];
  let mirror = 0, bad = 0;
  d.battles.forEach((b) => {

    if (!AC.analyzer.pairSampleOk(b.atk, b.def, VALID_RULES)) { bad++; return; }
    kept.push(b);
  });
  const keepIds = new Set(kept.map((b) => b.id));
  const keptRows = d.rows.filter((r) => keepIds.has(String(r['战斗编号'] || '').trim()));
  console.log('有效对局：' + d.battles.length + ' 场 -> 保留 ' + kept.length + ' 场' +
    '（剔除内战 ' + mirror + ' 场 / 异常记录 ' + bad + ' 场），明细行 ' +
    d.rows.length + ' -> ' + keptRows.length);
  d = { ...d, battles: kept, rows: keptRows };
}

const headerIdx = d.header.map((h) => String(h).trim());
const cols = KEEP.filter((c) => headerIdx.indexOf(c) >= 0);
const dropped = KEEP.filter((c) => headerIdx.indexOf(c) < 0);
if (dropped.length) console.log('源表缺少这些列，已跳过:', dropped.join(', '));

const rows = d.rows.map((o) => cols.map((c) => (o[c] === undefined ? '' : o[c])));

// 脱敏
const plan = AC.anonymize.buildPlan(cols, rows, {});
const res = AC.anonymize.applyPlan(cols, rows, plan, { anonNames: true });
console.log('脱敏：玩家 ' + res.stats.playerReplacements + ' 处 / ' + plan.stats.players +
  ' 人；同盟 ' + res.stats.allianceReplacements + ' 处 / ' + plan.stats.alliances + ' 个');
if (plan.stats.missing.length) console.log('警告：未识别到列 ' + plan.stats.missing.join('、'));

const csv = AC.anonymize.toCsvText(cols, res.rows);
fs.writeFileSync(outCsv, csv, 'utf8');
console.log('精简 CSV: ' + cols.length + ' 列 × ' + res.rows.length + ' 行  ' + (csv.length / 1024).toFixed(0) + ' KB');

// 顺带统计
const battles = AC.detail.parse(csv).battles;
const s = AC.detail.summary(battles);
console.log('聚合后: ' + s.battles + ' 场战斗 · ' + s.heroes + ' 名武将 · ' + s.skills + ' 种技能 · ' + s.equips + ' 种装备');

const banner = [
  '/* 内置示例战报表（武将级明细，自动生成，勿手改）',
  '   来源：' + path.basename(inFile),
  '   数据：' + s.battles + ' 场战斗 · ' + s.heroRows + ' 条武将记录 · ' + s.heroes + ' 名武将 · ' + s.skills + ' 种技能',
  '   已脱敏：同盟 / 玩家名恒定映射为假名',
  '   生成命令：node tools/make-detail-sample.mjs <明细表.csv> ' + path.basename(outCsv) + ' js/sample-data.js',
  '   页面左上「载入示例表」与 index.html?demo=1 都会使用它。 */',
  'window.AC = window.AC || {};',
  'window.AC.sampleCsv = '
].join('\n');

const js = banner + JSON.stringify(csv) + ';\n';
fs.writeFileSync(outJs, js, 'utf8');
console.log('内置数据 JS: ' + (js.length / 1024).toFixed(0) + ' KB');
