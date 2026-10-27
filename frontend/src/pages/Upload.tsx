import { useRef, useState } from 'react';
import { Button, Card, Field, fieldInputClass } from '../components/base/index.tsx';
import type { CaseState } from '../lib/case-client.ts';
import type { Mode, Sample } from '../types/audit.ts';

type SelectedFile = { file: File; role: 'disclosure' | 'contract' | 'schedule' | 'other' };
const stageNames: Record<string, string> = { upload: '上传材料', parse_pdf: '读取 PDF 文本', read_images: '识别图片内容', extract_case: '抽取并对齐事实', prepare_review: '准备核对信息', calculate: '生成现金流并核算', check_rules: '对照检查项', write_report: '撰写报告' };
export function LoadingSteps({ stage, onCancel }: { stage: string; onCancel: () => void }) {
  return <div role="status" aria-live="polite" className="flex flex-col gap-5 py-6"><p className="text-lg font-medium">{stageNames[stage] ?? '正在处理材料'}…</p><div className="h-2 overflow-hidden rounded-sm bg-line"><div className="h-full w-3/5 animate-skeleton rounded-sm bg-blue" /></div><p className="text-sm text-mute">读取材料 → 抽取事实 → 等你核对。文件较长或是照片时会更久。</p><Button onClick={onCancel} className="self-start">取消本次任务</Button></div>;
}
export function UploadDropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <Card variant="dropzone" className="relative flex flex-col items-center gap-3 text-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!disabled) onFiles([...event.dataTransfer.files]); }}>
    <svg className="size-10 text-mute" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M11 5h13l7 7v23H11zM24 5v7h7" stroke="currentColor" strokeWidth="1.5" /><path className="text-blue" d="M21 29V17m0 0-5 5m5-5 5 5" stroke="currentColor" strokeWidth="1.5" /></svg>
    <h2 className="text-lg font-medium">拖入明示表、借款合同</h2><p className="text-sm text-mute">PDF / JPG / PNG，最多五份，每份不超过 10MB</p>
    <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" className="sr-only" aria-label="选择贷款材料" disabled={disabled} onChange={event => { onFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
    <Button disabled={disabled} onClick={() => input.current?.click()}>选择文件</Button>
  </Card>;
}
export function SampleList({ samples, onPick, disabled }: { samples: Sample[]; onPick: (sample: Sample) => void; disabled: boolean }) {
  return <div><p className="mb-3 text-sm text-mute">手边没有材料？从一份自建模拟样本开始。</p><div className="grid gap-3 sm:grid-cols-2">{samples.map(sample => <Button key={sample.id} variant="sample" disabled={disabled} onClick={() => onPick(sample)}><span className="text-xs text-mute">{sample.id} · 模拟材料</span><span className="text-base font-medium">{sample.name}</span><span className="text-2xs text-mute">{sample.description}</span></Button>)}</div></div>;
}
export function FeeSliderCard({ onDemo, disabled }: { onDemo: (fee: string) => void; disabled: boolean }) {
  const [fee, setFee] = useState('50');
  return <Card padding="lg" className="flex flex-col gap-4"><h2 className="text-lg font-medium">表外多收一点，有多贵？</h2><p className="text-sm text-mute">试算条件：借款 1 万元，按月还 12 期，每期本息 888.49 元，标注名义年化 12%。</p><label htmlFor="demo-fee" className="text-base">每期另收 <b className="num">{fee}</b> 元服务费</label><input id="demo-fee" type="range" min="0" max="100" step="5" value={fee} onChange={event => setFee(event.target.value)} disabled={disabled} className="w-full accent-blue" /><p className="font-serif text-xl font-bold">先核对，再算清</p><p className="text-sm text-ink-soft">按实际到账、还款和额外费用核算，结果会在确认后的报告中展示。</p><Button disabled={disabled} onClick={() => onDemo(fee)}>用这组数据试算</Button></Card>;
}
export default function Upload({ state, mode, onStart, onManual, onDemo, onCancel }: { state: CaseState; mode: Mode; onStart: (files: SelectedFile[], text: string, purpose: string) => void; onManual: () => void; onDemo: (fee: string) => void; onCancel: () => void }) {
  const [files, setFiles] = useState<SelectedFile[]>([]), [text, setText] = useState(''), [purpose, setPurpose] = useState(''), [error, setError] = useState('');
  const ready = state.connection === 'ready' && !state.busy;
  const addFiles = (incoming: File[]) => {
    if (incoming.some(file => file.size > 10485760 || !/\.(pdf|jpe?g|png)$/i.test(file.name))) { setError('请选择 10MB 以内的 PDF、PNG 或 JPG 文件。'); return; }
    if (incoming.length + files.length > 5) { setError('每次最多提交五份材料。'); return; }
    setError(''); setFiles([...files, ...incoming.map(file => ({ file, role: 'other' as const }))]);
  };
  return <section className="animate-rise"><h1 className="font-serif text-display font-bold">借一笔钱，先看清要还多少。</h1><p className="mt-3 max-w-3xl text-base text-ink-soft">把明示表和合同放在一起，核对本金、还款与额外费用。每个判断，都留有可以回看的依据。</p><div className="mt-6 grid items-start gap-6 sm:grid-cols-3"><Card padding="lg" className="flex min-w-0 flex-col gap-5 sm:col-span-2">
    {state.busy ? <LoadingSteps stage={state.stage} onCancel={onCancel} /> : <><UploadDropzone onFiles={addFiles} disabled={!ready} />
      {error && <p role="alert" className="text-sm text-ink-soft">{error}</p>}
      {files.map((item, index) => <div key={index} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3"><span className="min-w-0 flex-1 break-all text-sm">{item.file.name}</span><select className="min-h-10 rounded-md border border-line-strong bg-surface px-2 text-sm" aria-label={`${item.file.name}的材料类型`} value={item.role} onChange={event => setFiles(files.map((file, i) => i === index ? { ...file, role: event.target.value as SelectedFile['role'] } : file))}>{[['other','材料类型待确认'],['disclosure','明示表'],['contract','借款合同'],['schedule','还款计划']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><Button variant="chip" onClick={() => setFiles(files.filter((_, i) => i !== index))}>移除</Button></div>)}
      <details><summary className="cursor-pointer text-sm text-ink-soft">或粘贴材料文字</summary><textarea className="mt-3 min-h-32 w-full rounded-md border border-line-strong bg-surface p-3 text-sm focus:border-blue" aria-label="材料文字" placeholder="粘贴明示表或合同中的完整相关段落" value={text} onChange={event => setText(event.target.value)} /></details>
      <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={!ready || (!files.length && !text.trim())} onClick={() => onStart(files, text, purpose)}>读取材料</Button><Button disabled={!ready} onClick={onManual}>手工填写</Button></div>
      <SampleList samples={state.samples.filter(sample => sample.context.is_student === (mode === 'student'))} disabled={!ready} onPick={sample => { setText(sample.text); setPurpose(sample.context.purpose); setFiles([]); onStart([], sample.text, sample.context.purpose); }} />
    </>}
    <p className="border-t border-line pt-4 text-2xs text-mute">请优先使用模拟材料。上传内容会发送给配置的模型服务；文件在本次会话临时保存，15 分钟无操作后清理。</p>
  </Card><FeeSliderCard onDemo={onDemo} disabled={!ready} /></div><p className="mt-5 text-2xs text-mute">结果供材料核对使用，不参与借贷决策。</p></section>;
}
