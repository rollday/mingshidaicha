export default function StepTrail({ current }: { current: 'upload' | 'confirm' | 'report' }) {
  const steps = [['upload', '上传材料'], ['confirm', '核对信息'], ['report', '查看报告']];
  const index = steps.findIndex(([key]) => key === current);
  return <ol aria-label="核查进度" className="mb-7 flex flex-wrap gap-4 text-sm sm:gap-7">{steps.map(([key, label], i) => <li key={key} aria-current={key === current ? 'step' : undefined} className={`flex items-center gap-2 ${i <= index ? 'text-ink' : 'text-mute'}`}><span className={`flex size-6 items-center justify-center rounded-full text-xs ${i <= index ? 'bg-ink text-surface' : 'bg-line text-mute'}`}>{i + 1}</span>{label}</li>)}</ol>;
}
