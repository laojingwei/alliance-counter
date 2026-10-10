/* ============================================================
   战报脱敏命令行工具
   脱敏逻辑与页面共用一份实现：js/anonymize.js

   用法：
     node tools/anonymize.mjs <输入.csv> <输出.csv> [选项]

   选项：
     --player-prefix=玩家     玩家假名前缀（默认 玩家）
     --alliance-prefix=同盟   同盟假名前缀（默认 同盟）
     --anon-id                把战斗Key / 父战报中的数字ID做哈希替换
     --anon-place             把地点坐标替换为 区域N
     --report                 在终端打印完整映射表（默认只打印统计）
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/* ---------- 复用与页面完全相同的解析与脱敏实现 ---------- */
const sandbox = { window: {}, console, TextDecoder, TextEncoder };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['js/csv.js', 'js/anonymize.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, '..', f), 'utf8'), sandbox, { filename: f });
}
const AC = sandbox.window.AC;

/* ---------- 参数 ---------- */
const args = process.argv.slice(2);
const flags = {};
const positional = [];
args.forEach((a) => {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags[k] = v === undefined ? true : v;
  } else positional.push(a);
});
const [inFile, outFile] = positional;
if (!inFile || !outFile) {
  console.error('用法: node tools/anonymize.mjs <输入.csv> <输出.csv> [--anon-id] [--anon-place] [--report]');
  process.exit(1);
}

/* ---------- 读取（自动识别 UTF-8 / GB18030） ---------- */
const buf = fs.readFileSync(inFile);
let text;
try {
  text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
} catch (e) {
  text = new TextDecoder('gb18030').decode(buf);
  console.error('（输入按 GB18030 解码）');
}
text = text.replace(/^\uFEFF/, '');

const parsed = AC.csv.parseTable(text);
const header = parsed.header;
const rows = parsed.rows.map((r) => r.__raw);

if (!rows.length) {
  console.error('没有解析到数据行。');
  process.exit(2);
}

/* ---------- 生成方案并应用 ---------- */
const plan = AC.anonymize.buildPlan(header, rows, {
  playerPrefix: flags['player-prefix'] || '玩家',
  alliancePrefix: flags['alliance-prefix'] || '同盟',
  nameMode: flags['name-mode'] || 'md5'    // md5 = 由原始名派生（跨批次稳定）；index = 按出场顺序编号
});

if (plan.stats.missing.length) {
  console.error('缺少列，无法脱敏：' + plan.stats.missing.join('、'));
  process.exit(3);
}

const applied = AC.anonymize.applyPlan(header, rows, plan, {
  anonNames: true,
  anonId: !!flags['anon-id'],
  anonPlace: !!flags['anon-place']
});

fs.writeFileSync(outFile, AC.anonymize.toCsvText(applied.header, applied.rows), 'utf8');

/* ---------- 报告 ---------- */
console.log('输入: ' + path.basename(inFile) + '  输出: ' + path.basename(outFile));
console.log('数据行: ' + applied.stats.rows);
console.log('玩家名替换: ' + applied.stats.playerReplacements + ' 处 / 共 ' + plan.stats.players + ' 个不同玩家');
console.log('同盟名替换: ' + applied.stats.allianceReplacements + ' 处 / 共 ' + plan.stats.alliances + ' 个不同同盟');
if (applied.stats.ids) console.log('战斗Key/父战报 ID 替换: ' + applied.stats.ids + ' 个不同 ID 片段');
if (applied.stats.places) console.log('地点坐标替换: ' + applied.stats.places + ' 个不同坐标');
if (flags.report) {
  console.log('\n--- 同盟映射 ---');
  plan.allianceMap.forEach((v, k) => console.log('  ' + k + ' -> ' + v));
  console.log('\n--- 玩家映射 ---');
  plan.playerMap.forEach((v, k) => console.log('  ' + k + ' -> ' + v));
}
