import type { ApiError, CaseFacts, CaseSnapshot, ClientCommand, DocumentParsed, Sample, ServerEvent, Session } from '../types/audit.ts';

export type CaseState = {
  connection: 'connecting' | 'ready' | 'offline'; busy: boolean;
  screen: 'upload' | 'confirm' | 'report'; stage: string;
  current: CaseSnapshot | null; parsed: Record<string, DocumentParsed>;
  error: ApiError | null; warning: string | null; samples: Sample[];
};
export const initialState = (): CaseState => ({ connection: 'connecting', busy: false, screen: 'upload', stage: '', current: null, parsed: {}, error: null, warning: null, samples: [] });

/** Pure event adapter: request scoping is enforced by the client before reducing. */
export function applyEvent(state: CaseState, event: ServerEvent): CaseState {
  switch (event.type) {
    case 'document.parsed': return { ...state, parsed: { ...state.parsed, [event.data.document_id]: event.data } };
    case 'task.progress': return { ...state, stage: event.data.stage };
    case 'case.review': return { ...state, current: event.data, screen: 'confirm' };
    case 'case.snapshot': return { ...state, current: event.data, screen: event.data.report ? 'report' : 'confirm' };
    case 'case.confirmed': return { ...state, current: state.current ? { ...state.current, revision: event.data.revision, corrections: event.data.corrections, report: null } : null };
    case 'case.calculation_unavailable': return { ...state, warning: '材料不足或存在冲突，本次报告将注明无法核算。' };
    case 'report.warning': return { ...state, warning: event.data.message };
    case 'report.result': return { ...state, screen: 'report', current: state.current ? { ...state.current, revision: event.data.revision, status: 'completed', report: event.data.report } : null };
    case 'task.completed': return { ...state, busy: false, stage: '' };
    case 'task.error': case 'request.error': return { ...state, busy: false, stage: '', error: event.data };
    default: return state;
  }
}

type FileInput = { file: File; role: 'disclosure' | 'contract' | 'schedule' | 'other' };
export class CaseClient {
  state = initialState();
  private listeners = new Set<(state: CaseState) => void>();
  private session: Session | null = null;
  private socket: WebSocket | null = null;
  private stopped = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private uploadAbort: AbortController | null = null;
  private uploaded = new Map<File, string>();
  private activeId: string | null = null;
  private snapshotId: string | null = null;

  subscribe(listener: (state: CaseState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  update(patch: Partial<CaseState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(this.state); }
  private reduce(event: ServerEvent) { this.state = applyEvent(this.state, event); for (const listener of this.listeners) listener(this.state); }
  private async http<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.session) headers.set('X-Session-Token', this.session.session_token);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401 && !response.headers.get('content-type')?.includes('json')) throw { code: 'ACCESS_REQUIRED', message: '访问验证失效，请刷新页面并重新登录。' };
    const body = await response.json();
    if (!response.ok) throw body.error ?? { code: 'HTTP_ERROR', message: '请求失败，请稍后重试。' };
    return body as T;
  }
  private failure(error: unknown) {
    const value = error as Partial<ApiError>;
    this.update({ busy: false, stage: '', error: { code: value.code ?? 'NETWORK_ERROR', message: value.message ?? '网络连接中断，请重试。' } });
  }
  async open() {
    clearTimeout(this.retryTimer);
    if (this.socket) { this.socket.onclose = null; this.socket.close(); }
    this.stopped = false;
    this.update({ connection: 'connecting', error: null });
    try {
      const samples = await this.http<Sample[]>('/api/samples');
      if (this.stopped) return;
      this.update({ samples });
      if (!this.session) this.session = await this.http<Session>('/api/sessions', { method: 'POST' });
      if (this.stopped) return;
      await this.connect();
    } catch (error) { if (!this.stopped) { this.update({ connection: 'offline' }); this.failure(error); } }
  }
  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${this.session!.websocket_path}`);
      this.socket = ws;
      const auth = crypto.randomUUID();
      let ready = false;
      const timeout = setTimeout(() => { reject({ code: 'CONNECTION_TIMEOUT', message: '连接超时，请重试。' }); ws.close(); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'session.authenticate', request_id: auth, token: this.session!.session_token }));
      ws.onmessage = ({ data }) => {
        let event: ServerEvent;
        try { event = JSON.parse(String(data)); } catch { return; }
        if (event.version !== 1) return;
        if (event.request_id === auth) {
          if (event.type === 'session.ready') {
            ready = true; clearTimeout(timeout); this.retries = 0; this.update({ connection: 'ready' }); resolve();
            if (this.state.current) { this.snapshotId = crypto.randomUUID(); this.send({ type: 'case.get', request_id: this.snapshotId, case_id: this.state.current.case_id }); }
          } else if (event.type === 'request.error') { clearTimeout(timeout); this.session = null; ws.onclose = null; reject(event.data); ws.close(); }
          return;
        }
        if (event.request_id !== this.activeId && event.request_id !== this.snapshotId) return;
        this.reduce(event);
        if (event.type === 'request.error' && event.data.code === 'REVISION_CONFLICT' && this.state.current) {
          this.snapshotId = crypto.randomUUID(); this.send({ type: 'case.get', request_id: this.snapshotId, case_id: this.state.current.case_id });
        }
      };
      ws.onerror = () => { if (!ready) reject({ code: 'NETWORK_ERROR', message: '无法连接服务，请检查网络。' }); };
      ws.onclose = () => {
        clearTimeout(timeout);
        if (this.socket !== ws || this.stopped) return;
        this.update({ connection: 'offline', busy: false, warning: this.state.busy ? '连接中断，当前任务可能已取消。恢复后可重新读取或生成报告。' : this.state.warning });
        if (ready && this.retries < 3) { this.retryTimer = setTimeout(() => { void this.connect().catch(error => this.failure(error)); }, 1000 * 2 ** this.retries++); }
        else if (!ready) reject({ code: 'NETWORK_ERROR', message: '连接未完成，请重试。' });
      };
    });
  }
  private send(command: ClientCommand) {
    if (this.socket?.readyState !== WebSocket.OPEN || this.state.connection !== 'ready') throw { code: 'OFFLINE', message: '连接尚未恢复，请稍后重试。' };
    this.socket.send(JSON.stringify(command));
  }
  private task(command: ClientCommand) {
    this.activeId = command.request_id;
    this.update({ busy: true, error: null, warning: null });
    try { this.send(command); } catch (error) { this.failure(error); }
  }
  async start(files: FileInput[], text: string, isStudent: boolean | null, purpose: string) {
    if (this.state.busy) return;
    this.uploadAbort = new AbortController();
    const abort = this.uploadAbort;
    this.update({ busy: true, error: null, warning: null, stage: 'upload' });
    try {
      const documents = [];
      for (const { file, role } of files) {
        let document_id = this.uploaded.get(file);
        if (!document_id) {
          const uploaded = await this.http<{ document_id: string }>('/api/documents', { method: 'POST', body: file, headers: { 'Content-Type': file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream') }, signal: abort.signal });
          document_id = uploaded.document_id; this.uploaded.set(file, document_id);
        }
        documents.push({ document_id, role });
      }
      if (abort.signal.aborted) return;
      this.task({ type: 'case.start', request_id: crypto.randomUUID(), documents, text: text.trim() || undefined, context: { is_student: isStudent, purpose: purpose || 'unknown' } });
    } catch (error) { if (!abort.signal.aborted) this.failure(error); }
    finally { if (this.uploadAbort === abort) this.uploadAbort = null; }
  }
  manual(isStudent: boolean | null) { this.task({ type: 'case.start', request_id: crypto.randomUUID(), manual_facts: {}, context: { is_student: isStudent } }); }
  demo(fee: string, isStudent: boolean) {
    this.task({ type: 'case.start', request_id: crypto.randomUUID(), context: { is_student: isStudent }, manual_facts: {
      borrower: { is_student: isStudent, purpose: '模拟消费试算' },
      lender: { name: '模拟贷款机构', type: 'bank', internet_assisted: false },
      loan: { principal: '10000', disbursed: '10000', term_periods: 12, periods_per_year: 12, repay_method: 'equal_installment', period_payment: '888.49', nominal_apr: '0.12', start_date: '2026-09-01' },
      disclosure: { present: true, quoted_apr: '0.12', quoted_method: 'nominal', items_complete: true, contingent_disclosed: true },
      fees: fee === '0' ? [] : [{ id:'demo-service', name:'模拟服务费', amount:fee, timing:'per_period', payee:'模拟平台', payee_type:'platform', in_disclosure:false, included_in_cashflows:false, included_in_disclosed_cost:false, contingent:false }],
      funds_to: 'borrower',
    } });
  }
  confirm(facts: CaseFacts) {
    if (!this.state.current || this.state.busy) return;
    this.update({ current: { ...this.state.current, facts: structuredClone(facts), report: null } });
    this.task({ type: 'case.confirm', request_id: crypto.randomUUID(), case_id: this.state.current.case_id, expected_revision: this.state.current.revision, facts });
  }
  retryReport() { if (this.state.current && !this.state.busy) this.task({ type: 'case.report', request_id: crypto.randomUUID(), case_id: this.state.current.case_id, expected_revision: this.state.current.revision }); }
  cancel() {
    if (this.uploadAbort) { this.uploadAbort.abort(); this.update({ busy: false, stage: '' }); }
    else try { this.send({ type: 'task.cancel', request_id: crypto.randomUUID() }); } catch (error) { this.failure(error); }
  }
  async reset() {
    this.stopped = true; this.uploadAbort?.abort(); clearTimeout(this.retryTimer);
    if (this.socket) { this.socket.onclose = null; this.socket.close(); }
    try { if (this.session) await this.http('/api/sessions/current', { method: 'DELETE' }); }
    catch (error) { this.failure(error); return; }
    this.session = null; this.activeId = null; this.snapshotId = null; this.uploaded.clear();
    this.state = initialState(); await this.open();
  }
  dispose() { this.stopped = true; clearTimeout(this.retryTimer); this.uploadAbort?.abort(); this.socket?.close(); }
}
