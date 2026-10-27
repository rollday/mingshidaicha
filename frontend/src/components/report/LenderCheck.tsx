import {useEffect,useState} from 'react';
import type { AuditReport, CaseFacts } from '../../types/audit.ts';
import { triState } from '../../lib/format.ts';
import { Button, Card, Tag, Field,fieldInputClass } from '../base/index.tsx';

const lenderTypes: Record<CaseFacts['lender']['type'], string> = {
  bank: '银行', consumer_finance: '消费金融公司', microloan: '小额贷款公司',
  platform: '平台', other: '其他', unknown: '类型待确认',
};

export function LenderCheck({ report,busy,onSearch }: { report: AuditReport;busy:boolean;onSearch:(name:string)=>void }) {
  const lender = report.facts.lender;
  const [name,setName]=useState(lender.name ?? '');
  useEffect(()=>setName(lender.name ?? ''),[lender.name]);
  const result=report.public_source_search;
  const labels={license:'许可与持牌名单线索',registry:'企业登记公开页面',penalty:'监管处罚公开页面'};
  const rows = [
    ['是否有牌照', lender.licensed],
    ['是否涉及互联网消费贷款', lender.internet_consumer_loan],
    ['是否涉及互联网助贷', lender.internet_assisted],
  ] as const;
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">放贷方信息</h2><p className="text-sm text-mute">展示用户确认的主体信息与相关属性。</p></header>
      <Card padding="wide" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-serif text-xl font-medium">{lender.name ?? '主体名称待确认'}</h3>
          <Tag tone="blue">{lenderTypes[lender.type]}</Tag>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          {rows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-t border-line pt-3"><dt className="text-sm text-mute">{label}</dt><dd><Tag tone={value === true ? 'green' : value === false ? 'amber' : 'neutral'}>{triState(value)}</Tag></dd></div>)}
        </dl>
        <p className="border-t border-line pt-4 text-sm text-mute">以上是用户确认的主体资质，不等于系统已联网查验。</p>
        <div className="flex flex-col gap-3 border-t border-line pt-4"><h3 className="text-base font-medium">检索公开来源</h3><p className="text-sm text-mute">点击后会将机构名称发送给搜索服务，查找监管和企业登记公开页面。结果作为核实线索，不自动改变上方资质信息。</p><Field><input aria-label="公开检索的机构名称" className={fieldInputClass} value={name} maxLength={100} onChange={event=>setName(event.target.value)} placeholder="请输入合同上的完整机构名称" /></Field><Button disabled={busy || name.trim().length<2} onClick={()=>onSearch(name.trim())} className="self-start">检索公开来源</Button></div>
        {result && result.name===name.trim() && <div className="flex flex-col gap-4"><p className="text-xs text-mute">检索名称：{result.name} · {new Date(result.queried_at).toLocaleString('zh-CN')}</p>{result.categories.map(category=><div key={category.kind} className="rounded-md border border-line p-4"><h4 className="text-base font-medium">{labels[category.kind]}</h4><p className="mt-1 text-xs text-mute">{category.status==='sources_found'?'检索到公开页面，内容待核实':category.status==='unavailable'?'本次检索未完成，可重试':'未检索到相关索引页面；不代表没有相关资质或记录'}</p>{category.sources.map(source=><article key={source.url} className="mt-3 border-t border-line pt-3"><a href={source.url} target="_blank" rel="noreferrer" className="break-words text-sm text-blue underline">{source.title}</a><p className="mt-1 text-xs text-mute">{source.name_match?'摘要出现该名称，仍需核对主体':'摘要未出现完整名称，请核对是否为查询入口或其他主体'}</p>{source.snippet && <details className="mt-2"><summary className="cursor-pointer text-xs text-mute">查看检索摘要（未核验）</summary><p className="mt-2 whitespace-pre-wrap break-words text-2xs text-ink-soft">{source.snippet}</p></details>}</article>)}</div>)}<ul className="list-inside list-disc text-xs text-mute">{result.limitations.map(text=><li key={text}>{text}</li>)}</ul></div>}
        {result && result.name!==name.trim() && <p className="text-xs text-mute">名称已修改，请重新检索。报告数据保留上一次按“{result.name}”检索的记录。</p>}
      </Card>
    </section>
  );
}
