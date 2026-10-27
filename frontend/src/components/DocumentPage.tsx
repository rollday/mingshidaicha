import { useEffect, useState } from 'react';
import { Button } from './base/index.tsx';
import { locateHighlights } from '../lib/pdf.ts';
import type { DocumentParsed } from '../types/audit.ts';
export type PageLoader = (documentId:string,page:number,signal:AbortSignal)=>Promise<Blob>;
export default function DocumentPage({documentId,page,layout,quote,loadPage}:{documentId:string;page:number;layout?:DocumentParsed['pages'][number];quote?:string;loadPage:PageLoader}) {
  const [url,setUrl] = useState<string|null>(null), [error,setError] = useState(''), [attempt,setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let objectUrl:string|undefined;
    setUrl(null);setError('');
    void loadPage(documentId,page,abort.signal).then(blob => { if (abort.signal.aborted) return; objectUrl=URL.createObjectURL(blob);setUrl(objectUrl); }).catch(error => { if (!abort.signal.aborted) setError((error as Error).message || '页面预览暂不可用。'); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  },[documentId,page,loadPage,attempt]);
  const match = layout && quote ? locateHighlights(layout,quote) : null;
  return <div className="flex flex-col gap-3">
    {error ? <div className="rounded-md border border-line bg-canvas p-4 text-sm"><p>{error}</p><p className="mt-2 text-mute">仍可展开下方文字摘录核对。</p><Button className="mt-3" onClick={()=>setAttempt(value=>value+1)}>重试页面预览</Button></div> : !url ? <div role="status" aria-busy="true" className="flex min-h-64 items-center justify-center rounded-md bg-canvas text-sm text-mute animate-skeleton">正在打开原始页面…</div> : <div className="relative overflow-hidden rounded-md border border-line bg-surface"><img src={url} alt={`材料原始页面，第${page}页`} className="block h-auto w-full" />{match?.highlights.map((item,index)=><span key={index} data-pdf-highlight className="pointer-events-none absolute border border-amber-line bg-amber-line/30" style={{left:item.left,top:item.top,width:item.width,height:item.height}} />)}</div>}
    {quote && <p className="text-xs text-mute">{match?.precision === 'word' ? `已标出原文匹配位置${match.occurrences > 1 ? '，存在多处相同文本，请逐一核对' : ''}。` : match?.precision === 'block' ? '已标出相关文本块，请对照引文核对。' : '本页没有可可靠定位的文字坐标，请对照图像和摘录核对。'}</p>}
  </div>;
}
