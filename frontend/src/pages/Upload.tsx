import { useRef, useState } from 'react';
import { Button, Card } from '../components/base/index.tsx';
import type { CaseState } from '../lib/case-client.ts';
import { guessMaterialRole, type MaterialRole } from '../lib/upload-roles.ts';
import type { Mode, Sample } from '../types/audit.ts';

type SelectedFile = { file: File; role: MaterialRole };
const stageNames: Record<string, string> = { upload: '上传材料', parse_pdf: '读取 PDF 文本', read_images: '识别图片内容', extract_case: '抽取并对齐事实', prepare_review: '准备核对信息', calculate: '生成现金流并核算', check_rules: '对照检查项', write_report: '撰写报告' };

export function LoadingSteps({ stage, onCancel }: { stage: string; onCancel: () => void }) {
  return <div role="status" aria-live="polite" className="flex flex-col gap-5 py-6"><p className="text-lg font-medium">{stageNames[stage] ?? '正在处理材料'}…</p><p className="text-sm text-mute">处理记录与已完成的结果会持续显示在上方。</p><Button onClick={onCancel} className="self-start">取消本次任务</Button></div>;
}

export function UploadDropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="relative flex flex-col items-stretch gap-4 rounded-lg border-[1.5px] border-dashed border-line-strong bg-canvas px-[22px] py-5 text-left" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!disabled) onFiles([...event.dataTransfer.files]); }}>
    <span aria-hidden="true" className="pointer-events-none absolute left-2 top-2 size-4 rounded-tl-sm border-l border-t border-blue/30" />
    <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 size-4 rounded-br-sm border-b border-r border-blue/30" />
    <div className="flex min-w-0 items-start gap-4">
      <svg className="size-9 shrink-0 text-mute" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M11 5h13l7 7v23H11zM24 5v7h7" stroke="currentColor" strokeWidth="1.5" /><path className="text-blue" d="M21 29V17m0 0-5 5m5-5 5 5" stroke="currentColor" strokeWidth="1.5" /></svg>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-medium">拖入明示表、合同或还款计划</h2>
        <p className="mt-1 text-sm text-mute">PDF / JPG / PNG，最多五份，每份不超过 10MB；也可以直接粘贴文字</p>
      </div>
    </div>
    <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" className="sr-only" aria-label="选择贷款材料" disabled={disabled} onChange={event => { onFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
    <Button disabled={disabled} onClick={() => input.current?.click()} className="self-center whitespace-nowrap">选择文件</Button>
  </div>;
}

export function SampleList({ samples, onPick, disabled }: { samples: Sample[]; onPick: (sample: Sample) => void; disabled: boolean }) {
  return <div className="grid gap-3">{samples.map(sample => <Button key={sample.id} variant="sample" disabled={disabled} onClick={() => onPick(sample)} className="relative pr-9"><span className="text-xs text-mute">{sample.id} · 模拟材料</span><span className="text-base font-medium">{sample.name}</span><span className="text-2xs text-mute">{sample.description}</span><svg className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-mute" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9m0 0-3-3m3 3-3 3" stroke="currentColor" strokeWidth="1.3" /></svg></Button>)}</div>;
}

export function FeeSliderCard({ onDemo, disabled }: { onDemo: (fee: string) => void; disabled: boolean }) {
  const [fee, setFee] = useState('50');
  return <Card padding="none" className="flex flex-col gap-2.5 p-5"><div className="flex flex-wrap items-center gap-2"><span className="inline-flex h-5 items-center rounded border border-line bg-canvas px-1.5 text-2xs text-mute">示例</span><h2 className="text-base font-medium">表外费用，有多贵？</h2></div><p className="text-xs text-mute">1 万元 · 12 期 · 每期 888.49 元 · 名义年化 12%</p><label htmlFor="demo-fee" className="text-sm">每期另收 <b className="num">{fee}</b> 元服务费</label><input id="demo-fee" type="range" min="0" max="100" step="5" value={fee} aria-valuetext={`每期另收 ${fee} 元服务费`} onChange={event => setFee(event.target.value)} disabled={disabled} className="w-full accent-blue" /><Button disabled={disabled} onClick={() => onDemo(fee)} className="self-start whitespace-nowrap">试算这笔费用<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.5" /></svg></Button></Card>;
}

const flowTone = {
  blue: 'border-blue/25 bg-blue/10 text-blue',
  amber: 'border-amber-line/30 bg-amber-bg/50 text-amber-line',
  green: 'border-green/25 bg-green/10 text-green',
};

const flowSteps = [
  {
    title: '上传材料',
    description: '明示表、合同或还款计划',
    tone: 'blue',
    icon: <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.5V4.5m0 0-4.2 4.2m4.2-4.2 4.2 4.2" stroke="currentColor" strokeWidth="1.5" /><path d="M4.5 15v3.2A1.8 1.8 0 0 0 6.3 20h11.4A1.8 1.8 0 0 0 19.5 18.2V15" stroke="currentColor" strokeWidth="1.5" /></svg>,
  },
  {
    title: '核对关键字段',
    description: '金额、期数、费率逐项确认',
    tone: 'amber',
    icon: <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="M14.8 14.8 20 20" stroke="currentColor" strokeWidth="1.5" /><path d="M8 10.5h5M8 13h3" stroke="currentColor" strokeWidth="1.3" /></svg>,
  },
  {
    title: '看报告，问清楚',
    description: '结论、问题与原文依据',
    tone: 'green',
    icon: <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5h16v11H9.5L5 20v-3.5H4z" stroke="currentColor" strokeWidth="1.4" /><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" strokeWidth="1.2" /></svg>,
  },
] as const;

export function FlowBand() {
  return <section aria-label="使用流程" className="grid grid-cols-1 min-[900px]:grid-cols-3">{flowSteps.map((step, index) => <div key={step.title} className={['relative flex flex-row items-start gap-3 px-1 py-4 min-[900px]:flex-col min-[900px]:items-center min-[900px]:px-5 min-[900px]:py-5 min-[900px]:text-center', index > 0 ? 'border-t border-line min-[900px]:border-t-0 min-[900px]:border-l' : ''].filter(Boolean).join(' ')}>
    <span className={`flex size-10 shrink-0 items-center justify-center rounded-md border ${flowTone[step.tone]}`}>{step.icon}</span>
    <div className="flex min-w-0 flex-1 flex-col items-start min-[900px]:flex-none min-[900px]:items-center"><span className="hidden text-xs tracking-[.15em] text-mute min-[900px]:block">STEP 0{index + 1}</span><h3 className="m-0 text-base font-semibold leading-snug">{step.title}</h3><p className="m-0 max-w-56 text-xs leading-relaxed text-mute">{step.description}</p></div>
    {index < flowSteps.length - 1 && <span aria-hidden="true" className="absolute -right-2.5 top-1/2 hidden size-5 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-canvas text-mute min-[900px]:flex"><svg className="size-2.5" viewBox="0 0 12 12" fill="none"><path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="1.4" /></svg></span>}
  </div>)}</section>;
}

const faqs = [
  ['这算法律意见或借贷建议吗？', '不算。你可以把我们当成一个「帮你核对数字和条款的小工具」，我们只做三件事：把材料里的数字挑出来、用同一套算法重新算一遍、把监管规定和你的材料一条条对起来看。至于合不合法、这笔钱该不该借，我们不作判断。报告里只摆出能核对清楚的事实差异，不算法律意见，也不算借贷建议。'],
  ['我的材料会被保存吗？', '不会长期留存，但也不是你一关网页就立刻没了。文件只在当前这次使用期间临时放着，大概在你停止操作 15 分钟后，后台会自动清理掉。另外，为了读取文件里的内容，上传的材料会发给配置好的模型服务去识别。为了保护隐私，建议上传前先把身份证号、银行卡号、手机号涂掉；如果你现在用的是演示环境，请千万别传真实合同。'],
  ['为什么还要我自己确认一遍？', '因为机器看材料也难免会看走眼。金额、期数、费率这些关键信息，旁边都会标出它们在原文里的出处。标成橙色，只是提醒你「这一项最好对照原文再多看一眼」，并不代表模型对这行字有多大把握（置信度）。你手动改过的每一处，系统都会原原本本地记进报告的「更正记录」里。'],
  ['「待核实」是什么意思？', '就是材料里没把话说透，或者同一句话怎么理解都说得通。遇到这种情况，我们不会替你瞎猜，而是直接告诉你「这里缺了什么信息」，顺便说明你可以怎么去问清楚。'],
  ['报告里的数字是怎么来的？', '我们把合同里写好的每期要还多少钱、收多少费用列成一笔笔明细（也就是现金流），然后按照明示表上写明的算法重新算一遍，包括名义年化、复利年化、单利年化，或者按实际日期算的年化。如果合同里没写清用的是哪种算法，我们就把几种算法的结果各自算出来给你看，不会硬按同一种算法去比。另外放心，所有数字都是程序代码算出来的，模型只负责「读懂材料」和「解释给你听」，不负责算数。'],
  ['已经签了合同还能用吗？', '可以。已经签了的合同，正适合拿来对比「表面上写着多少」和「实际总共要付多少」之间差了多少。不过要注意，实际扣了多少钱、有没有逾期记录，这些都得看你的真实账单，光看合同是查不出来的——这一点报告里也会专门写明。'],
] as const;

export function Faq() {
  return <section aria-labelledby="faq-title" className="mt-10 max-w-[680px]"><Card><h2 id="faq-title" className="flex items-center gap-3 font-serif text-lg font-bold"><span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface font-sans text-sm font-semibold text-blue">?</span>常见问题</h2><div className="mt-4">{faqs.map(([question, answer], index) => <details key={question} className={`group border-t border-line ${index === faqs.length - 1 ? 'border-b' : ''}`}><summary className="flex cursor-pointer list-none items-center gap-3 py-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden"><span className="w-5 shrink-0 text-xs text-mute num">{String(index + 1).padStart(2, '0')}</span><span className="flex-1">{question}</span><span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-mute transition-transform duration-300 group-open:rotate-180"><svg className="size-3" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" /></svg></span></summary><p className="mb-4 pl-8 text-sm text-ink-soft">{answer}</p></details>)}</div></Card></section>;
}

export default function Upload({ state, mode, onStart, onManual, onDemo, onCancel }: { state: CaseState; mode: Mode; onStart: (files: SelectedFile[], text: string, purpose: string) => void; onManual: () => void; onDemo: (fee: string) => void; onCancel: () => void }) {
  const [files, setFiles] = useState<SelectedFile[]>([]), [text, setText] = useState(''), [purpose, setPurpose] = useState(''), [error, setError] = useState('');
  const ready = state.connection === 'ready' && !state.busy;
  const samples = state.samples.filter(sample => sample.context.is_student === (mode === 'student'));
  const addFiles = (incoming: File[]) => {
    if (incoming.some(file => file.size > 10485760 || !/\.(pdf|jpe?g|png)$/i.test(file.name))) { setError('请选择 10MB 以内的 PDF、PNG 或 JPG 文件。'); return; }
    if (incoming.length + files.length > 5) { setError('每次最多提交五份材料。'); return; }
    setError(''); setFiles([...files, ...incoming.map(file => ({ file, role: guessMaterialRole(file.name) }))]);
  };
  return <section className="animate-rise"><h1 className="font-serif text-display font-bold">{mode === 'student' ? '先看清这笔学生贷，再决定借不借。' : <>借一笔钱，<br className="sm:hidden" />先看清要还多少。</>}</h1><p className="mt-3 max-w-3xl text-base text-ink-soft">{mode === 'student' ? '校园贷、培训分期、互联网消费贷，规则不一样；先把本金、还款和额外费用摊开。' : '把明示表和合同放在一起，核对本金、还款与额外费用。'}</p><div className="mt-6 grid items-stretch gap-6 sm:grid-cols-3">
    <div className="flex min-w-0 flex-col gap-5 sm:col-span-2">
      <Card className="flex min-w-0 flex-1 flex-col gap-5">
        {state.busy ? <LoadingSteps stage={state.stage} onCancel={onCancel} /> : <><UploadDropzone onFiles={addFiles} disabled={!ready} />
          {error && <p role="alert" className="text-sm text-ink-soft">{error}</p>}
          {files.map((item, index) => <div key={`${item.file.name}-${index}`} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3"><span className="min-w-0 flex-1 break-all text-sm">{item.file.name}</span><select className="min-h-10 rounded-md border border-line-strong bg-surface px-2 text-sm" title="先按文件名猜的类型，猜得不对可以改" aria-label={`${item.file.name}的材料类型`} value={item.role} onChange={event => setFiles(files.map((file, i) => i === index ? { ...file, role: event.target.value as MaterialRole } : file))}>{[['other', '材料类型待确认'], ['disclosure', '明示表'], ['contract', '借款合同'], ['schedule', '还款计划']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button variant="chip" onClick={() => setFiles(files.filter((_, i) => i !== index))}>移除</Button></div>)}
          {files.length > 0 && <p className="text-2xs text-mute">材料类型先按文件名猜，猜错了直接改下拉。</p>}
          <details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm text-ink-soft">或粘贴材料文字</summary><textarea className="mt-3 min-h-32 w-full rounded-md border border-line-strong bg-surface p-3 text-sm focus:border-blue" aria-label="材料文字" placeholder="粘贴明示表或合同中的完整相关段落" value={text} onChange={event => setText(event.target.value)} /></details>
          <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={!ready || (!files.length && !text.trim())} onClick={() => onStart(files, text, purpose)}>读取材料</Button><Button disabled={!ready} onClick={onManual}>手工填写</Button></div>
        </>}
        <div className="flex flex-1 items-center border-t border-line pt-2 [&>section]:w-full"><FlowBand /></div>
        <p className="border-t border-line pt-4 text-2xs text-mute">请优先使用模拟材料。上传内容会发送给配置的模型服务；文件在本次会话临时保存，15 分钟无操作后清理。</p>
      </Card>
    </div>
    <aside className="flex min-w-0 flex-col gap-4">
      {samples.length > 0 && <Card className="flex flex-col gap-3"><h2 className="text-base font-medium text-mute">{mode === 'student' ? '学生场景样本' : '没有材料？先用模拟样本。'}</h2><SampleList samples={samples} disabled={!ready} onPick={sample => { setText(sample.text); setPurpose(sample.context.purpose); setFiles([]); onStart([], sample.text, sample.context.purpose); }} /></Card>}
      <FeeSliderCard onDemo={onDemo} disabled={!ready} />
    </aside>
  </div><Faq /><p className="mt-5 text-2xs text-mute">结果供材料核对使用，不参与借贷决策。</p></section>;
}
