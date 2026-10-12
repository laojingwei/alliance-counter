/* 版本同步脚本：让 version.json 成为唯一配置源
   ------------------------------------------------------------
   用法：
     node tools/bump-version.mjs                # 只同步（改完 version.json 后跑）
     node tools/bump-version.mjs 202610122200a  # 改版本号 + 同步（发布日期一并更新）

   会同步三处（这三处以前靠手工改，漏一处就会出现「版本号没更新」或「拿到旧缓存」）：
     1) version.json        —— 版本号、发布日期（仅在给了新版本号时写回）
     2) js/version.js       —— 页面读取的配置（由 version.json 生成，勿手改）
     3) index.html          —— 所有 ?v=xxx 缓存参数统一刷成新版本号
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verPath = path.join(root, 'version.json');
const htmlPath = path.join(root, 'index.html');
const vjsPath = path.join(root, 'js/version.js');

const newVer = process.argv[2] || null;
const ver = JSON.parse(fs.readFileSync(verPath, 'utf8'));

if (newVer && newVer !== ver.version) {
  if (!/^\d{10,}[a-z]?$/i.test(newVer)) {
    console.error('版本号格式不符（示例：202610122200a）：' + newVer);
    process.exit(1);
  }
  ver.version = newVer;
  ver.releasedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(verPath, JSON.stringify(ver, null, 2) + '\n', 'utf8');
  console.log('version.json  -> 版本改为 ' + newVer + '，发布日期 ' + ver.releasedAt);
}

const v = ver.version;

// 1) 页面读取的配置（<script src> 方式加载：file:// 下不受 CORS 限制，双击 index.html 也能用）
const vjs = [
  '/* 由 tools/bump-version.mjs 从 version.json 生成 —— 勿手改；',
  '   改完 version.json 后跑 `node tools/bump-version.mjs` 重新生成。 */',
  'window.AC = window.AC || {};',
  'window.AC.VERSION = ' + JSON.stringify({
    version: ver.version, releasedAt: ver.releasedAt, name: ver.name
  }, null, 2) + ';',
  ''
].join('\n');
fs.writeFileSync(vjsPath, vjs, 'utf8');
console.log('js/version.js -> 已生成（' + v + '）');

// 2) index.html 所有缓存参数
let html = fs.readFileSync(htmlPath, 'utf8');
const hits = (html.match(/\?v=[^"']+/g) || []).length;
html = html.replace(/\?v=[^"']+/g, '?v=' + v);
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('index.html    -> ' + hits + ' 处 ?v= 统一为 ' + v);

// 3) 自检
if (html.indexOf('js/version.js') < 0) {
  console.error('错误：index.html 里没有 <script src="js/version.js"> 引用，页面拿不到版本号。');
  process.exit(1);
}
const left = new Set((html.match(/\?v=[^"']+/g) || []).map((s) => s.slice(3)));
if (left.size !== 1 || !left.has(v)) {
  console.error('错误：index.html 缓存参数未完全同步：' + [...left].join(', '));
  process.exit(1);
}
console.log('自检通过：三处版本号一致 = ' + v);
