/**
 * 本地预览服务器（零依赖）
 *   node tools/serve.mjs            # 默认 http://localhost:5173
 *   node tools/serve.mjs 8080       # 指定端口
 *
 * 用于电脑上预览，以及让同一 WiFi 下的手机访问。
 * 手机访问时用电脑的局域网 IP，例如 http://192.168.1.5:5173
 * 注意：Service Worker 在非 https 下只在 localhost 生效，手机用局域网 IP 打开时无离线缓存。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = parseInt(process.argv[2], 10) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = join(ROOT, normalize(pathname).replace(/^([/\\])+/, ''));
    if (!target.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    let info;
    try { info = await stat(target); } catch { res.writeHead(404).end('Not Found'); return; }
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end('Server Error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  console.log('\n物理刷题 · 本地预览已启动');
  console.log('  电脑访问：http://localhost:' + PORT);
  ips.forEach(ip => console.log('  手机访问：http://' + ip + ':' + PORT + '   （需与电脑同一 WiFi）'));
  console.log('\n按 Ctrl+C 停止\n');
});
