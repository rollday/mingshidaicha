import { Card, Tag } from './base/index.tsx';
import type { CaseSnapshot, DocumentParsed, Evidence } from '../types/audit.ts';

export function SourceCard({ current, parsed, focused }: { current: CaseSnapshot; parsed: Record<string, DocumentParsed>; focused: Evidence | null }) {
  const materials = focused ? current.materials.filter(material => material.id === focused.document_id) : current.materials;
  return <Card id="source-card" className="flex min-w-0 scroll-mt-20 flex-col gap-4"><h2 className="text-lg font-medium">原文与依据</h2>
    {focused && <div className="rounded-md border border-amber-line bg-amber-bg/50 p-4"><p className="mb-2 text-xs text-amber">当前核对依据 · 第 {focused.page ?? '未知'} 页</p><blockquote className="whitespace-pre-wrap break-words text-sm">{focused.quote}</blockquote><p className="mt-2 text-xs text-mute">{focused.source_type === 'vision_transcript' ? '图像转录文字，请对照原图确认。' : '引文可定位到材料页码，请对照原始材料核对。'}</p></div>}
    {!materials.length && <p className="py-6 text-sm text-mute">当前为手工录入，没有上传材料或原文依据。</p>}
    {materials.map(material => <div key={material.id} className="flex min-w-0 flex-col gap-3"><div className="flex flex-wrap gap-2"><Tag tone="neutral">{{ disclosure:'明示表', contract:'借款合同', schedule:'还款计划', other:'其他材料' }[material.role]}</Tag>{material.vision && <Tag tone="amber">含图像识别内容</Tag>}</div>{material.pages.filter(page => !focused?.page || page.page === focused.page).map(page => <details key={page.page} open={Boolean(focused)} className="rounded-md border border-line bg-canvas p-4"><summary className="cursor-pointer text-sm">第 {page.page} 页{parsed[material.id]?.pages.find(p => p.page === page.page)?.blocks.length ? ' · 文本已解析' : ''}</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-2xs">{page.text || '这一页没有可提取的文本。'}</pre></details>)}</div>)}
    {!focused && current.evidence.length > 0 && <p className="text-xs text-mute">点击字段旁的“查看依据”，可以定位对应材料和页码。</p>}
  </Card>;
}
export default SourceCard;
