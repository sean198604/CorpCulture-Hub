'use strict';

// ============================================================
// 活动图片上传后端（零依赖 Node HTTP 服务）
// - POST   /api/upload                  body: {activityId, name, data(base64)}
// - DELETE /api/upload                  body: {activityId, name}
// - GET    /api/activities/:id/images   列举某活动的图片
// 图片按 activityId 归档到 /data/uploads/<activityId>/
// 实际图片由 nginx 通过 alias /data/uploads 直接托管
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = process.env.UPLOAD_DIR || '/data/uploads';
const PORT = 3000;
const MAX_SIZE = 15 * 1024 * 1024; // 单张 15MB

// WebP 压缩参数：质量 82，最长边限制 2000px（仅缩小不放大），去除元数据
const WEBP_QUALITY = 82;
const WEBP_MAX_EDGE = 2000;

function genName(ext) {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + ext;
}

function safeId(id) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id || '') ? id : null;
}
function safeName(name) {
  if (!name) return null;
  let base = String(name).replace(/^.*[\\/]/, ''); // 去路径
  base = base.replace(/[^A-Za-z0-9._\u4e00-\u9fa5-]/g, '_'); // 去非法字符
  const ext = path.extname(base).toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
  if (allowed.indexOf(ext) === -1) return null;
  return base.slice(0, 120);
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_SIZE) { cb(new Error('payload too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => { try { cb(null, Buffer.concat(chunks).toString('utf8')); } catch (e) { cb(e); } });
  req.on('error', (e) => cb(e));
}

// ---- 共享业务数据（活动/节假日/可见性）----
// 存放在上传持久卷内，容器重建不丢失
const DATA_DIR = path.join(ROOT, '_meta');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function readData(cb) {
  fs.readFile(DATA_FILE, 'utf8', (e, txt) => {
    if (e) { cb(null); return; }
    try { cb(JSON.parse(txt)); } catch (err) { cb(null); }
  });
}
function writeData(obj, cb) {
  fs.mkdir(DATA_DIR, { recursive: true }, (e) => {
    if (e) { cb(e); return; }
    const tmp = DATA_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(obj), (e2) => {
      if (e2) { cb(e2); return; }
      fs.rename(tmp, DATA_FILE, cb); // 原子替换，避免写一半被读到
    });
  });
}

const server = http.createServer((req, res) => {
  // ---- 共享数据：读取 ----
  if (req.method === 'GET' && req.url === '/api/data') {
    readData((data) => {
      if (!data) { send(res, 200, { exists: false, data: null }); return; }
      send(res, 200, { exists: true, data: data });
    });
    return;
  }

  // ---- 共享数据：保存 ----
  if (req.method === 'PUT' && req.url === '/api/data') {
    readBody(req, (err, body) => {
      if (err) { send(res, 400, { error: err.message }); return; }
      let p;
      try { p = JSON.parse(body); } catch (e) { send(res, 400, { error: 'invalid json' }); return; }
      if (!p || typeof p !== 'object' || !Array.isArray(p.projects)) {
        send(res, 400, { error: 'projects array required' });
        return;
      }
      const data = {
        projects: p.projects,
        holidays: Array.isArray(p.holidays) ? p.holidays : [],
        visibility: (p.visibility && typeof p.visibility === 'object') ? p.visibility : {},
        updatedAt: Date.now(),
      };
      writeData(data, (e) => {
        if (e) { send(res, 500, { error: 'write failed' }); return; }
        send(res, 200, { ok: true, updatedAt: data.updatedAt });
      });
    });
    return;
  }

  // ---- 上传 ----
  if (req.method === 'POST' && req.url === '/api/upload') {
    readBody(req, (err, body) => {
      if (err) { send(res, 400, { error: err.message }); return; }
      let p;
      try { p = JSON.parse(body); } catch (e) { send(res, 400, { error: 'invalid json' }); return; }
      const id = safeId(p.activityId);
      const name = safeName(p.name);
      if (!id || !name) { send(res, 400, { error: 'invalid activityId or name' }); return; }
      const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(p.data || '');
      if (!m) { send(res, 400, { error: 'data must be base64 image' }); return; }
      let buf;
      try { buf = Buffer.from(m[1], 'base64'); } catch (e) { send(res, 400, { error: 'bad base64' }); return; }
      if (buf.length > MAX_SIZE) { send(res, 400, { error: 'image too large' }); return; }
      const dir = path.join(ROOT, id);
      fs.mkdir(dir, { recursive: true }, (e) => {
        if (e) { send(res, 500, { error: 'mkdir failed' }); return; }
        const ext = path.extname(name).toLowerCase();
        const isSvg = ext === '.svg';
        // SVG 为矢量图，体积已很小，直接保存原文件
        if (isSvg) {
          const svgName = genName('.svg');
          fs.writeFile(path.join(dir, svgName), buf, (e2) => {
            if (e2) { send(res, 500, { error: 'write failed' }); return; }
            send(res, 200, { url: '/uploads/' + id + '/' + svgName, name: svgName });
          });
          return;
        }
        // 其余位图：写入临时原图，再用 ImageMagick 转 WebP（缩边 + 去元数据）
        const tmpName = genName(ext);
        const tmpFile = path.join(dir, tmpName);
        const webpName = genName('.webp');
        const outFile = path.join(dir, webpName);
        fs.writeFile(tmpFile, buf, (e2) => {
          if (e2) { send(res, 500, { error: 'write failed' }); return; }
          const args = [
            tmpFile,
            '-strip',
            '-quality', String(WEBP_QUALITY),
            '-resize', WEBP_MAX_EDGE + 'x' + WEBP_MAX_EDGE + '>',
            outFile,
          ];
          // 依次尝试 convert / magick（ImageMagick 7 可能只提供 magick）
          const cmds = [['convert', args], ['magick', ['convert'].concat(args)]];
          let tried = 0;
          function tryNext() {
            if (tried >= cmds.length) { fallback(); return; }
            const spec = cmds[tried++];
            execFile(spec[0], spec[1], function (cerr) {
              if (cerr && cerr.code === 'ENOENT' && tried < cmds.length) { tryNext(); return; }
              if (cerr) { fallback(); return; }
              fs.unlink(tmpFile, function () {}); // 清理临时原图
              send(res, 200, { url: '/uploads/' + id + '/' + webpName, name: webpName });
            });
          }
          function fallback() {
            fs.unlink(tmpFile, function () {}); // 清理临时原图
            // 转换失败（如未安装 ImageMagick）：退化为保存原始位图，保证上传可用
            const fallbackName = genName(ext);
            fs.writeFile(path.join(dir, fallbackName), buf, function (e3) {
              if (e3) { send(res, 500, { error: 'convert failed and fallback failed' }); return; }
              send(res, 200, { url: '/uploads/' + id + '/' + fallbackName, name: fallbackName });
            });
          }
          tryNext();
        });
      });
    });
    return;
  }

  // ---- 删除 ----
  if (req.method === 'DELETE' && req.url === '/api/upload') {
    readBody(req, (err, body) => {
      if (err) { send(res, 400, { error: err.message }); return; }
      let p;
      try { p = JSON.parse(body); } catch (e) { send(res, 400, { error: 'invalid json' }); return; }
      const id = safeId(p.activityId);
      const name = safeName(p.name);
      if (!id || !name) { send(res, 400, { error: 'invalid' }); return; }
      fs.unlink(path.join(ROOT, id, name), () => { send(res, 200, { ok: true }); });
    });
    return;
  }

  // ---- 列举 ----
  const m = /^\/api\/activities\/([^/]+)\/images$/.exec(req.url);
  if (req.method === 'GET' && m) {
    const id = safeId(m[1]);
    if (!id) { send(res, 400, { error: 'invalid id' }); return; }
    fs.readdir(path.join(ROOT, id), (e, files) => {
      if (e) { send(res, 200, { images: [] }); return; }
      const images = files
        .filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f))
        .map((f) => ({ url: '/uploads/' + id + '/' + f, name: f }));
      send(res, 200, { images: images });
    });
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[upload-server] listening on ' + PORT);
});
