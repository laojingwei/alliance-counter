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
  const secs = ['各队伍的武将红度', '如何克制他', '针对他每套队伍的单点克制', '结论'];
  const miss = secs.filter((t) => txt.indexOf(t) < 0);
  console.log('玩家列表项:', items, '| 详情区块齐全:', miss.length === 0 ? 'PASS' : 'FAIL 缺少 ' + miss.join('/'));

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

  // ⑦ 「打平续战」的多段战报折叠为一次完整战斗（兵力首尾衔接识别）
  {
    const ACx = w.AC;
    const rr = ACx.app.state.result;
    // 明细仍保留原始段（战报浮层负责折叠），统计口径则已在 analyze 里合并
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
    let hit = null, multiChains = 0;
    buckets.forEach((v) => {
      if (hit) return;
      const cs = ACx.playerAnalysis.groupChains(v.segs);
      if (cs.some((c) => c.length > 1)) { hit = v; multiChains = cs.filter((c) => c.length > 1).length; }
    });
    if (hit) {
      ACx.playerAnalysis.openBattleLog({
        result: rr, allBattles: all, playerName: hit.player,
        comp: { key: hit.key, display: hit.key, troopSig: '' }
      });
      const m = w.document.querySelector('.bl-mask');
      const nChain = m ? m.querySelectorAll('.bl2-chain').length : 0;
      const moreEls = m ? Array.prototype.slice.call(m.querySelectorAll('.bl2-chain-more')) : [];
      const collapsed = moreEls.length > 0 && moreEls.every((e) => e.hidden);
      console.log('续战折叠: 折叠组', nChain, '个（该玩家有', multiChains, '条链）| 默认收起:', collapsed ? 'PASS' : 'FAIL');
      const t = m && m.querySelector('.bl2-chain-toggle');
      if (t) t.click();
      const opened = moreEls.length > 0 && !moreEls[0].hidden;
      const restCards = m ? m.querySelectorAll('.bl2-chain-more .bl2-card').length : 0;
      console.log('展开后显示其余段:', opened && restCards > 0 ? 'PASS' : 'FAIL', '| 其余段卡片', restCards);
      // 展开区须由新到旧（与列表一致），段号仍按发生顺序
      if (m) {
        const ts = Array.prototype.slice.call(m.querySelectorAll('.bl2-chain-more .bl2-time'))
          .map((e) => Date.parse(e.textContent.replace(/\//g, '-').replace(' ', 'T')));
        const desc = ts.length < 2 || ts.every((v, i) => i === 0 || ts[i - 1] >= v);
        const labels = Array.prototype.slice.call(m.querySelectorAll('.bl2-chain-more .bl2-seq'))
          .map((e) => e.textContent);
        const seqOk = labels.every((s, i) => s === '第 ' + (labels.length - i) + ' 段');
        console.log('展开区由新到旧:', desc ? 'PASS' : 'FAIL', '| 段号按发生顺序:', seqOk ? 'PASS' : 'FAIL',
          '|', labels.join(' , '));
      }
      const cb2 = m && m.querySelector('.bl-close');
      if (cb2) cb2.click();
    } else {
      console.log('续战折叠: (本数据没有续战链)');
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

console.log('\n=== JS 错误 ===');
if (!problems.length) console.log('(无)');
else problems.slice(0, 25).forEach((p) => console.log(' - ' + p));

const bad = problems.filter((p) => /jsdomError|console.error/.test(p));
console.log('\n结论:', bad.length ? 'FAIL' : 'PASS');

w.close();
server.close();
process.exit(bad.length ? 1 : 0);
