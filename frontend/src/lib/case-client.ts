import type { Activity,ReportDraft,LenderSearchCategory,ApiError, CaseFacts, CaseSnapshot, ClientCommand, DocumentParsed, Sample, ServerEvent, Session } from '../types/audit.ts';

export type CaseState = {
  connection: 'connecting' | 'ready' | 'offline'; busy: boolean;
  screen: 'upload' | 'confirm' | 'report'; stage: string;
  current: CaseSnapshot | null; parsed: Record<string, DocumentParsed>;
  error: ApiError | null; warning: string | null; samples: Sample[];
  activities:Activity[];checked:CaseSnapshot['checked'];draft:ReportDraft|null;liveCategories:LenderSearchCategory[];
  startedAt:string|null;finishedAt:string|null;lastModelAt:string|null;
};
export const initialState = (): CaseState => ({ connection: 'connecting', busy: false, screen: 'upload', stage: '', current: null, parsed: {}, error: null, warning: null, samples: [],activities:[],checked:null,draft:null,liveCategories:[],startedAt:null,finishedAt:null,lastModelAt:null });
const mergeActivities=(before:Activity[],after:Activity[])=>[...new Map([...before,...after].map(entry=>[entry.id,entry])).values()].slice(-180);
const stoppedDraft=(draft:ReportDraft|null):ReportDraft|null=>draft?{...draft,status:'discarded',sections:[]}:null;

/** Pure event adapter: request scoping is enforced by the client before reducing. */
export function applyEvent(state: CaseState, event: ServerEvent): CaseState {
  const at=event.timestamp||new Date().toISOString();
  const terminal=(message:string,status:Activity['status'])=>mergeActivities(state.activities,[{id:`local:${event.request_id}:${event.type}`,timestamp:at,revision:state.current?.revision??null,stage:state.stage,kind:'process',status,message}]);
  switch (event.type) {
    case 'task.started':return {...state,busy:true,startedAt:at,finishedAt:null,lastModelAt:null,draft:null,liveCategories:[]};
    case 'task.activity':return {...state,activities:mergeActivities(state.activities,[event.data])};
    case 'model.progress':return {...state,lastModelAt:at};
    case 'report.draft':return state.draft && event.data.attempt<state.draft.attempt?state:{...state,draft:event.data};
    case 'lender.category':return {...state,liveCategories:[...state.liveCategories.filter(category=>category.kind!==event.data.category.kind),event.data.category]};
    case 'document.parsed': return { ...state, parsed: { ...state.parsed, [event.data.document_id]: event.data } };
    case 'task.progress': return { ...state, stage: event.data.stage };
    case 'case.review': return { ...state, current: event.data, screen: 'confirm',checked:event.data.checked??null,activities:mergeActivities(state.activities,event.data.activities??[]) };
    case 'case.snapshot': return { ...state, current: event.data, screen: event.data.report ? 'report' : 'confirm',checked:event.data.checked??null,draft:null,activities:mergeActivities(state.activities,event.data.activities??[]) };
    case 'case.confirmed': return { ...state,checked:null,draft:null,current: state.current ? { ...state.current, revision: event.data.revision, corrections: event.data.corrections, report: null,checked:null } : null };
    case 'case.checked':return state.current?.case_id===event.data.case_id && state.current.revision===event.data.revision?{...state,checked:event.data,current:{...state.current,checked:event.data}}:state;
    case 'case.calculation_unavailable': return { ...state, warning: '材料不足或存在冲突，本次报告将注明无法核算。' };
    case 'report.warning': return { ...state, warning: event.data.message };
    case 'report.result': return { ...state, screen: 'report',draft:null,current: state.current ? { ...state.current, revision: event.data.revision, status: 'completed', report: event.data.report } : null };
    case 'lender.result': return { ...state, current: state.current ? { ...state.current, lender_search:event.data.result, report:state.current.report ? {...state.current.report,public_source_search:event.data.result} : null } : null };
    case 'task.completed': return { ...state, busy: false, stage: '',finishedAt:at,lastModelAt:null,activities:terminal('本次处理完成','completed') };
    case 'task.error': case 'request.error': return { ...state, busy: false, stage: '', error: event.data,finishedAt:at,lastModelAt:null,draft:stoppedDraft(state.draft),activities:terminal(event.data.message,'warning') };
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
  private generation = 0;
  private socketTimeout: ReturnType<typeof setTimeout> | undefined;
  private cancelConnect: (() => void) | null = null;
  private uploadAbort: AbortController | null = null;
  private uploaded = new Map<File, string>();
  private activeId: string | null = null;
  private snapshotId: string | null = null;
  private canceledId:string|null=null;

  subscribe(listener: (state: CaseState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  update(patch: Partial<CaseState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(this.state); }
  private reduce(event: ServerEvent) { this.state = applyEvent(this.state, event); for (const listener of this.listeners) listener(this.state); }
  private async http<T>(url: string, init: RequestInit = {}, session: Session | null = this.session): Promise<T> {
    const headers = new Headers(init.headers);
    if (session) headers.set('X-Session-Token', session.session_token);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401 && !response.headers.get('content-type')?.includes('json')) throw { code: 'ACCESS_REQUIRED', message: '访问验证失效，请刷新页面并重新登录。' };
    const body = await response.json();
    if (!response.ok) throw body.error ?? { code: 'HTTP_ERROR', message: '请求失败，请稍后重试。' };
    return body as T;
  }
  private failure(error: unknown) {
    const value = error as Partial<ApiError>;
    const disconnected = !value.code || ['NETWORK_ERROR','OFFLINE','CONNECTION_TIMEOUT'].includes(value.code);
    this.update({ ...(disconnected ? {connection:'offline' as const} : {}), busy: false, stage: '',finishedAt:new Date().toISOString(),lastModelAt:null,draft:stoppedDraft(this.state.draft),error: { code: value.code ?? 'NETWORK_ERROR', message: value.message ?? '网络连接中断，请重试。' } });
  }
  async open() {
    const generation = ++this.generation;
    const interrupted=this.state.busy;
    if(interrupted)this.canceledId=this.activeId;
    this.cleanupConnection();
    const canceledUpload = this.uploadAbort !== null;
    this.uploadAbort?.abort(); this.uploadAbort = null;
    this.stopped = false;
    this.retries = 0;
    this.update({ connection: 'connecting', error: null, ...(canceledUpload||interrupted ? { busy: false, stage: '',draft:stoppedDraft(this.state.draft),finishedAt:new Date().toISOString(),lastModelAt:null } : {}) });
    try {
      const samples = await this.http<Sample[]>('/api/samples');
      if (!this.isCurrent(generation)) return;
      this.update({ samples });
      let session = this.session;
      if (!session) {
        session = await this.http<Session>('/api/sessions', { method: 'POST' }, null);
        if (!this.isCurrent(generation)) return;
        this.session = session;
      }
      await this.connect(generation, session, false);
    } catch (error) { if (this.isCurrent(generation)) { this.update({connection:'offline'});this.failure(error); } }
  }
  private isCurrent(generation: number) { return !this.stopped && generation === this.generation; }
  private cleanupConnection() {
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    clearTimeout(this.socketTimeout); this.socketTimeout = undefined;
    this.cancelConnect?.(); this.cancelConnect = null;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(); }
  }
  private connect(generation: number, session: Session, reconnect: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isCurrent(generation)) { resolve(); return; }
      if (this.socket) { this.socket.onclose = null; this.socket.close(); }
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${session.websocket_path}`);
      this.socket = ws;
      const auth = crypto.randomUUID();
      let ready = false;
      let settled = false;
      let allowRetry = true;
      const fail = (error: unknown) => {
        if (!settled) {
          settled = true;
          if (this.cancelConnect === cancel) this.cancelConnect = null;
          reject(error);
        }
      };
      const cancel = () => fail({ code: 'CONNECTION_REPLACED', message: '连接已被新的会话替换。' });
      this.cancelConnect = cancel;
      this.socketTimeout = setTimeout(() => {
        if (this.socket !== ws || !this.isCurrent(generation)) return;
        fail({ code: 'CONNECTION_TIMEOUT', message: '连接超时，请重试。' });
        ws.close();
      }, 10000);
      ws.onopen = () => {
        if (this.socket === ws && this.isCurrent(generation)) ws.send(JSON.stringify({ type: 'session.authenticate', request_id: auth, token: session.session_token }));
      };
      ws.onmessage = ({ data }) => {
        if (this.socket !== ws || !this.isCurrent(generation)) return;
        let event: ServerEvent;
        try { event = JSON.parse(String(data)); } catch { return; }
        if (event.version !== 1) return;
        if (event.request_id === auth) {
          if (event.type === 'session.ready') {
            ready = true; clearTimeout(this.socketTimeout); this.socketTimeout = undefined;
            if (reconnect) this.retries = 0;
            this.update({ connection: 'ready', error: null });
            if (!settled) { settled = true; if (this.cancelConnect === cancel) this.cancelConnect = null; resolve(); }
            if (this.state.current) { this.snapshotId = crypto.randomUUID(); this.send({ type: 'case.get', request_id: this.snapshotId, case_id: this.state.current.case_id }); }
          } else if (event.type === 'request.error') {
            allowRetry = false;
            clearTimeout(this.socketTimeout); this.socketTimeout = undefined;
            if (this.session === session) this.session = null;
            this.update({ connection: 'offline', busy: false, stage: '', error: this.asApiError(event.data) });
            fail(event.data); ws.close();
          }
          return;
        }
        if (event.request_id !== this.activeId && event.request_id !== this.snapshotId) return;
        if(event.request_id===this.canceledId && !['task.error','request.error','task.completed'].includes(event.type))return;
        this.reduce(event);
        if (event.type === 'request.error' && event.data.code === 'REVISION_CONFLICT' && this.state.current) {
          this.snapshotId = crypto.randomUUID(); this.send({ type: 'case.get', request_id: this.snapshotId, case_id: this.state.current.case_id });
        }
        if(['task.completed','task.error','request.error'].includes(event.type) && event.request_id===this.activeId)this.activeId=null;
        if(event.type==='case.snapshot' && event.request_id===this.snapshotId)this.snapshotId=null;
      };
      ws.onerror = () => { if (!ready) fail({ code: 'NETWORK_ERROR', message: '无法连接服务，请检查网络。' }); };
      ws.onclose = () => {
        clearTimeout(this.socketTimeout); this.socketTimeout = undefined;
        if (this.socket !== ws || !this.isCurrent(generation)) return;
        this.socket = null;
        this.canceledId=this.activeId;
        const error = { code: 'NETWORK_ERROR', message: '连接中断，正在尝试恢复。' };
        this.update({ connection: 'offline', busy: false, stage: '',draft:stoppedDraft(this.state.draft),finishedAt:new Date().toISOString(),lastModelAt:null,...(allowRetry ? { error } : {}), warning: this.state.busy ? '连接中断，当前任务可能已取消。草稿已撤回，已核算结果保留；恢复后可重新生成报告。' : this.state.warning });
        if (!ready) fail(error);
        if (allowRetry && this.retries < 3) {
          const delay = 1000 * 2 ** this.retries++;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            if (!this.isCurrent(generation) || this.socket) return;
            void this.connect(generation, session, true).catch(() => { /* onclose or the authentication handler records the failure */ });
          }, delay);
        } else if (allowRetry) {
          this.update({ connection: 'offline', error: { code: 'RECONNECT_EXHAUSTED', message: '多次尝试后仍无法连接，请重试。' } });
        }
      };
    });
  }
  private asApiError(error: unknown): ApiError {
    const value = error as Partial<ApiError>;
    return { code: value.code ?? 'NETWORK_ERROR', message: value.message ?? '网络连接中断，请重试。' };
  }
  private send(command: ClientCommand) {
    if (this.socket?.readyState !== WebSocket.OPEN || this.state.connection !== 'ready') throw { code: 'OFFLINE', message: '连接尚未恢复，请稍后重试。' };
    this.socket.send(JSON.stringify(command));
  }
  private task(command: ClientCommand,keepActivities=false) {
    this.activeId = command.request_id;
    this.snapshotId=null;
    this.canceledId=null;
    this.update({ busy: true, error: null, warning: null,draft:null,liveCategories:[],startedAt:new Date().toISOString(),finishedAt:null,lastModelAt:null,...(command.type==='case.start'&&!keepActivities?{activities:[],checked:null,parsed:{}}:{}) });
    try { this.send(command); } catch (error) { this.failure(error); }
  }
  async start(files: FileInput[], text: string, isStudent: boolean | null, purpose: string) {
    if (this.state.busy) return;
    const generation = this.generation;
    this.uploadAbort = new AbortController();
    const abort = this.uploadAbort;
    this.update({ busy: true, error: null, warning: null, stage: 'upload',activities:[],checked:null,draft:null,liveCategories:[],startedAt:new Date().toISOString(),finishedAt:null,lastModelAt:null });
    try {
      const documents = [];
      for (const { file, role } of files) {
        const uploadActivity=(status:Activity['status'],message:string)=>this.update({activities:mergeActivities(this.state.activities,[{id:crypto.randomUUID(),timestamp:new Date().toISOString(),revision:null,stage:'upload',kind:'process',status,message}])});
        uploadActivity('started',`正在上传 ${file.name}（${documents.length+1}/${files.length}）`);
        let document_id = this.uploaded.get(file);
        if (!document_id) {
          const uploaded = await this.http<{ document_id: string }>('/api/documents', { method: 'POST', body: file, headers: { 'Content-Type': file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream') }, signal: abort.signal });
          if (!this.isCurrent(generation) || abort.signal.aborted) return;
          document_id = uploaded.document_id; this.uploaded.set(file, document_id);
        }
        documents.push({ document_id, role });
        uploadActivity('completed',`${file.name} 上传完成`);
      }
      if (!this.isCurrent(generation) || abort.signal.aborted) return;
      this.task({ type: 'case.start', request_id: crypto.randomUUID(), documents, text: text.trim() || undefined, context: { is_student: isStudent, purpose: purpose || 'unknown' } },true);
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
    this.update({ checked:null,draft:null,current: { ...this.state.current, facts: structuredClone(facts), report: null,checked:null } });
    this.task({ type: 'case.confirm', request_id: crypto.randomUUID(), case_id: this.state.current.case_id, expected_revision: this.state.current.revision, facts });
  }
  retryReport() { if (this.state.current && !this.state.busy) this.task({ type: 'case.report', request_id: crypto.randomUUID(), case_id: this.state.current.case_id, expected_revision: this.state.current.revision }); }
  searchLender(name:string) { if (this.state.current && !this.state.busy) { this.update({stage:'search_sources'});this.task({type:'lender.search',request_id:crypto.randomUUID(),case_id:this.state.current.case_id,expected_revision:this.state.current.revision,name}); } }
  readOfficial(url:string) { if(this.state.current && !this.state.busy){this.update({stage:'read_official_source'});this.task({type:'lender.detail',request_id:crypto.randomUUID(),case_id:this.state.current.case_id,expected_revision:this.state.current.revision,url});} }
  previewDocument = async (documentId:string,page:number,signal:AbortSignal):Promise<Blob> => {
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/pages/${page}.png`,{headers:{'X-Session-Token':this.session?.session_token ?? ''},signal});
    if (!response.ok) {
      const body = await response.json().catch(()=>null);
      throw new Error(body?.error?.message ?? '页面预览暂不可用，请重试。');
    }
    return response.blob();
  };
  cancel() {
    this.canceledId=this.activeId;
    this.update({draft:stoppedDraft(this.state.draft),lastModelAt:null});
    if (this.uploadAbort) { this.uploadAbort.abort(); this.uploadAbort = null; const at=new Date().toISOString();this.update({ busy: false, stage: '',finishedAt:at,activities:mergeActivities(this.state.activities,[{id:crypto.randomUUID(),timestamp:at,revision:null,stage:'upload',kind:'process',status:'warning',message:'已取消上传'}]) }); }
    else try { this.send({ type: 'task.cancel', request_id: crypto.randomUUID() }); } catch (error) { this.failure(error); }
  }
  async reset() {
    const generation = ++this.generation;
    const oldSession = this.session;
    this.stopped = true;
    this.cleanupConnection();
    this.uploadAbort?.abort(); this.uploadAbort = null;
    this.session = null; this.activeId = null; this.snapshotId = null;this.canceledId=null;this.uploaded.clear(); this.retries = 0;
    this.state = initialState(); for (const listener of this.listeners) listener(this.state);
    if (oldSession) {
      try { await this.http('/api/sessions/current', { method: 'DELETE' }, oldSession); } catch { /* An expired session is already gone; reset still opens a fresh one. */ }
    }
    if (generation === this.generation) await this.open();
  }
  dispose() {
    ++this.generation; this.stopped = true;
    this.uploadAbort?.abort(); this.uploadAbort = null;
    this.cleanupConnection();
  }
}
