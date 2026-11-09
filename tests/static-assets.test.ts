import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { config } from '../src/config.ts';
import { createBackend } from '../src/server.ts';

test('static representations support compression, validation and cache policy', async t => {
  const path = 'public/ui/assets/test-cache-AbCd12_3.js';
  await mkdir('public/ui/assets', { recursive: true });
  const original = await readFile('public/app.js');
  await writeFile(path, original);
  t.after(() => rm(path, { force: true }));
  const backend = await createBackend({ ...config, port: 0 });
  backend.server.listen(0, '127.0.0.1'); await once(backend.server, 'listening');
  t.after(() => backend.close());
  const address = backend.server.address(); assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request(origin + path, { method, headers }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
  const asset = '/assets/test-cache-AbCd12_3.js';
  const br = await get(asset, { 'Accept-Encoding': 'br, gzip', Origin: origin });
  assert.equal(br.status, 200); assert.equal(br.headers['content-encoding'], 'br');
  assert.deepEqual(brotliDecompressSync(br.body), original);
  assert.equal(Number(br.headers['content-length']), br.body.length);
  assert.match(br.headers.vary!, /Origin/i); assert.match(br.headers.vary!, /Accept-Encoding/i);
  assert.equal(br.headers['cache-control'], 'public, max-age=31536000, immutable');
  const gz = await get(asset, { 'Accept-Encoding': 'br;q=0, gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip'); assert.deepEqual(gunzipSync(gz.body), original);
  const identity = await get(asset, { 'Accept-Encoding': 'br;q=0.2, gzip;q=0.4' });
  assert.equal(identity.headers['content-encoding'], undefined); assert.deepEqual(identity.body, original);
  const head = await get(asset, { 'Accept-Encoding': 'br' }, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], br.headers['content-length']);
  const conditional = await get(asset, { 'Accept-Encoding': 'gzip', 'If-None-Match': br.headers.etag! });
  assert.equal(conditional.status, 304); assert.equal(conditional.body.length, 0);
  assert.equal((await get(asset, { 'Accept-Encoding': 'identity;q=0, *;q=0' })).status, 406);
  assert.equal((await get('/app.js')).headers['cache-control'], 'no-cache');
  assert.equal((await get('/')).headers['cache-control'], 'no-cache');
  assert.equal((await get('/api/health')).headers['cache-control'], 'no-store');
  assert.equal((await get('/assets/..%2f..%2f.env')).status, 404);
});
