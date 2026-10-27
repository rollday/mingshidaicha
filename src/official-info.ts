import type {Config} from './config.ts';
import {AppError} from './errors.ts';
import {runPython} from './python.ts';
import {nfraDocId} from '../shared/official-source.ts';
export {nfraDocId} from '../shared/official-source.ts';

export type OfficialTable = {rows:string[][]};
export type OfficialDocument = {
  source_url:string; api_url:string|null; retrieved_at:string;
  status:'retrieved'|'unavailable'|'unsupported_source';
  title:string|null; published_at:string|null; agency:string|null; text:string;
  tables:OfficialTable[]; matched_rows:{table_index:number;row_index:number;headers:string[];cells:string[]}[];
  name_match:'subject_row'|'text_only'|'not_found';
  attachments:{title:string;url:string}[]; error_code?:string;
};
const normalize=(value:string)=>value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'');
function safeAttachment(value:unknown):string|null {
  if(typeof value!=='string')return null;
  try {const u=new URL(value,'https://www.nfra.gov.cn/');return u.protocol==='https:' && !u.username && !u.password && !u.port && (u.hostname==='nfra.gov.cn' || u.hostname.endsWith('.nfra.gov.cn')) ? u.href : null;}catch{return null;}
}
export function matchOfficialRows(tables:OfficialTable[],name:string):OfficialDocument['matched_rows'] {
  const needle=normalize(name);
  if(!needle)return [];
  return tables.flatMap((table,table_index)=>{
    const headerIndex=table.rows.findIndex(row=>row.some(cell=>/当事人名称|被处罚.*名称|行政处罚对象|机构名称|单位名称/.test(normalize(cell))));
    if(headerIndex<0)return [];
    const headers=table.rows[headerIndex]!;
    const index=headers.findIndex(cell=>/当事人名称|被处罚.*名称|行政处罚对象|机构名称|单位名称/.test(normalize(cell)));
    return table.rows.flatMap((cells,row_index)=>{
      const subject=normalize(cells[index]??'');
      const matches=subject===needle || subject===needle+'及相关责任人' || subject===needle+'及责任人';
      return row_index>headerIndex && matches ? [{table_index,row_index,headers,cells}] : [];
    });
  });
}
const cache=new Map<string,{expires:number;data:Record<string,unknown>;api_url:string;retrieved_at:string}>();
const MAX_BYTES=2*1024*1024;
export class OfficialInfoService {
  private settings:Config;
  private fetcher:typeof fetch;
  constructor(settings:Config,fetcher:typeof fetch=fetch){this.settings=settings;this.fetcher=fetcher;}
  async read(source:string,name:string,signal:AbortSignal):Promise<OfficialDocument>{
    const id=nfraDocId(source);
    const result:OfficialDocument={source_url:source,api_url:null,retrieved_at:new Date().toISOString(),status:id?'unavailable':'unsupported_source',title:null,published_at:null,agency:null,text:'',tables:[],matched_rows:[],name_match:'not_found',attachments:[]};
    if(!id)return result;
    try {
      if(signal.aborted)throw new AppError('TASK_CANCELLED','任务已取消。',499);
      let saved=cache.get(id);
      if(!saved || saved.expires<=Date.now()){
        saved=undefined;
        const urls=[`https://www.nfra.gov.cn/cbircweb/DocInfo/SelectByDocId?docId=${id}`,`https://www.nfra.gov.cn/cn/static/data/DocInfo/SelectByDocId/data_docId=${id}.json`];
        for(const api_url of urls){
          try {
            const response=await this.fetcher(api_url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),redirect:'error',headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});
            if(!response.ok || !response.body)throw new Error('upstream status');
            const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
            try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw new Error('upstream too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
            const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if(body.rptCode!==200 || !body.data || String(body.data.docId)!==id || typeof body.data.docClob!=='string')throw new Error('invalid official document');
            saved={expires:Date.now()+10*60*1000,data:body.data,api_url,retrieved_at:new Date().toISOString()};
            if(cache.size>=10)cache.delete(cache.keys().next().value!);
            cache.set(id,saved);break;
          }catch(error){if(signal.aborted)throw error;}
        }
        if(!saved)throw new Error('official source unavailable');
      }
      const data=saved.data;
      const parsed=await runPython(this.settings,'parse_official_html',{html:data.docClob},signal) as {text:string;tables:OfficialTable[]};
      result.status='retrieved';result.api_url=saved.api_url;result.retrieved_at=saved.retrieved_at;
      result.title=typeof data.docTitle==='string'?data.docTitle.slice(0,500):null;
      result.published_at=typeof data.publishDate==='string'?data.publishDate.slice(0,100):null;
      result.agency=typeof data.docSource==='string'?data.docSource.slice(0,300):null;
      result.text=parsed.text;result.tables=parsed.tables;
      result.matched_rows=matchOfficialRows(parsed.tables,name);
      result.name_match=result.matched_rows.length?'subject_row':normalize(name) && normalize(parsed.text).includes(normalize(name))?'text_only':'not_found';
      if(Array.isArray(data.attachmentInfoVOList)) for(const item of data.attachmentInfoVOList.slice(0,20)){
        const url=safeAttachment(item?.urlOtherName ?? item?.url);
        if(url)result.attachments.push({title:typeof item.title==='string'?item.title.slice(0,300):'官方附件',url});
      }
      if(Buffer.byteLength(JSON.stringify(result))>512*1024)throw new Error('document output too large');
    }catch(error){
      if(signal.aborted)throw new AppError('TASK_CANCELLED','任务已取消。',499);
      result.status='unavailable';result.text='';result.tables=[];result.matched_rows=[];result.name_match='not_found';result.attachments=[];
      result.error_code='OFFICIAL_SOURCE_UNAVAILABLE';
    }
    return result;
  }
}
