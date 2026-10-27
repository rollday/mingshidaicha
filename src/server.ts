import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { config, type Config } from './config.ts';
import { commandSchema } from './contracts.ts';
import { AppError, publicError } from './errors.ts';
import { ModelClient } from './model.ts';
import { runPython } from './python.ts';
import { CaseWorkflow } from './cases.ts';
import { samples } from './samples.ts';

type Session = {
  id: string; token: string; expires: number; sockets: Set<WebSocket>;
  documents: Map<string, { path: string; mime: string }>; workflow: CaseWorkflow;
  requests: Set<string>; task?: { id: string; abort: AbortController };
};
const SESSION_TTL = 15 * 60 * 1000;

export async function createBackend(settings: Config = config) {
  const directory = await mkdtemp(join(tmpdir(), 'mingshidaicha-'));
  const sessions = new Map<string, Session>();
  const model = new ModelClient(settings);
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false });
  let running = 0, rendering = 0, closing = false;

  function send(ws: WebSocket, type: string, requestId: string | null, data: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'Client too slow'); return; }
    ws.send(JSON.stringify({ version: 1, type, request_id: requestId, timestamp: new Date().toISOString(), data }));
  }
  function broadcast(session: Session, type: string, requestId: string, data: unknown) {
    for (const ws of session.sockets) send(ws, type, requestId, data);
  }
  async function dispose(session: Session) {
    sessions.delete(session.token);
    session.task?.abort.abort();
    for (const ws of session.sockets) ws.close(1000, 'Session ended');
    await Promise.all([...session.documents.values()].map(file => rm(file.path, { force: true })));
    session.workflow.records.clear();
  }
  function findSession(token?: string): Session {
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expires <= Date.now()) throw new AppError('UNAUTHORIZED', '会话不存在或已过期。', 401);
    session.expires = Date.now() + SESSION_TTL;
    return session;
  }
  function httpSession(req: IncomingMessage) {
    const header = req.headers['x-session-token'];
    const token = typeof header === 'string' ? header : req.headers.authorization?.replace(/^Bearer /, '');
    return findSession(token);
  }
  function originAllowed(origin?: string, host?: string) {
    if (!origin || settings.allowedOrigins.has(origin)) return true;
    try { const url = new URL(origin); return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host; } catch { return false; }
  }
  function json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(data));
  }
  async function readBody(req: IncomingMessage) {
    const chunks: Buffer[] = []; let size = 0;
    for await (const part of req) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      size += chunk.length;
      if (size > settings.maxUpload) throw new AppError('FILE_TOO_LARGE', '文件超过大小限制。', 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  const server = createServer(async (req, res) => {
    try {
      if (!originAllowed(req.headers.origin, req.headers.host)) throw new AppError('ORIGIN_FORBIDDEN', '不允许的前端来源。', 403);
      if (req.headers.origin) {
        res.setHeader('access-control-allow-origin', req.headers.origin);
        res.setHeader('vary', 'Origin');
        res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('access-control-allow-headers', 'Authorization, Content-Type, X-Session-Token');
      }
      if (closing) throw new AppError('SHUTTING_DOWN', '服务正在停止。', 503);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && (['/', '/debug', '/dev/components', '/app.js', '/app.css'].includes(pathname) || /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|svg|png|woff2)$/.test(pathname))) {
        let file: string;
        if (pathname === '/' || pathname === '/dev/components') file = 'ui/index.html';
        else if (pathname === '/debug') file = 'index.html';
        else file = pathname.startsWith('/assets/') ? 'ui' + pathname : pathname.slice(1);
        let content: Buffer;
        try { content = await readFile(resolve('public', file)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          if (pathname !== '/') throw new AppError('NOT_FOUND', '页面或静态资源不存在。', 404);
          file = 'index.html'; content = await readFile(resolve('public', file));
        }
        const extension = file.split('.').at(-1)!;
        const mime: Record<string,string> = { html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2' };
        res.writeHead(200, { 'content-type': mime[extension] ?? 'application/octet-stream',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'" });
        res.end(content); return;
      }
      if (req.method === 'GET' && pathname === '/api/samples') return json(res, 200, samples);
      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, { status: 'ok', model: settings.model, model_configured: Boolean(settings.apiKey), search_configured: Boolean(settings.searchMcpURL), transport: 'websocket', running_tasks: running });
      }
      if (req.method === 'POST' && pathname === '/api/sessions') {
        if (sessions.size >= 100) throw new AppError('SESSION_LIMIT', '会话数已达上限。', 429);
        const session: Session = { id: randomUUID(), token: randomBytes(32).toString('base64url'), expires: Date.now() + SESSION_TTL, sockets: new Set(), documents: new Map(), requests: new Set(), workflow: new CaseWorkflow(settings) };
        sessions.set(session.token, session);
        return json(res, 201, { session_id: session.id, session_token: session.token, websocket_path: '/ws', expires_in_seconds: SESSION_TTL / 1000 });
      }
      if (req.method === 'DELETE' && pathname === '/api/sessions/current') {
        await dispose(httpSession(req)); return json(res, 200, { deleted: true });
      }
      if (req.method === 'POST' && pathname === '/api/documents') {
        const session = httpSession(req);
        if (session.documents.size >= 5) throw new AppError('DOCUMENT_LIMIT', '每个会话最多上传 5 份材料。', 429);
        const mime = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
        if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) throw new AppError('UNSUPPORTED_MEDIA', '支持 PDF、PNG 和 JPG 原始字节上传。', 415);
        const body = await readBody(req);
        const valid = mime === 'application/pdf' ? body.subarray(0, 1024).includes(Buffer.from('%PDF-')) : mime === 'image/png' ? body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : body[0] === 255 && body[1] === 216 && body[2] === 255;
        if (!valid) throw new AppError(mime === 'application/pdf' ? 'INVALID_PDF' : 'INVALID_IMAGE', '文件内容与上传格式不符。', 422);
        if (!sessions.has(session.token)) throw new AppError('UNAUTHORIZED', '会话已结束。', 401);
        if (session.documents.size >= 5) throw new AppError('DOCUMENT_LIMIT', '每个会话最多上传 5 份材料。', 429);
        const id = randomUUID(), path = join(directory, id + (mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg'));
        await writeFile(path, body, { mode: 0o600, flag: 'wx' });
        if (!sessions.has(session.token)) { await rm(path, { force: true }); throw new AppError('UNAUTHORIZED', '会话已结束。', 401); }
        session.documents.set(id, { path, mime });
        return json(res, 201, { document_id: id, bytes: body.length });
      }
      if (req.method === 'GET' && /^\/api\/documents\/[a-f0-9-]+$/.test(pathname)) {
        const file = httpSession(req).documents.get(pathname.split('/').at(-1)!);
        if (!file) throw new AppError('DOCUMENT_NOT_FOUND', '当前会话中找不到该材料。', 404);
        res.writeHead(200, { 'content-type': file.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(await readFile(file.path)); return;
      }
      const preview = /^\/api\/documents\/([a-f0-9-]+)\/pages\/([1-9][0-9]*)\.png$/.exec(pathname);
      if (req.method === 'GET' && preview) {
        const session = httpSession(req), file = session.documents.get(preview[1]!);
        if (!file) throw new AppError('DOCUMENT_NOT_FOUND', '当前会话中找不到该材料。', 404);
        const page = Number(preview[2]);
        if (!Number.isSafeInteger(page) || page > settings.maxPdfPages) throw new AppError('INVALID_PAGE', '页码超出允许范围。', 422);
        if (rendering >= 2) throw new AppError('PREVIEW_BUSY', '预览服务繁忙，请稍后重试。', 429);
        const abort = new AbortController();
        const disconnect = () => { if (!res.writableEnded) abort.abort(); };
        res.on('close', disconnect); rendering++;
        try {
          const rendered = await runPython(settings, 'prepare_visual', { path: file.path, pages: [page], max_pages: 1 }, abort.signal) as { images: { data: string }[] };
          if (!sessions.has(session.token)) throw new AppError('UNAUTHORIZED', '会话已结束。', 401);
          const image = rendered.images[0];
          if (!image) throw new AppError('PREVIEW_UNAVAILABLE', '无法生成页面预览。', 422);
          if (!res.destroyed) {
            res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
            res.end(Buffer.from(image.data, 'base64'));
          }
        } finally { rendering--; res.off('close', disconnect); }
        return;
      }
      throw new AppError('NOT_FOUND', '接口不存在。', 404);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error instanceof AppError ? error.status : 500, { error: publicError(error) });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (closing || path !== '/ws' || !originAllowed(req.headers.origin, req.headers.host) || websocket.clients.size >= 200) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    websocket.handleUpgrade(req, socket, head, ws => websocket.emit('connection', ws));
  });
  websocket.on('connection', ws => {
    let session: Session | undefined;
    let alive = true;
    const authTimeout = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    ws.on('error', () => {});
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, 30000);
    ws.on('close', () => { clearTimeout(authTimeout); clearInterval(heartbeat); session?.sockets.delete(ws); if (session && session.sockets.size === 0) session.task?.abort.abort(); });
    ws.on('message', (raw, binary) => {
      let id: string | null = null;
      try {
        if (binary) throw new AppError('INVALID_COMMAND', 'WS 命令必须为 JSON 文本。');
        let value: unknown;
        try { value = JSON.parse(raw.toString()); } catch { throw new AppError('INVALID_JSON', '命令不是有效 JSON。'); }
        if (value && typeof value === 'object' && 'request_id' in value && typeof value.request_id === 'string' && value.request_id.length <= 100) id = value.request_id;
        const result = commandSchema.safeParse(value);
        if (!result.success) throw new AppError('INVALID_COMMAND', '命令字段不符合协议。');
        const command = result.data; id = command.request_id;
        if (command.type === 'session.authenticate') {
          if (session) throw new AppError('ALREADY_AUTHENTICATED', '连接已认证。');
          session = findSession(command.token);
          if (session.sockets.size >= 3) { session = undefined; throw new AppError('CONNECTION_LIMIT', '会话连接数已达上限。', 429); }
          session.sockets.add(ws); clearTimeout(authTimeout);
          send(ws, 'session.ready', id, { session_id: session.id }); return;
        }
        if (!session || findSession(session.token) !== session) throw new AppError('UNAUTHORIZED', '请先认证会话。', 401);
        if (command.type === 'ping') { send(ws, 'pong', id, {}); return; }
        if (command.type === 'task.cancel') { session.task?.abort.abort(); send(ws, 'task.cancel.accepted', id, {}); return; }
        if (command.type === 'case.get') { send(ws, 'case.snapshot', id, session.workflow.view(session.workflow.get(command.case_id))); return; }
        if (session.task) throw new AppError('SESSION_BUSY', '当前会话已有运行中的任务。', 409);
        if (running >= settings.maxConcurrent) throw new AppError('SERVER_BUSY', '服务繁忙，请稍后重试。', 429);
        if (session.requests.has(id)) throw new AppError('DUPLICATE_REQUEST', 'request_id 已使用，请使用新 ID。', 409);
        if (session.requests.size >= 1000) throw new AppError('REQUEST_LIMIT', '会话请求数已达上限，请新建会话。', 429);
        session.requests.add(id);
        const activeSession = session, requestId = id, abort = new AbortController();
        activeSession.task = { id, abort }; running++;
        const started = Date.now();
        const timeout = setTimeout(() => abort.abort(), settings.modelTimeout);
        broadcast(activeSession, 'task.started', id, { operation: command.type });
        void (async () => {
          try {
            if (command.type === 'case.start' || command.type === 'case.confirm' || command.type === 'case.report' || command.type === 'lender.search' || command.type === 'lender.detail') {
              await activeSession.workflow.execute(command, abort.signal, (type, data) => broadcast(activeSession, type, requestId, data), documentId => activeSession.documents.get(documentId));
            } else if (command.type === 'audit.calculate') {
              broadcast(activeSession, 'task.progress', requestId, { stage: 'calculate' });
              const data = await runPython(settings, 'calculate', command.input, abort.signal);
              if (abort.signal.aborted) throw new AppError('TASK_CANCELLED', '任务已取消。', 499);
              broadcast(activeSession, 'audit.result', requestId, data);
            } else {
              let text: string;
              if (command.type === 'audit.document') {
                const file = activeSession.documents.get(command.document_id);
                if (!file) throw new AppError('DOCUMENT_NOT_FOUND', '当前会话中找不到该材料。', 404);
                if (file.mime !== 'application/pdf') throw new AppError('UNSUPPORTED_MEDIA', '图片请使用 case.start 完整流程。', 415);
                broadcast(activeSession, 'task.progress', requestId, { stage: 'parse_pdf' });
                const parsed = await runPython(settings, 'parse_pdf', { path: file.path, max_pages: settings.maxPdfPages }, abort.signal) as { pages: { page: number; text: string }[]; needs_vision: boolean };
                broadcast(activeSession, 'document.parsed', requestId, parsed);
                if (parsed.needs_vision) throw new AppError('VISION_REQUIRED', 'PDF 包含需要视觉识别的页面，请手工补录；当前未启用视觉识别。', 422);
                text = parsed.pages.map(page => `[第${page.page}页]\n${page.text}`).join('\n\n');
              } else text = command.text;
              if (text.length > 200000) throw new AppError('DOCUMENT_TOO_LONG', '材料文字过长，请拆分。', 413);
              broadcast(activeSession, 'task.progress', requestId, { stage: 'extract_fields' });
              let lastProgress = 0;
              const extraction = await model.extract(text, abort.signal, bytes => {
                if (Date.now() - lastProgress > 250) { lastProgress = Date.now(); broadcast(activeSession, 'model.progress', requestId, { received_bytes: bytes }); }
              });
              if (abort.signal.aborted) throw new AppError('TASK_CANCELLED', '任务已取消。', 499);
              // Never calculate unconfirmed model output. The client edits/accepts it first.
              broadcast(activeSession, 'audit.review', requestId, { ...extraction, requires_confirmation: true });
            }
            broadcast(activeSession, 'task.completed', requestId, { elapsed_ms: Date.now() - started });
          } catch (error) {
            broadcast(activeSession, 'task.error', requestId, publicError(error));
          } finally {
            clearTimeout(timeout);
            activeSession.task = undefined; running--;
          }
        })();
      } catch (error) { send(ws, 'request.error', id, publicError(error)); }
    });
  });
  const sweep = setInterval(() => { for (const session of sessions.values()) if (session.expires <= Date.now()) void dispose(session); }, 30000);
  sweep.unref();
  return {
    server,
    async close() {
      closing = true; clearInterval(sweep);
      await Promise.all([...sessions.values()].map(dispose));
      for (const ws of websocket.clients) ws.terminate();
      await new Promise<void>(resolve => websocket.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
