// 生成内置示例数据 js/sample-data.js（把 CSV 内嵌为 JS 字符串，保证 file:// 双击可用）
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const out = process.argv[3];
const text = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');

const banner = `/* 内置示例战报表（自动生成，勿手改）
   来源：${path.basename(src)}
   用途：file:// 直接打开时无法 fetch 本地文件，因此内嵌一份示例数据
   生成命令：node tools/make-sample.mjs <csv> js/sample-data.js */
window.AC = window.AC || {};
window.AC.sampleCsv = `;

fs.writeFileSync(out, banner + JSON.stringify(text) + ';\n', 'utf8');
console.log('written', out, (fs.statSync(out).size / 1024).toFixed(1) + 'KB');
