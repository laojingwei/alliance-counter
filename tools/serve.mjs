/* 本地静态服务器（可选）
   双击 index.html 已经能正常使用；这个脚本只是给需要 http:// 环境的场景备选。

   用法：node tools/serve.mjs [端口]
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8123;

const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.csv': 'text/csv;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;

  let file;
  try {
    file = path.join(root, decodeURIComponent(rel));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain;charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }

  // 只允许访问 root 内部：用相对路径判断，避免 "alliance-counter-evil" 这类同前缀兄弟目录被放行
  const inside = path.relative(root, file);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    res.writeHead(403, { 'Content-Type': 'text/plain;charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' }); res.end('404 Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => {
  console.log('服务已启动：http://127.0.0.1:' + port + '/');
  console.log('（按 Ctrl+C 停止）');
});
