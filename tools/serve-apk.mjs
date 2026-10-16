#!/usr/bin/env node
/**
 * ریل‌فورج — سرور کوچک برای دانلود APK روی گوشی.
 *
 * Serve the built Android APK over the LAN / a preview URL so it can be opened
 * on a phone and installed directly:
 *
 *   node tools/serve-apk.mjs [dir] [port]
 *
 * `dir` defaults to ../../downloads (a sibling of the repo, so build output never
 * lands in Git) — pass any folder that holds *.apk files.
 */
import { createServer } from 'node:http';
import { stat, readdir, createReadStream } from 'node:fs/promises';
import { join, basename, resolve, extname } from 'node:path';

const dir = resolve(process.argv[2] || new URL('../../downloads', import.meta.url).pathname);
const port = Number(process.argv[3] || process.env.PORT || 8090);

const MIME = {
  '.apk': 'application/vnd.android.package-archive',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const html = (files) => `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>دانلود ریل‌فورج</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: system-ui, "Vazirmatn", Tahoma, sans-serif; background:#0d0b14; color:#f4f1ff }
  .card { width:min(560px, 92vw); background:#171326; border:1px solid #2c2340; border-radius:20px;
          padding:28px; box-shadow:0 20px 60px #0008 }
  h1 { margin:0 0 6px; font-size:26px }
  p  { margin:0 0 22px; color:#b9b0d4; line-height:1.9; font-size:15px }
  a.btn { display:block; text-align:center; text-decoration:none; font-weight:700; font-size:17px;
          padding:16px; border-radius:14px; color:#160b22;
          background:linear-gradient(135deg,#ff5fa2,#ffb457) }
  a.btn + a.btn { margin-top:10px; background:linear-gradient(135deg,#8b5cf6,#22d3ee) }
  small { display:block; margin-top:18px; color:#8d84a8; line-height:1.9 }
  ol { color:#b9b0d4; line-height:2; font-size:14px; padding-inline-start:20px; margin:14px 0 0 }
</style></head><body><div class="card">
  <h1>ریل‌فورج 🎬</h1>
  <p>نسخهٔ اندروید (APK تستی). فایل را روی گوشی نصب کن — برای iOS به macOS و Xcode نیاز است.</p>
  ${files.length
    ? files.map((f) => `<a class="btn" href="/${encodeURIComponent(f.name)}" download>⬇️ دانلود ${f.name} (${(f.size / 1048576).toFixed(1)} مگابایت)</a>`).join('\n  ')
    : '<p>فایلی برای دانلود پیدا نشد.</p>'}
  <ol>
    <li>فایل را باز کن؛ اگر پیام «نصب از منابع ناشناس» آمد، اجازه بده.</li>
    <li>بعد از نصب، اولین اجرا کمی طول می‌کشد (فونت و موتور را بارگذاری می‌کند).</li>
    <li>همه‌چیز آفلاین است؛ فقط اگر کلید هوش مصنوعی بدهی به اینترنت نیاز دارد.</li>
  </ol>
  <small>ساخته‌شده با PWA + Capacitor — یک کدبیس برای وب و اندروید.</small>
</div></body></html>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === '/index.html') {
    let entries = [];
    try {
      const names = (await readdir(dir)).filter((n) => extname(n).toLowerCase() === '.apk').sort();
      entries = await Promise.all(names.map(async (name) => ({ name, size: (await stat(join(dir, name))).size })));
    } catch { /* folder missing → empty list */ }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html(entries));
    return;
  }
  const file = join(dir, basename(path));
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'content-disposition': `attachment; filename="${basename(file)}"`,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('پیدا نشد');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`APK download server → http://0.0.0.0:${port}  (dir: ${dir})`);
});
