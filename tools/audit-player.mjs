// 玩家分析逻辑审查 / 回归验证脚本（离线复算，不需要浏览器）
// 用法：node tools/audit-player.mjs [项目根目录]
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

['js/util.js', 'js/csv.js', 'js/model.js', 'js/analyzer.js', 'js/alliance.js', 'js/player.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
});
const AC = sandbox.window.AC;

let fails = 0;
function check(name, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual}${ok ? '' : '  (期望 ' + expected + ')'}`);
}

let idc = 0;
function side(player, alliance, units, reds) {
  const heroes = units.map((u, i) => ({
    name: u, level: 45, troop: '骑兵', red: reds[i], pin: 1,
    skills: ['x'], skillPins: [1], books: [],
    equip: '', equipSkill: '', equipEffect: '', horse: '', horseSkill: '', horseEffect: ''
  }));
  const redAvg = reds.reduce((a, b) => a + b, 0) / reds.length;
  return {
    alliance, player, formation: '箕形阵',
    compRaw: units.join(' / '), comp: units.join(' / '),
    key: AC.model.compKey(units), units, levels: [45, 45, 45], minLevel: 45, size: 3,
    wuxun: 100, remain: 20000, origin: 30000, wounded: 5000, dead: 5000, lossRate: 0.33,
    heroes, troopSig: '枪骑盾', redAvg, pinAvg: 1
  };
}
function battle(atk, def, result, ts) {
  return {
    id: String(++idc), batchId: 'b', place: 'P', time: '', ts: ts || Date.now(),
    result, resultText: '', round: 8, parent: '', detailed: true, atk, def
  };
}

const X = ['关羽', '张飞', '刘备'];
const Y = ['周瑜', '陆逊', '吕蒙'];
const Z = ['关羽', '黄忠', '赵云'];

/* ========== 场景一：克制建议用「他本人」的交手记录 ========== */
{
  console.log('\n=== 场景一：克制建议的口径（个人 vs 全局）===');
  const bs = [];
  // 甲(守, X) 打 乙(攻, Y)：10 场，甲全败
  for (let i = 0; i < 10; i++) bs.push(battle(side('乙', '同盟乙', Y, [1, 1, 1]), side('甲', '同盟甲', X, [5, 0, 0]), 'atk'));
  // 丙(攻, X) 打 丁(守, Y)：20 场，X 全胜（与甲无关的全局样本）
  for (let i = 0; i < 20; i++) bs.push(battle(side('丙', '同盟丙', X, [1, 1, 1]), side('丁', '同盟丁', Y, [1, 1, 1]), 'atk'));

  const res = AC.analyzer.analyze(bs, { minPair: 1, minAppear: 1 });
  const data = AC.playerAnalysis.build(res, bs);
  const jia = data.players.find((p) => p.name === '甲');

  // 个人交手记录
  const rec = jia.pairMap.get(AC.analyzer.pairKeyOf(AC.model.compKey(X), AC.model.compKey(Y)));
  check('甲的个人交手记录（用 X 打 Y）', rec && `${rec.n}场 ${rec.win}胜${rec.loss}负`, '10场 0胜10负');

  // 玩家页口径：传 playerPairs
  const adviceMe = AC.allianceAnalysis.counterAdvice(res, jia, { playerPairs: jia.pairMap });
  const topMe = adviceMe[0];
  console.log(`  玩家页推荐 ${topMe.display}: 期望胜率 ${(topMe.expRate * 100).toFixed(1)}% ` +
    `明细=${topMe.detail.map((d) => `${d.comp} src=${d.src} pn=${d.pn} n=${d.n} rate=${(d.rate * 100).toFixed(0)}%`).join(' | ')}`);
  check('个人口径下 Y 打甲的 X 期望胜率 > 50%', topMe.expRate > 0.5, 'true');

  // 同盟页口径：不传 playerPairs（回归：行为与旧版一致）
  const adviceAll = AC.allianceAnalysis.counterAdvice(res, jia, {});
  const topAll = adviceAll[0];
  console.log(`  同盟页口径（不传 playerPairs）推荐 ${topAll.display}: 期望胜率 ${(topAll.expRate * 100).toFixed(1)}%`);
  check('不传 playerPairs 时仍走全局口径', topAll.detail[0].src === 'global', 'true');
  check('全局口径未受改动影响（约 36%）', Math.abs(topAll.expRate - 0.362) < 0.01, 'true');
}

/* ========== 场景二：平均红度按场次计算，不跨阵容重复累加武将 ========== */
{
  console.log('\n=== 场景二：平均红度口径 ===');
  const bs = [];
  // 甲：3 场用 X（关羽5/张飞0/刘备0），1 场用 Z（全 0）
  for (let i = 0; i < 3; i++) bs.push(battle(side('甲', '同盟甲', X, [5, 0, 0]), side('乙', '同盟乙', Y, [1, 1, 1]), 'def'));
  bs.push(battle(side('甲', '同盟甲', Z, [0, 0, 0]), side('乙', '同盟乙', Y, [1, 1, 1]), 'def'));

  const res = AC.analyzer.analyze(bs, { minPair: 1, minAppear: 1 });
  const data = AC.playerAnalysis.build(res, bs);
  const jia = data.players.find((p) => p.name === '甲');
  // 独立复算：每场取该部队的均红再平均
  let s = 0, n = 0;
  bs.forEach((b) => [b.atk, b.def].forEach((sd) => {
    if (sd.player !== '甲') return; s += sd.redAvg; n++;
  }));
  const expect = s / n;
  console.log(`  每场均红：${(5 / 3).toFixed(3)} × 3 场 + 0 × 1 场 -> 期望 ${(expect).toFixed(3)}`);
  console.log(`  旧口径（武将跨阵容累加）会得到 ${(5 / 6).toFixed(3)}`);
  check('avgRed 按场次平均', jia.avgRed.toFixed(3), expect.toFixed(3));
}

/* ========== 场景三：武将快照（均值 + 最近一场 + 兵种众数） ========== */
{
  console.log('\n=== 场景三：武将配置快照 ===');
  const base = Date.parse('2026-10-01T12:00:00');
  const bs = [];
  // 甲连打 3 场，关羽红度从 1 涨到 3，兵种从骑兵换枪兵
  [[1, '骑兵'], [2, '骑兵'], [3, '枪兵']].forEach(([red, troop], i) => {
    const heroes = X.map((u, k) => ({ name: u, level: 40 + i, troop: u === '关羽' ? troop : '骑兵', red: u === '关羽' ? red : 0, pin: 1 }));
    const atk = side('乙', '同盟乙', Y, [1, 1, 1]);
    atk.heroes = Y.map((u) => ({ name: u, level: 40, troop: '骑兵', red: 1, pin: 1 }));
    const def = Object.assign(side('甲', '同盟甲', X, [0, 0, 0]), { heroes });
    bs.push(battle(atk, def, 'def', base + i * 86400000));
  });
  const res = AC.analyzer.analyze(bs, { minPair: 1, minAppear: 1 });
  const data = AC.playerAnalysis.build(res, bs);
  const jia = data.players.find((p) => p.name === '甲');
  const guan = jia.compList[0].heroes.find((h) => h.name === '关羽');
  console.log(`  关羽: 均红 ${guan.red.toFixed(2)} / 最高 ${guan.redMax} / 最近一场红 ${guan.last && guan.last.red} / 兵种 ${guan.troop}`);
  check('关羽均红（1/2/3 的均值）', guan.red.toFixed(2), '2.00');
  check('关羽最高红度', guan.redMax, 3);
  check('最近一场红度（不受历史低值拉平）', guan.last && guan.last.red, 3);
  check('兵种取众数', guan.troop, '骑兵');
}

/* ========== 场景四：性能（预扫描代替每玩家全量扫描） ========== */
{
  console.log('\n=== 场景四：build 性能 ===');
  const names = Array.from({ length: 300 }, (_, i) => '玩家' + i);
  const comps = [
    ['关羽', '张飞', '刘备'], ['周瑜', '陆逊', '吕蒙'], ['诸葛亮', '黄月英', '庞统'],
    ['曹操', '郭嘉', '荀彧'], ['吕布', '貂蝉', '陈宫'], ['孙权', '陆抗', '步练师']
  ];
  const mk = (playerCount, battleCount) => {
    const ns = Array.from({ length: playerCount }, (_, i) => '玩家' + i);
    const bs = [];
    for (let i = 0; i < battleCount; i++) {
      const a = comps[i % comps.length], d = comps[(i + 3) % comps.length];
      bs.push(battle(side(ns[i % ns.length], '同盟A', a, [2, 2, 2]), side(ns[(i + 7) % ns.length], '同盟B', d, [2, 2, 2]), i % 2 ? 'atk' : 'def'));
    }
    return bs;
  };
  for (const [pc, bc] of [[300, 3000], [1000, 10000]]) {
    const bs = mk(pc, bc);
    const res = AC.analyzer.analyze(bs, { minPair: 1, minAppear: 1 });
    const t0 = process.hrtime.bigint();
    AC.playerAnalysis.build(res, bs);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`  ${pc} 玩家 / ${bc} 场 -> build 耗时 ${ms.toFixed(1)} ms`);
    check(`${pc}玩家/${bc}场 build < 1500ms`, ms < 1500, 'true');
  }
}

console.log(fails ? `\n>>> ${fails} 项未通过` : '\n>>> 全部通过');
process.exit(fails ? 1 : 0);
