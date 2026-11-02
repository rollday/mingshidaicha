import { useState } from 'react';
import { AccordionCard } from '../base/index.tsx';

const definitions = [
  ['明示年化', '明示表或借款材料中直接标注的年化数字；缺失时会显示未标注。'],
  ['名义年化', '材料自己标注的一种年化口径。只有与重算采用的口径一致时，两个百分比才能直接比较。'],
  ['重算年化', '根据已确认的到账、还款与费用现金流，按报告标明的口径计算的年化结果。'],
  ['差额（百分点）', '重算年化与披露年化之间的差值，单位是百分点；口径不明时不作数值比较。'],
  ['容差', '本工具判断两个年化数字是否需要提示的差异门槛，不是监管红线，也不是违法认定标准。'],
  ['表外费用', '材料中存在、但未列入明示表或未计入明示年化的正常履约费用；是否合规仍需结合合同和适用规则核实。'],
  ['借款成本（不含还本）', '还款计划合计与另付费用合计相加后，再减去实际到账；它不包含归还本金本身。'],
  ['或有费用', '是否发生取决于特定条件的费用，报告单独列示，不与常规费用混作一项。'],
  ['信息不足', '现有材料无法支持明确判断，需要补充信息；这不等同于未命中。'],
];

export function Glossary() {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">名词说明</h2>
      <AccordionCard title="查看报告中的常用说法" open={open} onToggle={() => setOpen(!open)}>
        <dl className="grid gap-4 sm:grid-cols-2">{definitions.map(([term, definition]) => <div key={term} className="flex flex-col gap-1"><dt className="text-sm font-medium">{term}</dt><dd className="text-sm text-mute">{definition}</dd></div>)}</dl>
      </AccordionCard>
    </section>
  );
}
