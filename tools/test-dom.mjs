/* ============================================================
   端到端 DOM 验证（无需真实浏览器）
   起一个临时静态服务 -> jsdom 加载 index.html?demo=1 -> 检查
   1) 是否抛出 JS 错误  2) 数据链路是否正确  3) 各视图 DOM 是否渲染
   画布用假 2D context 顶替，只为跑通代码路径
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(process.argv[2] || '.');
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.csv': 'text/csv' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const p = path.join(root, decodeURIComponent(rel));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => problems.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => problems.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => problems.push('console.warn: ' + a.join(' ')));

function fakeCtx() {
  const target = {
    canvas: { width: 900, height: 600 },
    measureText: (t) => ({ width: String(t).length * 6.2 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) })
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

const dom = await JSDOM.fromURL(`http://127.0.0.1:${port}/index.html?demo=1`, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
    window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new window.Blob([])); };
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      return { width: 900, height: 620, left: 0, top: 0, right: 900, bottom: 620, x: 0, y: 0 };
    };
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 900; }, configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 620; }, configurable: true });
    window.confirm = () => true;
  }
});

const w = dom.window;
await new Promise((r) => w.addEventListener('load', r, { once: true }));
await new Promise((r) => setTimeout(r, 900));   // 让动画/布局跑若干帧

function report() {
  const d = w.document;
  const AC = w.AC;
  const txt = (sel) => { const n = d.querySelector(sel); return n ? n.textContent.trim() : '(缺失)'; };

  console.log('=== DOM 冒烟验证 ===');
  console.log('AC 命名空间:', !!AC, '| 模块:', AC ? Object.keys(AC).join(',') : '-');
  console.log('统计条: 战斗=' + txt('#statBattles'), '阵容=' + txt('#statNodes'), '克制=' + txt('#statEdges'), '对阵=' + txt('#statPairs'), '批次=' + txt('#statBatches'));
  console.log('数据摘要:', txt('#dataSummary'));
  console.log('[诊断] store:', w.AC.app.store.battles.length, '场 /', w.AC.app.store.batches.length,
    '批次 | sampleCsv 字符数', w.AC.sampleCsv.length, '| localStorage 键',
    (() => { try { return Object.keys(w.localStorage).join(',') || '(无)'; } catch (e) { return '读取失败'; } })(),
    '| state.result 生效场次', w.AC.app.state.result ? w.AC.app.state.result.stats.totalKept : '-');
  console.log('底部说明:', txt('#stageFoot').replace(/\s+/g, ' ').slice(0, 160));

  const rankRows = d.querySelectorAll('#rankWrap .rank-row').length;
  const tableRows = d.querySelectorAll('#dataTable tbody tr').length;
  const pagerText = txt('#tablePager');
  const batchItems = d.querySelectorAll('#batchList .batch-item').length;
  console.log('排行行数:', rankRows, '| 战报表行数:', tableRows, '| 分页:', pagerText, '| 导入批次:', batchItems);

  // 直接调用内部逻辑验证交互路径
  const insp = d.querySelector('#inspector');
  const nodes = Array.from(d.querySelectorAll('#rankWrap .rank-row')).slice(1, 4);
  nodes.forEach((row) => row.dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
  console.log('点击排行后详情面板长度:', insp.innerHTML.length, '| 含"阵容详情":', insp.innerHTML.indexOf('阵容详情') >= 0);

  // 矩阵与图表的绘制调用（假 context 不报错即视为通过）
  const canvas = d.querySelector('#graphCanvas');
  console.log('graphCanvas 尺寸:', canvas.width + 'x' + canvas.height, '| matrixCanvas:', d.querySelector('#matrixCanvas').width + 'x' + d.querySelector('#matrixCanvas').height);

  // 切换到阵型维度
  const dimBtn = d.querySelector('#dimSeg .seg-btn[data-dim="formation"]');
  dimBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  console.log('切到阵型维度后:', '阵容=' + txt('#statNodes'), '克制=' + txt('#statEdges'), '| 排行行数:', d.querySelectorAll('#rankWrap .rank-row').length);

  // 过滤滑块
  const slider = d.querySelector('#minAppear');
  slider.value = '10';
  slider.dispatchEvent(new w.Event('input', { bubbles: true }));
}

report();
await new Promise((r) => setTimeout(r, 500));

// 基线：内置数据规模不固定（随时可以用「生成内置数据」更新），后续断言都以它为基准
const BASE = w.AC.app.store.battles.length;
console.log('基准场次（内置数据规模）:', BASE);

// 假名格式：md5 模式为「前缀 + 5 位十六进制」，旧的顺序编号模式也兼容
const PSEUDO_P = /^玩家(\d+|[0-9A-F]{5})$/;
const PSEUDO_A = /^同盟(\d+|[A-Z]\d*|[0-9A-F]{5})$/;

/* ---------- 旧版本存档必须被忽略（否则新代码读到残缺记录，兵种等字段会缺失） ---------- */
{
  // 先把当前正常存档挪开，保证这段测试只受旧存档影响
  const backup = w.localStorage.getItem('ac.battles.v3');
  w.localStorage.removeItem('ac.battles.v3');

  w.localStorage.setItem('ac.battles.v2', JSON.stringify({ version: 2, battles: [{ id: 'legacy-1' }] }));
  const s = new w.AC.Store();
  s.load();
  console.log('旧版本存档被忽略:', s.battles.length === 0 ? 'PASS' : 'FAIL ' + s.battles.length);
  console.log('旧 key 已清除:', w.localStorage.getItem('ac.battles.v2') === null ? 'PASS' : 'FAIL');

  // 版本不符的新 key 也应丢弃
  w.localStorage.setItem('ac.battles.v3', JSON.stringify({ version: 1, battles: [{ id: 'stale-1' }] }));
  const s2 = new w.AC.Store();
  s2.load();
  console.log('版本不符的存档被丢弃:', s2.battles.length === 0 ? 'PASS' : 'FAIL');

  // 复原
  w.localStorage.removeItem('ac.battles.v3');
  if (backup) w.localStorage.setItem('ac.battles.v3', backup);
}

/* ---------- 内置数据本身必须已脱敏 ---------- */
{
  const bad = [];
  if (w.AC.detail.sniff(w.AC.sampleCsv)) {
    // 明细表：单列「玩家」「同盟」
    const d = w.AC.detail.parse(w.AC.sampleCsv);
    d.rows.forEach((r) => {
      if (r['玩家'] && !PSEUDO_P.test(r['玩家'])) bad.push('玩家:' + r['玩家']);
      if (r['同盟'] && !PSEUDO_A.test(r['同盟'])) bad.push('同盟:' + r['同盟']);
    });
    console.log('内置数据格式: 武将级明细 |', d.battles.length, '场 /', d.rows.length, '行');
  } else {
    const parsed = w.AC.csv.parseTable(w.AC.sampleCsv);
    const gi = parsed.mapping.index;
    parsed.rows.forEach((r) => {
      [gi.atkPlayer, gi.defPlayer].forEach((i) => {
        const v = String(r.__raw[i] || '').trim();
        if (v && !PSEUDO_P.test(v)) bad.push('玩家:' + v);
      });
      [gi.atkAlliance, gi.defAlliance].forEach((i) => {
        const v = String(r.__raw[i] || '').trim();
        if (v && !PSEUDO_A.test(v)) bad.push('同盟:' + v);
      });
    });
    console.log('内置数据格式: 传统宽表 |', parsed.rows.length, '行');
  }
  console.log('磁盘内置数据已脱敏（玩家/同盟均为假名）:',
    bad.length === 0 ? 'PASS' : 'FAIL 发现 ' + bad.slice(0, 5).join(', '));
}

/* ---------- 叠加导入 / 表头自动映射 专项验证 ---------- */
console.log('\n=== 叠加导入与表头自适应 ===');
const stacked = w.AC.app.ingest(w.AC.sampleCsv, '同一份表再导入一次', true);
console.log('重复导入同一份表 -> 新增', stacked.added, '重复', stacked.dup,
  '| 期望 新增0 重复' + BASE + ':', stacked.added === 0 && stacked.dup === BASE ? 'PASS' : 'FAIL');

// 换一种表头写法 + 分号分隔 + 打乱列顺序，验证自动映射与叠加
const variant = [
  'result;defenderTeam;battleTime;attackerTeam;defenderFormation;attackerFormation;attackerName;defenderName;round',
  '攻方胜;"甲一 / 甲二 / 甲三";2026-10-11T12:00:00;"乙一 / 乙二 / 乙三";鱼鳞阵;雁形阵;测试攻;测试守;3',
  '守方胜;丙一 ;2026-10-11T12:05:00;"乙一 / 乙二 / 乙三";雁形阵;箕形阵;测试攻2;测试守2;5'
].join('\n');
const vres = w.AC.app.ingest(variant, '异构表头.csv', true);
console.log('异构表头导入 -> 新增', vres ? vres.added : 'null', '| 期望 2:', vres && vres.added === 2 ? 'PASS' : 'FAIL');

const afterStats = w.AC.app.state.result.stats;
console.log('叠加后有效对局:', afterStats.totalKept, '| 累计战斗:', w.AC.app.store.battles.length,
  '| 批次:', w.AC.app.store.batches.length);

// 新阵容是否进入节点集合（前面的步骤切到了阵型维度，这里切回阵容并把门槛调低）
w.AC.app.filters.dimension = 'comp';
w.AC.app.filters.minAppear = 1;
w.AC.app.recompute();
const keys = Array.from(w.AC.app.state.result.nodeMap.keys());
const hasNew = keys.some((k) => k.indexOf('乙一') >= 0);
console.log('新导入阵容已进入分析结果:', hasNew ? 'PASS' : 'FAIL', '(' + keys.filter((k) => k.indexOf('乙一') >= 0).join(' , ') + ')');

// 移除刚才这批，确认可回滚
const lastBatch = w.AC.app.store.batches[w.AC.app.store.batches.length - 1];
const removed = w.AC.app.store.removeBatch(lastBatch.id);
w.AC.app.recompute();
console.log('移除该批次回滚', removed, '场 -> 累计战斗:', w.AC.app.store.battles.length,
  '| 期望回到 ' + BASE + ':', w.AC.app.store.battles.length === BASE ? 'PASS' : 'FAIL');

/* ---------- 生成内置数据（浏览器端转换链路） ---------- */
console.log('\n=== 生成内置数据 ===');
w.AC.app.openGenDrawer();
const gen = w.AC.app.computeConversion();

const genIsDetail = w.AC.detail.hasDetail(gen.battles);
console.log('来源:', w.document.querySelector('#genSource').value,
  '| 战斗数:', gen.battles.length, '| 导出行数:', gen.applied.rows.length,
  '| 列数:', gen.header.length, '| 明细格式:', genIsDetail ? '是' : '否',
  '| 战斗数与基准一致:', gen.battles.length === BASE ? 'PASS' : 'FAIL',
  '| 明细行数远大于战斗数:', genIsDetail ? (gen.applied.rows.length > gen.battles.length ? 'PASS' : 'FAIL') : '(不适用)');

// 生成的 sample-data.js 必须能被执行并产出可用的 CSV
const fakeWindow = {};
new Function('window', gen.js)(fakeWindow);
const regenerated = fakeWindow.AC && fakeWindow.AC.sampleCsv;
console.log('导出的 sample-data.js 可执行:', regenerated && regenerated.length > 1000 ? 'PASS' : 'FAIL');

// 脱敏是否生效：玩家列应全部是「玩家NN」，同盟列应全部是「同盟X」
let badPlayers, badAlliances;
if (w.AC.detail.sniff(gen.csv)) {
  const dd = w.AC.detail.parse(gen.csv);
  badPlayers = dd.rows.map((r) => String(r['玩家'] || '').trim()).filter((v) => v && !PSEUDO_P.test(v));
  badAlliances = dd.rows.map((r) => String(r['同盟'] || '').trim()).filter((v) => v && !PSEUDO_A.test(v));
} else {
  const gp = w.AC.csv.mapHeader(gen.applied.header).index;
  badPlayers = gen.applied.rows.map((r) => String(r[gp.atkPlayer] || '').trim()).filter((v) => v && !PSEUDO_P.test(v));
  badAlliances = gen.applied.rows
    .flatMap((r) => [String(r[gp.atkAlliance] || '').trim(), String(r[gp.defAlliance] || '').trim()])
    .filter((v) => v && !PSEUDO_A.test(v));
}
console.log('脱敏生效（玩家/同盟全部为假名）:',
  badPlayers.length === 0 && badAlliances.length === 0 ? 'PASS' : 'FAIL ' + badPlayers.concat(badAlliances).slice(0, 5).join(','));

// 关键回归：转换出来的内置表再走一遍完整分析，统计必须与原始一致
const rebattles = w.AC.detail.sniff(regenerated)
  ? w.AC.detail.parse(regenerated).battles
  : w.AC.csv.parseTable(regenerated).rows.map((r) => w.AC.model.toBattle(r)).filter(Boolean);
const ANALYSIS_OPTS = { dimension: 'comp', minPair: 2, minAppear: 3, minLevel: 40, onlyFull: true, excludeMirror: true };
const reStats = w.AC.analyzer.analyze(rebattles, ANALYSIS_OPTS).stats;
const expectStats = w.AC.analyzer.analyze(w.AC.app.store.battles, ANALYSIS_OPTS).stats;
const sameStats = rebattles.length === w.AC.app.store.battles.length &&
  reStats.totalKept === expectStats.totalKept &&
  reStats.nodeShown === expectStats.nodeShown &&
  reStats.edgeCount === expectStats.edgeCount;
console.log('回灌分析: 规范化', rebattles.length, '场 / 生效', reStats.totalKept,
  '| 阵容', reStats.nodeShown, '| 克制', reStats.edgeCount,
  '| 与原始(' + expectStats.totalKept + '/' + expectStats.nodeShown + '/' + expectStats.edgeCount + ')一致:',
  sameStats ? 'PASS' : 'FAIL');

// 关闭脱敏时应给出警告（走真实的 change 事件路径）
const anonBox = w.document.querySelector('#genAnon');
anonBox.checked = false;
anonBox.dispatchEvent(new w.Event('change', { bubbles: true }));
const noAnon = w.AC.app.computeConversion();
const warn = w.document.querySelector('#genPreview').textContent.indexOf('未脱敏') >= 0;
console.log('关闭脱敏时提示风险:', warn ? 'PASS' : 'FAIL',
  '| 未脱敏时仍能生成:', noAnon.battles.length === BASE ? 'PASS' : 'FAIL');

// 重新开启脱敏，应恢复为“可安全分发”
anonBox.checked = true;
anonBox.dispatchEvent(new w.Event('change', { bubbles: true }));
const safe = w.document.querySelector('#genPreview').textContent.indexOf('可安全随项目分发') >= 0;
console.log('重新开启脱敏后提示安全:', safe ? 'PASS' : 'FAIL');
w.AC.app.closeGenDrawer();

/* ---------- 同盟分析 ---------- */
console.log('\n=== 同盟分析 ===');
w.AC.app.switchView('alliance');
const allyItems = w.document.querySelectorAll('#allyList .ally-item').length;
const detailText = w.document.querySelector('#allyDetail').textContent;
const sections = ['主流队伍', '如何克制该同盟', '针对其主流队伍的单点克制', '主力玩家', '惯用阵型', '活跃时段'];
const missingSec = sections.filter((t) => detailText.indexOf(t) < 0);
console.log('同盟列表项:', allyItems, '| 详情区块齐全:',
  missingSec.length === 0 ? 'PASS' : 'FAIL 缺少 ' + missingSec.join('/'));

const r2 = w.AC.app.state.result;
const alliances = w.AC.allianceAnalysis.build(r2);
const target = alliances.find((a) => a.n >= 30);
const advice = w.AC.allianceAnalysis.counterAdvice(r2, target);
console.log('目标同盟:', target.name, '|', target.n, '场 | 主流队伍', target.compList.length, '套 | 反制推荐', advice.length, '条');

const inRange = advice.every((a) => a.expRate > 0 && a.expRate < 1 && a.coverage > 0 && a.coverage <= 1.0000001);
// 证据量收缩只能把条件胜率拉向 50%，绝不会抬高
const shrinkOk = advice.every((a) => {
  const lo = Math.min(a.rawRate, 0.5), hi = Math.max(a.rawRate, 0.5);
  return a.expRate >= lo - 1e-9 && a.expRate <= hi + 1e-9;
});
// 覆盖面硬门槛：能评估的出场不得低于 35%
const covOk = advice.every((a) => a.coverage >= 0.35 - 1e-9);
console.log('胜率/覆盖率取值合理:', inRange ? 'PASS' : 'FAIL',
  '| 证据量收缩只拉向五五开:', shrinkOk ? 'PASS' : 'FAIL',
  '| 满足覆盖门槛(>=35%):', covOk ? 'PASS' : 'FAIL');

// 分组排序：通用方案（覆盖 >= 60%）整体排在针对性方案之前
const firstNarrow = advice.findIndex((a) => a.coverage < 0.6);
const lastBroad = advice.reduce((acc, a, i) => (a.coverage >= 0.6 ? i : acc), -1);
const grouped = firstNarrow === -1 || lastBroad === -1 || lastBroad < firstNarrow;
console.log('通用方案排在针对性方案之前:', grouped ? 'PASS' : 'FAIL');

// 组内按条件胜率降序
const withinSorted = advice.every((a, i) => {
  if (i === 0) return true;
  const prevBroad = advice[i - 1].coverage >= 0.6, curBroad = a.coverage >= 0.6;
  return prevBroad !== curBroad || advice[i - 1].expRate >= a.expRate - 1e-9;
});
console.log('组内按胜率降序:', withinSorted ? 'PASS' : 'FAIL');

// 候选必须满足打击面门槛
const tooFew = advice.filter((a) => a.n < 5);
console.log('候选均满足打击面门槛（全局 >=5 次出场）:', tooFew.length === 0 ? 'PASS' : 'FAIL ' + tooFew.length + ' 个');

// 对方自己在用的主力阵容应当可以入选（镜像对拼），只是那部分没有对抗数据
const mirrorable = advice.filter((a) => a.mirrorShare > 0.01);
console.log('允许对方主力阵容入选(镜像):',
  mirrorable.length > 0 ? 'PASS（' + mirrorable.length + ' 条含镜像）' : '(本数据无镜像场景)');

console.log('推荐首位:', advice[0].display);
console.log('  条件胜率', w.AC.util.fmtPct(advice[0].expRate),
  '| 可评估覆盖', w.AC.util.fmtPct(advice[0].coverage, 0),
  '| 镜像', w.AC.util.fmtPct(advice[0].mirrorShare, 0),
  '| 实交手', advice[0].evidence, '场',
  '| 全局出场', advice[0].n, '次 / 胜率', w.AC.util.fmtPct(advice[0].rate, 0),
  advice[0].coverage >= 0.6 ? '| 通用方案' : '| 针对性方案');
console.log('  推荐首位是否高于五五开:', advice[0].expRate >= 0.5 ? 'PASS' : '注意：数据本身如此');

// 结论文案必须与数据一致：期望胜率不到五五开时，不能说「推荐用它」
{
  const txt = w.document.querySelector('#allyDetail').textContent;
  const noWin = advice[0].expRate < 0.5;
  const saysRecommend = txt.indexOf('推荐用「' + advice[0].display + '」应对') >= 0;
  const saysNoWin = txt.indexOf('没有哪套阵容能压住') >= 0;
  const ok = noWin ? (saysNoWin && !saysRecommend) : true;
  console.log('结论与数据一致（不到五五开时不硬推）:', ok ? 'PASS' : 'FAIL',
    '(期望胜率 ' + w.AC.util.fmtPct(advice[0].expRate) + ' → ' + (noWin ? '应提示压不住' : '可给推荐') + ')');
}

// 覆盖率独立复算
let cover = 0;
target.compList.forEach((c) => {
  if (c.key === advice[0].key) return;
  const p = w.AC.analyzer.getPair(r2, c.key, advice[0].key);
  if (p && p.n >= 2) cover += c.n;
});
const ic = cover / target.n;
console.log('覆盖率独立复算:', w.AC.util.fmtPct(ic), 'vs 模块输出', w.AC.util.fmtPct(advice[0].coverage),
  Math.abs(ic - advice[0].coverage) < 1e-9 ? 'PASS' : 'FAIL');

// 条件胜率独立复算：分母只取「有交手数据」的部分，镜像部分跳过
let reScore = 0, reCover = 0, reEvidence = 0;
target.compList.forEach((c) => {
  if (c.key === advice[0].key) return;                       // 镜像（内战）不参与
  const w2 = c.n / target.n;
  const p = w.AC.analyzer.getPair(r2, c.key, advice[0].key);
  if (!p || p.n < 2) return;                                 // 没交手过：跳过（不再按 50% 填充）
  const myRate = p.lo === advice[0].key ? p.rateLo : 1 - p.rateLo;
  reScore += w2 * ((myRate * p.n + 0.5 * 3) / (p.n + 3));
  reCover += w2;
  reEvidence += p.n;
});
const reRaw = reScore / reCover;
const reAdjusted = (reRaw * reEvidence + 0.5 * 3) / (reEvidence + 3);
console.log('条件胜率独立复算:', w.AC.util.fmtPct(reAdjusted), 'vs 模块输出', w.AC.util.fmtPct(advice[0].expRate),
  Math.abs(reAdjusted - advice[0].expRate) < 1e-9 ? 'PASS' : 'FAIL',
  '| 覆盖独立复算:', Math.abs(reCover - advice[0].coverage) < 1e-9 ? 'PASS' : 'FAIL',
  '| 交手场次一致:', reEvidence === advice[0].evidence ? 'PASS' : 'FAIL');

// 明细胜率：绕开 pairMap，直接从原始战斗记录独立统计，验证方向没写反
function rawRate(result, xKey, cKey) {
  let n = 0, draw = 0, win = 0;
  result.battles.forEach((b) => {
    const ak = b.atk.key, dk = b.def.key;
    if (!((ak === xKey && dk === cKey) || (ak === cKey && dk === xKey))) return;
    n++;
    const xIsAtk = ak === xKey;
    if (b.result === 'draw') draw++;
    else if ((b.result === 'atk') === xIsAtk) win++;
  });
  return { n: n, rate: n ? (win + draw * 0.5) / n : null };
}
const d0 = advice[0].detail[0];
// 注意方向：d0.rate 是「推荐阵容」打「同盟的这套队伍」的胜率
const raw = rawRate(r2, advice[0].key, d0.key);
console.log('明细样本数一致:', raw.n === d0.n ? 'PASS' : 'FAIL (' + raw.n + ' vs ' + d0.n + ')',
  '| 明细胜率与独立统计一致:', Math.abs(raw.rate - d0.rate) < 1e-9 ? 'PASS' : 'FAIL');

// 单点克制建议
const perComp = w.AC.allianceAnalysis.bestAgainst(r2, target);
const pcOk = perComp.length > 0 && perComp.every((x) => x.best.every((b) => b.rate >= 0 && b.rate <= 1));
console.log('单点克制建议:', perComp.length, '套队伍 |', pcOk ? 'PASS' : 'FAIL');

// 点击列表可切换同盟
const items = w.document.querySelectorAll('#allyList .ally-item');
items[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const sw = w.document.querySelector('#allyDetail').textContent.length;
console.log('点击列表切换同盟后详情仍正常:', sw > 200 ? 'PASS' : 'FAIL');

// 主力玩家列表的「战报」按钮：复用玩家分析那套仿游戏战报卡浮层
{
  const logBtns = w.document.querySelectorAll('#allyDetail .at-log').length;
  let ok = false, nCards = 0;
  if (logBtns) {
    w.document.querySelector('#allyDetail .at-log').click();
    const m = w.document.querySelector('.bl-mask');
    nCards = m ? m.querySelectorAll('.bl2-card').length : 0;
    ok = !!m && nCards > 0;
    const cb = m && m.querySelector('.bl-close');
    if (cb) cb.click();
  }
  console.log('玩家行「战报」按钮:', logBtns, '个 | 点击打开战报浮层:', ok ? 'PASS' : 'FAIL', '| 卡片', nCards);
}

/* ---------- 武将 / 技能 / 装备分析 ---------- */
console.log('\n=== 武将分析 ===');
w.AC.app.switchView('heroes');
const heroData = w.AC.allianceAnalysis ? w.AC.heroAnalysis.build(r2) : null;
console.log('武将', heroData.heroes.length, '名 | 技能', heroData.skills.length,
  '种 | 装备', heroData.equips.length, '种 | 战马', heroData.horses.length, '种');

const heroItems = w.document.querySelectorAll('#heroList .ally-item').length;
const heroDetailText = w.document.querySelector('#heroDetail').textContent;
const heroSections = ['常带技能', '常用兵书', '最佳搭档', '对阵阵容表现', '技能强度榜', '装备 / 战马强度榜'];
const missHero = heroSections.filter((t) => heroDetailText.indexOf(t) < 0);
console.log('武将列表项:', heroItems, '| 详情区块齐全:', missHero.length === 0 ? 'PASS' : 'FAIL 缺少 ' + missHero.join('/'));

// 出场累计必须等于原始武将行数
// 口径对齐 heroes.js 的聚合端：无名武将行会被跳过，技能槽按「非空」计（明细表固定 3 槽，没带满是空串）
let rawHeroRows = 0, rawSkillUses = 0;
r2.battles.forEach((b) => {
  [b.atk, b.def].forEach((side) => {
    (side.heroes || []).forEach((h) => {
      if (!h.name) return;
      rawHeroRows++;
      rawSkillUses += (h.skills || []).filter(Boolean).length;
    });
  });
});
const sumHeroN = heroData.heroes.reduce((s, h) => s + h.n, 0);
const sumSkillN = heroData.skills.reduce((s, x) => s + x.n, 0);
console.log('武将出场累计一致:', sumHeroN === rawHeroRows ? 'PASS' : 'FAIL (' + sumHeroN + ' vs ' + rawHeroRows + ')',
  '| 技能携带累计一致:', sumSkillN === rawSkillUses ? 'PASS' : 'FAIL (' + sumSkillN + ' vs ' + rawSkillUses + ')');
// 技能表里不该出现空名（空技能槽被解析成空技能就是 bug）
const emptySkills = heroData.skills.filter((s) => !s.name).length;
console.log('技能表无空名项:', emptySkills === 0 ? 'PASS' : 'FAIL (' + emptySkills + ' 项)');

// 抽一个武将，绕开模块独立重算胜率
const h0 = heroData.heroes[0];
let hn = 0, hw = 0, hd = 0;
r2.battles.forEach((b) => {
  [['atk', b.atk], ['def', b.def]].forEach((pair) => {
    const role = pair[0], side = pair[1];
    if (!(side.heroes || []).some((x) => x.name === h0.name)) return;
    hn++;
    if (b.result === 'draw') hd++;
    else if (b.result === role) hw++;
  });
});
const hRate = hn ? (hw + hd * 0.5) / hn : 0.5;
console.log('武将胜率独立复算:', h0.name, w.AC.util.fmtPct(hRate), 'vs', w.AC.util.fmtPct(h0.rate),
  Math.abs(hRate - h0.rate) < 1e-9 && hn === h0.n ? 'PASS' : 'FAIL');

// 技能胜率：抽一个技能独立重算
const s0 = heroData.skills[0];
let skN = 0, skW = 0, skD = 0;
r2.battles.forEach((b) => {
  [['atk', b.atk], ['def', b.def]].forEach((pair) => {
    const role = pair[0], side = pair[1];
    (side.heroes || []).forEach((hh) => {
      const has = (hh.skills || []).some((x) => w.AC.heroAnalysis.parseSkill(x).base === s0.name);
      if (!has) return;
      skN++;
      if (b.result === 'draw') skD++;
      else if (b.result === role) skW++;
    });
  });
});
const sRate = skN ? (skW + skD * 0.5) / skN : 0.5;
console.log('技能胜率独立复算:', s0.name, w.AC.util.fmtPct(sRate), 'vs', w.AC.util.fmtPct(s0.rate),
  Math.abs(sRate - s0.rate) < 1e-9 && skN === s0.n ? 'PASS' : 'FAIL');

// 点击列表切换武将
const hItems = w.document.querySelectorAll('#heroList .ally-item');
if (hItems[2]) hItems[2].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
console.log('点击列表切换武将后详情正常:', w.document.querySelector('#heroDetail').textContent.length > 200 ? 'PASS' : 'FAIL');

/* ---------- 红度 / 品级控制 ---------- */
console.log('\n=== 红度与品级控制 ===');
{
  const hasRed = (b) => b.atk.redAvg !== null && b.atk.redAvg !== undefined &&
    b.def.redAvg !== null && b.def.redAvg !== undefined;
  const withRed = w.AC.app.store.battles.filter(hasRed).length;
  console.log('带红度数据的对局:', withRed, '/', w.AC.app.store.battles.length);

  // 开启「红度对等」时，生效对局里不应存在红度差过大的场次
  w.AC.app.filters.onlyRedParity = true;
  w.AC.app.filters.redParityGap = 1;
  w.AC.app.recompute();
  const keptOn = w.AC.app.state.result.stats.totalKept;
  const bad = w.AC.app.state.result.battles.filter((b) =>
    hasRed(b) && Math.abs(b.atk.redAvg - b.def.redAvg) > 1);
  console.log('红度对等开启：生效', keptOn, '场 | 其中红度差 > 1 的（应为 0）:', bad.length,
    bad.length === 0 ? 'PASS' : 'FAIL');

  // 关闭后应放回更多对局
  w.AC.app.filters.onlyRedParity = false;
  w.AC.app.recompute();
  const keptOff = w.AC.app.state.result.stats.totalKept;
  console.log('红度对等关闭：生效', keptOff, '场 | 放回', keptOff - keptOn, '场',
    keptOff >= keptOn ? 'PASS' : 'FAIL');

  // 最低红度门槛
  w.AC.app.filters.onlyRedParity = false;
  w.AC.app.filters.minRedAvg = 3;
  w.AC.app.recompute();
  const lowRed = w.AC.app.state.result.battles.filter((b) =>
    hasRed(b) && Math.min(b.atk.redAvg, b.def.redAvg) < 3);
  console.log('最低红度 3：生效', w.AC.app.state.result.stats.totalKept, '场 | 仍有低红对局（应为 0）:',
    lowRed.length, lowRed.length === 0 ? 'PASS' : 'FAIL');

  // 恢复默认
  w.AC.app.filters.onlyRedParity = true;
  w.AC.app.filters.minRedAvg = 0;
  w.AC.app.recompute();

  // 红度确实影响胜负（数据事实校验）
  const bucket = new Map();
  w.AC.app.store.battles.forEach((b) => {
    if (b.result === 'unknown') return;
    [['atk', b.atk], ['def', b.def]].forEach((p) => {
      const side = p[1];
      if (side.redAvg === null || side.redAvg === undefined) return;
      const k = Math.round(side.redAvg);
      const o = bucket.get(k) || { n: 0, win: 0 };
      o.n++;
      if (b.result !== 'draw' && b.result === p[0]) o.win++;
      bucket.set(k, o);
    });
  });
  const curve = Array.from(bucket.entries()).sort((a, b) => a[0] - b[0])
    .map(([k, v]) => '红' + k + ':' + v.n + '场 ' + ((v.win / v.n) * 100).toFixed(0) + '%');
  console.log('红度-胜率（全部数据）: ' + curve.join('  '));
}

/* ---------- 红度档位分层 + 推荐风险提示 ---------- */
console.log('\n=== 红度档位分层 ===');
{
  const kept = {};
  ['all', 'low', 'mid', 'high'].forEach((tier) => {
    w.AC.app.filters.redTier = tier;
    w.AC.app.recompute();
    kept[tier] = w.AC.app.state.result.stats.totalKept;
  });
  console.log('各档位生效场次:', JSON.stringify(kept));
  console.log('  三档之和不超过全部:', (kept.low + kept.mid + kept.high) <= kept.all + 1 ? 'PASS' : 'FAIL');

  w.AC.app.filters.redTier = 'low';
  w.AC.app.recompute();
  const bad = w.AC.app.state.result.battles.filter((b) => {
    if (b.atk.redAvg === null || b.def.redAvg === null) return false;
    return (b.atk.redAvg + b.def.redAvg) / 2 >= 1.5;
  });
  console.log('  低红档内不含中/高红对局:', bad.length === 0 ? 'PASS' : 'FAIL ' + bad.length + ' 场');

  w.AC.app.filters.redTier = 'high';
  w.AC.app.recompute();
  const bad2 = w.AC.app.state.result.battles.filter((b) => {
    if (b.atk.redAvg === null || b.def.redAvg === null) return false;
    return (b.atk.redAvg + b.def.redAvg) / 2 < 2.5;
  });
  console.log('  高红档内不含低/中红对局:', bad2.length === 0 ? 'PASS' : 'FAIL ' + bad2.length + ' 场');

  w.AC.app.filters.redTier = 'all';
  w.AC.app.recompute();
}

console.log('\n=== 推荐的风险提示 ===');
{
  const adv2 = w.AC.allianceAnalysis.counterAdvice(w.AC.app.state.result, target);
  const withRisk = adv2.filter((a) => a.risks && a.risks.length);
  console.log('带风险提示的推荐:', withRisk.length + ' / ' + adv2.length,
    withRisk.length > 0 ? 'PASS' : '（本数据对方没有能压制候选的队伍）');
  if (adv2[0].risks.length) {
    const ok = adv2[0].risks.every((r) => r.rate < 0.5);
    const sorted = adv2[0].risks.every((r, i) => i === 0 || adv2[0].risks[i - 1].share >= r.share);
    console.log('  首位推荐的风险项胜率均 <50%:', ok ? 'PASS' : 'FAIL',
      '| 按对方使用频率降序:', sorted ? 'PASS' : 'FAIL');
    console.log('  风险示例:', adv2[0].risks.slice(0, 3).map((r) => r.comp + '（占其 ' +
      w.AC.util.fmtPct(r.share, 0) + '，只赢 ' + w.AC.util.fmtPct(r.rate, 0) + '）').join('  |  '));
  }
  // 对阵详情里的红度分层表
  const pair = w.AC.analyzer.getPair(w.AC.app.state.result, target.compList[0].key, target.compList[1].key);
  if (pair) {
    console.log('  对阵红度分层: 共', pair.byRedList.length, '档',
      pair.byRedList.map((x) => '红' + x.level + ':' + x.n + '场' + w.AC.util.fmtPct(x.rateLo, 0)).join(' '));
  }
}

console.log('\n=== 玩家分析 ===');
{
  w.AC.app.switchView('players');
  const items = w.document.querySelectorAll('#playerList .ally-item').length;
  const txt = w.document.querySelector('#playerDetail').textContent;
  const secs = ['各队伍的武将红度', '如何克制他', '针对他每套队伍的单点克制', '结论', '他的作战习惯'];
  const miss = secs.filter((t) => txt.indexOf(t) < 0);
  console.log('玩家列表项:', items, '| 详情区块齐全:', miss.length === 0 ? 'PASS' : 'FAIL 缺少 ' + miss.join('/'));
  // 手操抓克制：习惯面板必须给出「哪套队伍专打哪套」的判断（命中对手集中度高的玩家才显示）
  const view0 = w.AC.app.playerRef();
  const sniperPlayers = (view0.data.players || []).filter((p) => p.snipers && p.snipers.length);
  const listBadges = w.document.querySelectorAll('#playerList .ai-sniper').length;
  // 挑一个「真克制」类型的玩家：只有它才用 hb-sniper 高亮行（focus 是普通行、feeding 用 is-warn）
  const counterPlayer = sniperPlayers.filter((p) => p.snipers.some((c) => c.sniper.kind === 'counter'))[0] || sniperPlayers[0];
  let sniperRow = false;
  if (counterPlayer) {
    view0.select(counterPlayer.name);
    sniperRow = !!w.document.querySelector('#playerDetail .hb-sniper');
  }
  const kinds = { counter: 0, focus: 0, feeding: 0 };
  sniperPlayers.forEach((p) => p.snipers.forEach((c) => { kinds[c.sniper.kind] = (kinds[c.sniper.kind] || 0) + 1; }));
  console.log('手操抓克制：识别到', sniperPlayers.length, '名玩家 | 列表徽章', listBadges, '个 | 类型',
    JSON.stringify(kinds), '| 习惯面板有抓克制行:', (!sniperPlayers.length || sniperRow) ? 'PASS' : 'FAIL');
  if (sniperPlayers.length && !sniperRow) process.exitCode = 1;

  const view = w.AC.app.playerRef();
  const players = view.data.players;

  // ① 平均红度：必须等于「按场次取 side.redAvg」的复算值（不再跨阵容重复累加武将）
  const expRed = new Map();
  view.result.battles.forEach((b) => [b.atk, b.def].forEach((sd) => {
    if (!sd.player || sd.redAvg === null || sd.redAvg === undefined) return;
    const o = expRed.get(sd.player) || { s: 0, n: 0 };
    o.s += sd.redAvg; o.n++; expRed.set(sd.player, o);
  }));
  const redOk = players.every((p) => {
    const e = expRed.get(p.name);
    if (!e || !e.n) return p.avgRed === null;
    return p.avgRed !== null && Math.abs(p.avgRed - e.s / e.n) < 1e-9;
  });
  console.log('avgRed 与「按场次独立复算」一致:', redOk ? 'PASS' : 'FAIL');

  // ② 个人交手记录
  const withPair = players.filter((p) => p.pairMap && p.pairMap.size > 0).length;
  console.log('带个人交手记录的玩家:', withPair + ' / ' + players.length, withPair > 0 ? 'PASS' : 'FAIL');

  // ③ 克制建议应优先用个人交手口径
  const targetP = players.filter((p) => p.n >= 10 && p.pairMap && p.pairMap.size > 0)[0] || players[0];
  view.select(targetP.name);
  const advP = w.AC.allianceAnalysis.counterAdvice(view.result, targetP, { playerPairs: targetP.pairMap });
  const srcMix = {};
  advP.forEach((a) => (a.detail || []).forEach((d) => { srcMix[d.src] = (srcMix[d.src] || 0) + 1; }));
  const usedPersonal = Object.keys(srcMix).some((k) => k !== 'global');
  console.log('克制建议的口径分布:', JSON.stringify(srcMix), usedPersonal ? 'PASS' : '（该玩家的对局没有可融合的个人记录）');
  // 个人记录不得被全局先验抹掉：有个人记录时 detail 必须标出个人场次
  const pnOk = advP.every((a) => (a.detail || []).every((d) => d.src === 'global' || (d.pn > 0 && d.pn <= d.n)));
  console.log('个人场次标注合理（0 < pn <= 全局场次）:', pnOk ? 'PASS' : 'FAIL');

  // ④ 武将名搜索
  const kw = w.document.querySelector('.pf-input');
  const someHero = (targetP.compList[0].heroes[0] || {}).name;
  kw.value = someHero;
  kw.dispatchEvent(new w.Event('input'));
  const hitN = w.document.querySelectorAll('#playerList .ally-item').length;
  console.log('按武将名搜索「' + someHero + '」命中:', hitN > 0 ? 'PASS (' + hitN + ' 人)' : 'FAIL');
  kw.value = ''; kw.dispatchEvent(new w.Event('input'));

  // ⑤ 筛选后选中高亮不能丢
  w.document.querySelector('#playerList .ally-item').click();
  const selA = w.document.querySelectorAll('.pf-select')[0];
  if (selA.options.length > 1) {
    selA.value = selA.options[1].value;
    selA.dispatchEvent(new w.Event('change'));
    const remain = w.document.querySelectorAll('#playerList .ally-item').length;
    const activeN = w.document.querySelectorAll('#playerList .ally-item.active').length;
    console.log('筛选后选中高亮仍在:', (remain === 0 || activeN === 1) ? 'PASS' : 'FAIL (列表 ' + remain + ' 项 / 高亮 ' + activeN + ')');
    selA.value = selA.options[0].value;
    selA.dispatchEvent(new w.Event('change'));
  } else {
    console.log('筛选后选中高亮仍在: (本数据只有一个同盟，跳过)');
  }

  // ⑥ 战报浮层：仿游戏战报卡结构 + 包含被当前筛选排除的场次并打标
  const logBtn = w.document.querySelector('.pc-log');
  logBtn.click();
  const mask = w.document.querySelector('.bl-mask');
  const nCards = mask ? mask.querySelectorAll('.bl2-card').length : -1;
  const nHeroes = mask ? mask.querySelectorAll('.bl2-hero').length : -1;
  const nStamps = mask ? mask.querySelectorAll('.bl2-stamp').length : -1;
  const nBars = mask ? mask.querySelectorAll('.bl2-bar').length : -1;
  const sumTxt = mask ? ((mask.querySelector('.bl2-sum') || {}).textContent || '').trim() : '';
  const pagerTxt = mask ? (mask.querySelector('.bl-pager') || {}).textContent || '' : '';
  const tagN = mask ? mask.querySelectorAll('.bl-filtered-tag').length : -1;
  console.log('战报浮层打开:', mask ? 'PASS' : 'FAIL',
    '| 卡片', nCards, '| 武将卡', nHeroes, '| 印章', nStamps, '| 兵力条', nBars);
  console.log('结构完整（每场两排武将卡 + 印章 + 两条兵力条）:',
    nCards > 0 && nHeroes >= nCards * 2 && nStamps === nCards && nBars === nCards * 2 ? 'PASS' : 'FAIL');
  console.log('顶部统计横幅:', sumTxt || '(空)');
  console.log('场次统计:', pagerTxt.trim().slice(0, 60));
  console.log('被排除场次已打标:', tagN >= 0 ? 'PASS（本页 ' + tagN + ' 条标记）' : 'FAIL');
  const closeBtn = mask && mask.querySelector('.bl-close');
  if (closeBtn) closeBtn.click();

  // ⑦ 战报卡片：与游戏内一致 —— 每场一张卡、场号按发生顺序（第 1 场 = 最早）、列表从新到旧
  {
    const ACx = w.AC;
    const rr = ACx.app.state.result;
    const all = ACx.app.store.battles;
    const buckets = new Map();
    all.forEach((b) => {
      if (!b.ts) return;
      [['atk', b.atk], ['def', b.def]].forEach((pair) => {
        const role = pair[0], side = pair[1];
        if (!side || !side.player || !side.key) return;
        const k = side.player + '|' + side.key;
        if (!buckets.has(k)) buckets.set(k, { player: side.player, key: side.key, segs: [] });
        buckets.get(k).segs.push({ me: side, foe: role === 'atk' ? b.def : b.atk, ts: b.ts, place: b.place });
      });
    });
    let hit = null;
    buckets.forEach((v) => { if (!hit && v.segs.length >= 4) hit = v; });   // 挑一个有多场交战的玩家
    if (hit) {
      ACx.playerAnalysis.openBattleLog({
        result: rr, allBattles: all, playerName: hit.player,
        comp: { key: hit.key, display: hit.key, troopSig: '' }
      });
      const m = w.document.querySelector('.bl-mask');
      const cards = m ? Array.prototype.slice.call(m.querySelectorAll('.bl2-card')) : [];
      const seqs = cards.map((c) => {
        const t = (c.querySelector('.bl2-seq') || {}).textContent || '';
        const mm = t.match(/第 (\d+) 场/);
        return mm ? Number(mm[1]) : NaN;
      });
      const times = cards.map((c) => {
        const t = (c.querySelector('.bl2-time') || {}).textContent || '';
        return Date.parse(t.replace(/\//g, '-').replace(' ', 'T'));
      });
      // ① 每场一张卡：卡片数 == 该玩家该阵容的场次数（本页范围内），不再折叠隐藏
      const noFold = m ? m.querySelectorAll('.bl2-chain').length === 0 : false;
      console.log('战报每场一张卡（不折叠隐藏）:', noFold ? 'PASS' : 'FAIL',
        '| 卡片', cards.length, '| 该玩家场次', hit.segs.length);
      // ② 场号按发生顺序：列表第一个（最新）场号最大，最后一个（最早）是第 1 场
      const desc = times.every((v, i) => i === 0 || times[i - 1] >= v);
      const seqOrdered = seqs.length > 0 && seqs.every((s, i) => s === seqs.length - i);
      const firstIsOldest = seqs.length > 0 && seqs[seqs.length - 1] === 1;
      console.log('战报列表从新到旧:', desc ? 'PASS' : 'FAIL',
        '| 场号按发生顺序（第 1 场最早）:', seqOrdered && firstIsOldest ? 'PASS' : 'FAIL',
        '| 场号', seqs.join(','));
      if (!noFold || !desc || !seqOrdered || !firstIsOldest) process.exitCode = 1;
      const cb2 = m && m.querySelector('.bl-close');
      if (cb2) cb2.click();
    } else {
      console.log('战报每场一张卡: (本数据没有足够的交战样本)');
    }
  }

  // ⑧ 统计层已把续战合并为「一次完整战斗」（analyze 默认 mergeChains: true）
  {
    const ACx = w.AC;
    const rr = ACx.app.state.result;
    const s = rr.stats;
    const rawN = ACx.app.store.battles.length;
    const mergedOk = s.chainedMerged > 0 && s.totalInput < rawN && s.rawInput === rawN;
    const foot = (w.document.querySelector('#stageFoot') || {}).textContent || '';
    const footOk = foot.indexOf('打平续战合并') >= 0;
    const chained = rr.battles.filter((b) => b.chainSegs > 1);
    const fieldsOk = chained.every((b) => b.atk.origin != null && b.atk.remain != null &&
      b.result && typeof b.round === 'number');
    // 关掉合并重算一次：平局应当变多（中间段的 draw 被放回来了）
    const off = ACx.analyzer.analyze(ACx.app.store.battles, Object.assign({}, ACx.app.filters, { mergeChains: false }));
    const drawOn = rr.battles.filter((b) => b.result === 'draw').length;
    const drawOff = off.battles.filter((b) => b.result === 'draw').length;
    console.log('续战合并: ' + s.chainedMerged + ' 次 | 统计分母 ' + s.totalInput + '（原始 ' + rawN + ' 段）',
      mergedOk ? 'PASS' : 'FAIL');
    console.log('状态栏提示合并次数:', footOk ? 'PASS' : 'FAIL');
    console.log('合并体字段完整（开战/剩余兵力、胜负、回合）:', fieldsOk ? 'PASS' : 'FAIL',
      '| 含续战的对局', chained.length, '场');
    console.log('合并后平局减少（口径确实变了）:', drawOn < drawOff ? 'PASS' : 'FAIL',
      drawOff + ' -> ' + drawOn);
  }
}

// 强度排行口径：强度分 = 公平压制力 + 打斗广度
// 综合强度排行：五维分项 + 强度分降序 + 底部口径说明（用户要求「一眼看出这队强」）
{
  const d = w.document;
  const res = w.AC.app.state.result;
  const rows = Array.from(d.querySelectorAll('#rankWrap .rank-row'));
  const bodyRows = rows.slice(1);   // 第一行是表头
  const sorted = bodyRows.slice().sort((a, b) => b.__node.strength - a.__node.strength);
  console.log('[dbg-jsdom]', JSON.stringify({ totalKept: res.stats.totalKept, nodes: res.nodeList.length, best: bodyRows[0].__node.streakBest, sStreak: bodyRows[0].__node.sStreak, strength: bodyRows[0].__node.strength, bestAll: bodyRows[0].__node.streakBestAll }));
  console.log('强度排行：行数', bodyRows.length,
    '| 首行', bodyRows[0].__node.display,
    '综合 ' + bodyRows[0].__node.strength.toFixed(1),
    '（打击面 ' + bodyRows[0].__node.sSpan.toFixed(0) + ' 胜率 ' + bodyRows[0].__node.sWin.toFixed(0) +
    ' 连胜 ' + bodyRows[0].__node.sStreak.toFixed(0) + ' 战损 ' + bodyRows[0].__node.sLoss.toFixed(0) +
    ' 劣势 ' + bodyRows[0].__node.sDis.toFixed(0) + '）');

  // 表头写明综合口径
  const headTxt = rows[0].textContent;
  const headOk = headTxt.indexOf('强度分') >= 0 && headTxt.indexOf('打击面') >= 0 && headTxt.indexOf('连胜') >= 0;
  console.log('排行表头写明「强度分 + 五维」:', headOk ? 'PASS' : 'FAIL', '|', headTxt.replace(/\s+/g, ' ').trim().slice(0, 70));
  if (!headOk) process.exitCode = 1;

  // 每行五个分项条 + 数字，界面值必须与节点一致
  const PARTS = ['sSpan', 'sWin', 'sStreak', 'sLoss', 'sDis'];
  const partsOk = bodyRows.every((r) => {
    const nodes = Array.from(r.querySelectorAll('.rank-parts .rp'));
    if (nodes.length !== 5) return false;
    return nodes.every((el, i) => {
      const num = el.querySelector('.rp-num').textContent;
      const bar = el.querySelector('.rp-bar i');
      const expect = Math.round(Math.min(100, Math.max(0, r.__node[PARTS[i]] || 0)));
      return Number(num) === expect && bar && /width:\s*\d/.test(bar.getAttribute('style') || '');
    });
  });
  console.log('每行五维分项条（打击面/胜率/连胜/战损/劣势）与节点数据一致:', partsOk ? 'PASS' : 'FAIL');
  if (!partsOk) process.exitCode = 1;

  // 行内自带关键数字：赢过 N/M、最长 N 连、连赢率
  const rowSelfOk = bodyRows.every((r) => {
    const m = r.textContent.match(/最高 (\d+) 连/);
    const k = r.textContent.match(/3 连以上 (\d+) 次/);
    return /\d+\/\d+ 支/.test(r.textContent) && m && k &&
      Number(m[1]) === (r.__node.streakBest || 0) && Number(k[1]) === (r.__node.streakStrong || 0) &&
      /场 · \d+%/.test(r.textContent);
  });
  console.log('行内自带出场/胜率/赢过支数/最高连赢:', rowSelfOk ? 'PASS' : 'FAIL');
  if (!rowSelfOk) process.exitCode = 1;

  // 排序：按综合强度分降序
  const orderOk = bodyRows.every((r, i) => r === sorted[i]);
  console.log('排行按综合强度分降序:', orderOk ? 'PASS' : 'FAIL',
    bodyRows.length ? ('（' + bodyRows[0].__node.strength.toFixed(1) + ' -> ' +
      bodyRows[bodyRows.length - 1].__node.strength.toFixed(1) + '）') : '');
  if (!orderOk) process.exitCode = 1;

  // 行上不挂 title：划过就弹原生提示框会挡住整片排行
  const noTipOk = bodyRows.every((r) => !r.getAttribute('title'));
  console.log('排行行不弹悬浮提示框（无 title）:', noTipOk ? 'PASS' : 'FAIL');
  if (!noTipOk) process.exitCode = 1;

  // 底部口径说明必须存在（玩家看完排行会问「这分怎么来的」）
  const note = d.querySelector('#rankWrap .rank-note');
  const noteOk = !!note && note.textContent.indexOf('打击面') >= 0 && note.textContent.indexOf('连胜') >= 0 &&
    note.textContent.indexOf('32%') >= 0;
  console.log('排行底部给出强度分口径（含权重）:', noteOk ? 'PASS' : 'FAIL');
  if (!noteOk) process.exitCode = 1;

  // 详情面板：五维拆解 + 连胜口径 + 战损/劣势
  bodyRows[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const inspTxt = d.querySelector('#inspector').textContent;
  const inspOk = inspTxt.indexOf('强度分拆解') >= 0 && inspTxt.indexOf('打击面') >= 0 &&
    inspTxt.indexOf('最高连赢') >= 0 && inspTxt.indexOf('战损') >= 0 && inspTxt.indexOf('劣势') >= 0 &&
    inspTxt.indexOf('以少打多') >= 0;
  console.log('详情面板显示五维拆解 / 连胜 / 战损 / 劣势:', inspOk ? 'PASS' : 'FAIL');
  if (!inspOk) process.exitCode = 1;

  // 连赢证据：排行里的「最高 N 连」可点开战报；详情页有按钮 + 段落列表
  const streakLinks = d.querySelectorAll('#rankWrap .rank-streak-link').length;
  const evBtn = d.querySelector('#inspector .streak-evidence button');
  const runRows = d.querySelectorAll('#inspector .streak-run-row').length;
  console.log('连赢证据入口：排行可点链接', streakLinks, '个 | 详情按钮', evBtn ? 'PASS' : 'FAIL', '| 段落行', runRows);
  if (!streakLinks && !evBtn) process.exitCode = 1;
  // 点开战报浮层（会复用玩家分析的浮层）
  if (evBtn) {
    evBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 200));
    const panel = d.querySelector('.bl-panel');
    const note = panel ? (panel.querySelector('.bl-note') || {}).textContent || '' : '';
    const cards = panel ? panel.querySelectorAll('.bl2-card').length : 0;
    const ok = !!panel && cards > 0 && note.indexOf('连赢') >= 0;
    console.log('点「查看连赢战报」弹出战报浮层:', ok ? 'PASS' : 'FAIL',
      '| 卡片', cards, '| 说明', note.slice(0, 40));
    if (!ok) process.exitCode = 1;
    const closeBtn = panel && panel.querySelector('.bl-close');
    if (closeBtn) closeBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  }

  // 阵型站位：武将按「从左到右」填充（跨前后排、不看兵种），依赖格子的列/排标记
  const recBtn = Array.from(d.querySelectorAll('#inspector button')).find((b) => /推荐配置/.test(b.textContent));
  if (recBtn) {
    recBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 350));
    const slots = Array.from(d.querySelectorAll('.fm-slot'));
    const withAttrs = slots.filter((x) => x.getAttribute('data-c') && x.getAttribute('data-r'));
    const boards = d.querySelectorAll('.fm-board').length;
    const ok = slots.length === 0 || withAttrs.length === slots.length;
    console.log('阵型站位格子（' + boards + ' 块板 / ' + slots.length + ' 格）带列排标记:', ok ? 'PASS' : 'FAIL');
    if (!ok) process.exitCode = 1;
    // 每块板里的第一个武将必须是「最左列」那个格子
    const filledBoards = Array.from(d.querySelectorAll('.fm-board')).map((bd) =>
      Array.from(bd.querySelectorAll('.fm-slot.filled')).map((x) => ({
        c: Number(x.getAttribute('data-c')), hero: ((x.querySelector('.hc-hero-name') || {}).textContent || '').trim()
      })).filter((x) => x.hero));
    const firstLeftmost = filledBoards.filter((cells) => cells.length).every((cells) => {
      const minC = Math.min.apply(null, cells.map((x) => x.c));
      const domFirst = cells[0];
      return domFirst.c === minC;
    });
    console.log('每块阵型板的首个武将都在最左列:', firstLeftmost ? 'PASS' : 'FAIL');
    if (!firstLeftmost) process.exitCode = 1;
    const closeBtn = d.querySelector('.bl-close');
    if (closeBtn) closeBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  }

  // analyzer 的口径函数必须和节点字段一致（graph.js 的 3D 高度也读它）
  const offOk = res.nodeList.every((n) => w.AC.analyzer.strengthOf(n) === n.strength);
  console.log('analyzer.strengthOf 与节点强度分一致（3D 高度同源）:', offOk ? 'PASS' : 'FAIL');
  if (!offOk) process.exitCode = 1;
}

// 图例：挤在标签栏右侧，太长的文案会被裁掉——只留短标签，完整口径放 title
{
  const d = w.document;
  const legend = d.querySelector('#legend');
  const legendText = legend ? legend.textContent.replace(/\s+/g, ' ').trim() : '(缺失)';
  const legendShortOk = legendText.indexOf('3D 高度 = 强度分') >= 0 && legendText.indexOf('打斗广度') < 0;
  console.log('图例用短标签（完整口径在悬浮）:', legendShortOk ? 'PASS' : 'FAIL', '|', legendText);
  if (!legendShortOk) process.exitCode = 1;

  // 标签栏放不下时的降级必须写在 CSS 里：标签横向滚动、图例次要项逐级收起、窄屏整体隐藏。
  // jsdom 不做布局，这里直接盯 CSS 规则，避免以后又改回「被 overflow:hidden 硬裁」。
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const scrollOk = /\.view-tabs\s*\{[^}]*overflow-x:\s*auto/.test(css);
  const hideExtraOk = /@media[^{]*\{[^@]*\.legend \.legend-extra\s*\{\s*display:\s*none/.test(css);
  const hideAllOk = /@media[^{]*\{[^@]*\.legend\s*\{\s*display:\s*none/.test(css);
  console.log('窄屏降级规则（标签横滚 / 图例次要项收起 / 图例整体隐藏）:',
    scrollOk ? 'PASS' : 'FAIL', hideExtraOk ? 'PASS' : 'FAIL', hideAllOk ? 'PASS' : 'FAIL');
  if (!scrollOk || !hideExtraOk || !hideAllOk) process.exitCode = 1;

  // 排行 7 列要能在 1366 这类窄屏里放得下：列宽之和 + 间距 + 内边距 + 滚动条 <= 1366 - 左侧栏(300)
  const grid = (css.match(/\.rank-row\s*\{[^}]*grid-template-columns:([^;]+);/) || [])[1] || '';
  const nums = (grid.match(/(\d+)px/g) || []).map((s) => parseInt(s, 10));
  const minSum = nums.reduce((a, b) => a + b, 0);
  const gapMatch = css.match(/\.rank-row\s*\{[^}]*gap:\s*(\d+)px/) || [];
  const gap = Number(gapMatch[1] || 0);
  const est = minSum + gap * 6 + 20 /* padding */ + 8 /* 滚动条 */;
  const widthOk = nums.length >= 7 && est <= 1066;
  console.log('排行列宽在 1366 窄屏下不溢出:', widthOk ? 'PASS' : 'FAIL',
    '| 最小列宽合计 ' + minSum + 'px + 间距/内边距 ≈ ' + est + 'px（可用 ≈ 1066px）');
  if (!widthOk) process.exitCode = 1;
}

// 版本号一致性：version.json 是唯一配置源，靠 tools/bump-version.mjs 同步到三处；
// 任何一处漏同步都会让页面显示旧版本或拿到旧缓存，这里全部盯住
{
  const ver = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const pageBuild = w.AC.app.build;
  const ok = pageBuild === ver.version;
  console.log('页面版本来自 version.json:', ok ? 'PASS' : 'FAIL', pageBuild, 'vs', ver.version);
  const tag = (w.document.getElementById('buildTag') || {}).textContent || '';
  console.log('页面标题版本标签:', tag, tag === 'v' + ver.version ? 'PASS' : 'FAIL');

  // js/version.js 是由 version.json 生成的，内容必须一致
  const vjs = JSON.parse(fs.readFileSync(path.join(root, 'js/version.js'), 'utf8')
    .split('window.AC.VERSION = ')[1].replace(/;\s*$/, ''));
  console.log('js/version.js 与 version.json 一致:', vjs.version === ver.version ? 'PASS' : 'FAIL',
    vjs.version, 'vs', ver.version);

  // index.html 里所有 ?v= 缓存参数必须统一为当前版本（漏了就会拿旧 JS/CSS）
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const vs = Array.from(new Set((html.match(/\?v=[^"']+/g) || []).map((s) => s.slice(3))));
  const vsOk = vs.length === 1 && vs[0] === ver.version;
  console.log('index.html 缓存参数统一:', vsOk ? 'PASS' : 'FAIL', vs.join(' / '), 'vs', ver.version);
  console.log('index.html 引用了 version.js:', html.indexOf('js/version.js') >= 0 ? 'PASS' : 'FAIL');
  if (!ok || !vsOk || vjs.version !== ver.version) process.exitCode = 1;
}

// 启动加载提示：数据就绪后必须撤下（否则会挡住整个页面），且注册函数必须存在
{
  const hasFn = typeof w.__bootReady === 'function';
  const gone = !w.document.getElementById('bootLoading');
  console.log('启动加载提示: 注册函数', hasFn ? 'PASS' : 'FAIL', '| 数据就绪后已撤下:', gone ? 'PASS' : 'FAIL');
  // 内联提示必须零依赖（不能引用外部 css/js），否则慢加载时根本出不来
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const blk = (html.match(/<div id="bootLoading"[^>]*>/) || [''])[0];
  const inline = /style="/.test(blk) && html.indexOf('id="bootTime"') >= 0;
  console.log('启动提示零依赖（内联样式 + 计时）:', inline ? 'PASS' : 'FAIL');
  if (!hasFn || !gone || !inline) process.exitCode = 1;
}

console.log('\n=== JS 错误 ===');
if (!problems.length) console.log('(无)');
else problems.slice(0, 25).forEach((p) => console.log(' - ' + p));

const bad = problems.filter((p) => /jsdomError|console.error/.test(p));
console.log('\n结论:', bad.length ? 'FAIL' : 'PASS');

w.close();
server.close();
process.exit(bad.length ? 1 : 0);
