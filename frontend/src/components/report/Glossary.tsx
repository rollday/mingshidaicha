import { useState } from 'react';
import { AccordionCard } from '../base/index.tsx';

const definitions = [
  ['披露年化', '材料中标注的年化数字和计算口径；缺失时会显示未标注。'],
  ['重算年化', '根据已确认的到账、还款与费用现金流，按报告标明的口径计算的年化结果。'],
  ['差额（百分点）', '重算年化与披露年化之间的差值，单位是百分点；口径不明时不作数值比较。'],
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
