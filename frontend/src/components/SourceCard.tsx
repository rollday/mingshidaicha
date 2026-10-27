import { useEffect, useState } from 'react';
import { Button, Card, Tag } from './base/index.tsx';
import DocumentPage, {type PageLoader} from './DocumentPage.tsx';
import type { CaseSnapshot, DocumentParsed, Evidence } from '../types/audit.ts';
const roleNames = {disclosure:'明示表',contract:'借款合同',schedule:'还款计划',other:'其他材料'};
export function SourceCard({current,parsed,focused,loadPage}:{current:CaseSnapshot;parsed:Record<string,DocumentParsed>;focused:Evidence|null;loadPage:PageLoader}) {
  const [documentId,setDocumentId] = useState(current.materials[0]?.id ?? ''), [pageNumber,setPageNumber] = useState(1);
  useEffect(()=>{ if(focused) {setDocumentId(focused.document_id);setPageNumber(focused.page ?? 1);} },[focused]);
  const material = current.materials.find(item=>item.id===documentId);
  const page = material?.pages.find(item=>item.page===pageNumber);
  const layout = parsed[documentId]?.pages.find(item=>item.page===pageNumber);
  const focusOnPage = focused?.document_id === documentId && focused.page === pageNumber ? focused : null;
  const pages = material?.pages ?? [];
  const pageIndex = pages.findIndex(item=>item.page===pageNumber);
  return <Card id="source-card" className="flex min-w-0 scroll-mt-20 flex-col gap-4"><h2 className="text-lg font-medium">原文与依据</h2>
    {!current.materials.length ? <p className="py-6 text-sm text-mute">当前为手工录入，没有上传材料或原文依据。</p> : <>
      <select aria-label="查看哪份材料" value={documentId} onChange={event=>{setDocumentId(event.target.value);setPageNumber(1);}} className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm">{current.materials.map((item,index)=><option key={item.id} value={item.id}>{roleNames[item.role]} {index+1}{item.id==='text'?' · 粘贴文字':''}</option>)}</select>
      <div className="flex flex-wrap items-center justify-between gap-2"><Tag tone="neutral">第 {pageNumber} 页 / 共 {pages.length} 页</Tag><div className="flex gap-2"><Button variant="chip" disabled={pageIndex <= 0} onClick={()=>setPageNumber(pages[pageIndex-1]!.page)}>上一页</Button><Button variant="chip" disabled={pageIndex >= pages.length-1} onClick={()=>setPageNumber(pages[pageIndex+1]!.page)}>下一页</Button></div></div>
      {focusOnPage && <blockquote className="whitespace-pre-wrap break-words rounded-md border border-amber-line bg-amber-bg/50 p-4 text-sm">{focusOnPage.quote}</blockquote>}
      {documentId !== 'text' && <DocumentPage documentId={documentId} page={pageNumber} layout={layout} quote={focusOnPage?.source_type==='vision_transcript'?undefined:focusOnPage?.quote} loadPage={loadPage} />}
      {material?.vision && <p className="text-xs text-mute">含图像转录内容，请以原始页面为准；图像转录不提供文字坐标。</p>}
      {page && <details open={documentId==='text'} className="rounded-md border border-line bg-canvas p-4"><summary className="cursor-pointer text-sm">本页文字摘录</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-2xs">{page.text || '这一页没有可提取的文本。'}</pre></details>}
      {!focused && <p className="text-xs text-mute">点击字段旁的“查看依据”，可以定位对应原始页面。</p>}
    </>}
  </Card>;
}
export default SourceCard;
