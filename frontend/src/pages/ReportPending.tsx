import ProcessFold from '../components/ProcessFold.tsx';
import type { CaseState } from '../lib/case-client.ts';

export default function ReportPending({ state, onCancel }: { state: CaseState; onCancel: () => void }) {
  return (
    <section className="animate-rise">
      <h1 className="font-serif text-display font-bold">正在生成你的报告</h1>
      <p className="mt-3 text-ink-soft">完成后会自动显示报告。你也可以取消并返回核对页修改。</p>
      <div className="mt-6">
        <ProcessFold state={state} onCancel={onCancel} showCancel />
      </div>
    </section>
  );
}
