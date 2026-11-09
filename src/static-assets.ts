import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
type Encoding = 'br' | 'gzip' | 'identity';
type Asset = { source: Buffer; etag: string; variants: Map<Encoding, Promise<Buffer>> };
const cache = new Map<string, Promise<Asset>>();
const maxEntries = 16;
const maxSourceBytes = 1024 * 1024;

// Cache only bounded-size files and a bounded number of compressed variants.
async function load(path: string): Promise<Asset> {
  const info = await stat(path);
  const key = `${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const existing = cache.get(key);
  if (existing) { cache.delete(key); cache.set(key, existing); return existing; }
  const pending = readFile(path).then(source => ({
    source, etag: `W/"${createHash('sha256').update(source).digest('base64url')}"`,
    variants: new Map<Encoding, Promise<Buffer>>(),
  }));
  if (info.size <= maxSourceBytes) {
    cache.set(key, pending);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  return pending;
}

function selectEncoding(header: string | undefined, compressible: boolean): Encoding | undefined {
  if (!header) return 'identity';
  const values = new Map<string, number>();
  for (const item of header.split(',')) {
    const [name, ...parameters] = item.trim().toLowerCase().split(';');
    if (!name) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/.exec(parameter);
      if (/^\s*q\s*=/.test(parameter)) quality = match ? Number(match[1]) : 0;
    }
    values.set(name, quality);
  }
  const wildcard = values.get('*');
  const quality = (name: Encoding) => values.get(name) ?? (name === 'identity' ? (wildcard === 0 ? 0 : 1) : wildcard ?? 0);
  const candidates: Encoding[] = compressible ? ['br', 'gzip', 'identity'] : ['identity'];
  return candidates.map(name => ({ name, q: quality(name) })).filter(entry => entry.q > 0)
    .sort((a, b) => b.q - a.q)[0]?.name;
}

function addVary(res: ServerResponse, name: string) {
  const current = res.getHeader('vary');
  const fields = (Array.isArray(current) ? current.join(',') : String(current ?? '')).split(',').map(x => x.trim()).filter(Boolean);
  if (!fields.some(field => field === '*' || field.toLowerCase() === name.toLowerCase())) fields.push(name);
  res.setHeader('vary', fields.join(', '));
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string, file: string) {
  const asset = await load(file);
  const extension = file.split('.').at(-1)!;
  const mime: Record<string, string> = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' };
  const compressible = ['html', 'css', 'js', 'svg'].includes(extension);
  if (compressible) addVary(res, 'Accept-Encoding');
  const encoding = selectEncoding(req.headers['accept-encoding'], compressible);
  if (!encoding) { res.writeHead(406, { 'cache-control': 'no-store' }); res.end(); return; }
  const hashed = /^\/assets\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8}\.(?:js|css|svg|png|woff2)$/.test(pathname);
  const headers: Record<string, string | number> = {
    'content-type': mime[extension] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'etag': asset.etag,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
  };
  if (encoding !== 'identity') headers['content-encoding'] = encoding;
  const tags = req.headers['if-none-match']?.split(',').map(tag => tag.trim());
  if (tags?.some(tag => tag === '*' || tag.replace(/^W\//, '') === asset.etag.replace(/^W\//, ''))) {
    res.writeHead(304, headers); res.end(); return;
  }
  let content = asset.source;
  if (encoding !== 'identity') {
    let variant = asset.variants.get(encoding);
    if (!variant) {
      variant = encoding === 'br' ? brotli(asset.source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : gzipAsync(asset.source);
      asset.variants.set(encoding, variant);
      variant.catch(() => { if (asset.variants.get(encoding) === variant) asset.variants.delete(encoding); });
    }
    content = await variant;
  }
  headers['content-length'] = content.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : content);
}
