/* 验证明细表解析与聚合 */
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

const text = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
const t0 = Date.now();
const parsed = AC.detail.parse(text);
const ms = Date.now() - t0;

console.log('明细格式识别:', parsed ? 'PASS' : 'FAIL');
if (!parsed) process.exit(1);
console.log('数据行:', parsed.rows.length, '| 解析+聚合耗时:', ms + 'ms');

const battles = parsed.battles;
console.log('战斗数:', battles.length);
console.log('摘要:', JSON.stringify(parsed.summary));

const b = battles.find((x) => x.atk.size === 3 && x.def.size === 3 && x.result === 'atk');
console.log('\n=== 抽样一场 3v3（攻方胜）===');
console.log('ID:', b.id, '| 时间:', b.time, '| 地点:', b.place, '| 结果:', b.result, '| 回合:', b.round, '| 父战报:', b.parent || '(无)');
console.log('攻:', b.atk.player, '/', b.atk.alliance, '/', b.atk.formation, '/', b.atk.compRaw);
console.log('   等级', b.atk.levels.join('/'), '| 原始', b.atk.origin, '伤', b.atk.wounded, '亡', b.atk.dead,
  '| 损失率', (b.atk.lossRate * 100).toFixed(1) + '%', '| 势力', b.atk.power, '职业', b.atk.career, '出身州', b.atk.hometown, '士气', b.atk.morale);
b.atk.heroes.forEach((h) => {
  console.log('   · ' + h.name + ' Lv' + h.level + ' 红' + h.red + ' 觉' + h.awaken + ' 兵种' + h.troop +
    ' | 技能 ' + h.skills.join(' / ') + ' | 兵书 ' + h.books.join(' / ') + ' | 装备 ' + h.equip + ' | 战马 ' + h.horse);
});
console.log('守:', b.def.player, '/', b.def.alliance, '/', b.def.formation, '/', b.def.compRaw);

let bad = 0;
battles.forEach((x) => {
  [x.atk, x.def].forEach((side) => {
    const sumOrigin = side.heroes.reduce((a, h) => a + (h.origin || 0), 0);
    if (side.origin !== sumOrigin) bad++;
  });
});
console.log('\n兵力自洽性（部队原始兵力 == 武将之和）:', bad === 0 ? 'PASS' : 'FAIL ' + bad + ' 处');

const keys = new Set();
battles.forEach((x) => { keys.add(x.atk.key); keys.add(x.def.key); });
console.log('归并后阵容数:', keys.size);

const r = { atk: 0, def: 0, draw: 0, unknown: 0 };
battles.forEach((x) => { r[x.result]++; });
console.log('结果分布:', JSON.stringify(r));

const full = battles.filter((x) => x.atk.size === 3 && x.def.size === 3).length;
console.log('双方满编 3v3:', full, '场 (' + ((full / battles.length) * 100).toFixed(0) + '%)');

const withHeroes = battles.filter((x) => x.atk.heroes.length > 0).length;
console.log('带武将明细的战斗:', withHeroes, '/', battles.length);

const json = JSON.stringify(battles);
console.log('\n战斗级记录 JSON 体积: ' + (json.length / 1024).toFixed(0) + ' KB');
