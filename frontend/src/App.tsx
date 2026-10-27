import { useEffect, useState } from 'react';
import AppHeader from './components/AppHeader.tsx';
import StepTrail from './components/StepTrail.tsx';
import { Button, Card } from './components/base/index.tsx';
import Upload from './pages/Upload.tsx';
import Confirm from './pages/Confirm.tsx';
import Report from './pages/Report.tsx';
import DevPreview from './pages/DevPreview.tsx';
import { useCase } from './lib/use-case.ts';
import type { Mode } from './types/audit.ts';

function Workflow() {
  const { state, client } = useCase();
  const [mode, setMode] = useState<Mode>('general');
  const student = mode === 'student';
  useEffect(() => { window.scrollTo(0,0); }, [state.screen]);
  return <><AppHeader mode={mode} onModeChange={setMode} locked={state.screen !== 'upload' || state.busy} /><main className="mx-auto max-w-page px-gutter pb-12 pt-7"><StepTrail current={state.screen} />
    {state.connection !== 'ready' && <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-4 text-sm text-mute">{state.connection === 'connecting' ? '正在连接服务…' : '服务连接已断开。'}{state.connection === 'offline' && <Button onClick={() => void client.open()}>重新连接</Button>}</div>}
    {state.error && <Card inset className="mb-5" role="alert"><p className="text-base font-medium">这一步没有完成</p><p className="mt-1 text-sm text-ink-soft">{state.error.message}</p><code className="text-xs text-mute">{state.error.code}</code>{state.error.code === 'UNAUTHORIZED' && <Button className="ml-3" onClick={() => void client.reset()}>新建会话</Button>}</Card>}
    {state.warning && <Card inset tone="amber" className="mb-5" role="status"><p className="text-sm">{state.warning}</p></Card>}
    {state.screen === 'upload' && <Upload state={state} mode={mode} onStart={(files,text,purpose) => void client.start(files,text,student,purpose)} onManual={() => client.manual(student)} onDemo={fee => client.demo(fee,student)} onCancel={() => client.cancel()} />}
    {state.screen === 'confirm' && state.current && <Confirm key={state.current.case_id + ':' + state.current.revision} current={state.current} parsed={state.parsed} busy={state.busy} stage={state.stage} onConfirm={facts => client.confirm(facts)} onReset={() => void client.reset()} onCancel={() => client.cancel()} loadPage={client.previewDocument} />}
    {state.screen === 'report' && state.current?.report && <Report report={state.current.report} busy={state.busy} stage={state.stage} onBack={() => client.update({ screen: 'confirm', error: null })} onReset={() => void client.reset()} onRetry={() => client.retryReport()} onSearch={name=>client.searchLender(name)} onCancel={()=>client.cancel()} onReadOfficial={url=>client.readOfficial(url)} />}
    <footer className="mt-10 border-t border-line pt-5 text-xs text-mute">明示贷查 · 材料核对工具<span className="mx-2">/</span>基于现有材料与用户确认事实生成结果。</footer>
  </main></>;
}
export default function App() { return location.pathname === '/dev/components' ? <DevPreview /> : <Workflow />; }
