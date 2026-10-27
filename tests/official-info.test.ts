import assert from 'node:assert/strict';
import test from 'node:test';
import {config} from '../src/config.ts';
import {OfficialInfoService,matchOfficialRows,nfraDocId} from '../src/official-info.ts';

const name='示例消费金融股份有限公司';
const page=(id:number)=>`https://www.nfra.gov.cn/branch/shenzhen/view/pages/common/ItemDetail.html?docId=${id}&itemId=1043`;
const signal=()=>new AbortController().signal;
const html=`<head><style>evil</style></head><table><tr><th>当事人名称</th><th>行政处罚内容</th></tr><tr><td>${name}及相关责任人</td><td>对机构罚款50万元</td></tr><tr><td>另一银行</td><td>罚款30万元</td></tr></table>`;
function response(id:number,extra:Record<string,unknown>={}) {
  return Response.json({rptCode:200,data:{docId:id,docTitle:'行政处罚公示',publishDate:'2025-12-31 16:21:00',docSource:'深圳金融监管局',docClob:html,...extra}});
}

test('official adapter accepts only known NFRA detail pages and numeric document IDs',()=>{
  assert.equal(nfraDocId(page(123)),'123');
  assert.equal(nfraDocId('http://nfra.gov.cn/cn/view/pages/ItemDetail.html?docId=123'),'123');
  for(const url of ['https://127.0.0.1/?docId=1','https://www.nfra.gov.cn.attacker.test/cn/view/pages/ItemDetail.html?docId=1','https://u:p@www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId=1',page(123)+'&docId=4',page(123).replace('123','../private'),page(123).replace('www.nfra.gov.cn','www.nfra.gov.cn:444'),'https://www.nfra.gov.cn/other?docId=1'])assert.equal(nfraDocId(url),null,url);
});

test('subject matching excludes mentions in other columns and branch or similar names',()=>{
  const tables=[{rows:[['当事人名称','内容'],[name,'50万元'],['另一银行',name],[name+'深圳分公司','30万元'],['其他'+name,'20万元'],[name+'及相关责任人','50万元']]}];
  assert.deepEqual(matchOfficialRows(tables,name).map(row=>row.row_index),[1,5]);
  assert.deepEqual(matchOfficialRows(tables,''),[]);
});

test('adapter reads JSON and Python table structure, preserving amounts and filtering attachments',async()=>{
  const requests:{url:string;init?:RequestInit}[]=[];
  const service=new OfficialInfoService(config,async(input,init)=>{
    requests.push({url:String(input),init});
    return response(900000001,{attachmentInfoVOList:[{title:'决定书',urlOtherName:'/file/public.pdf'},{title:'unsafe',url:'https://evil.test/a.pdf'},{url:'javascript:alert(1)'},null]});
  });
  const result=await service.read(page(900000001),name,signal());
  assert.equal(result.status,'retrieved');assert.equal(result.published_at,'2025-12-31 16:21:00');
  assert.equal(result.name_match,'subject_row');assert.equal(result.matched_rows.length,1);
  assert.deepEqual(result.matched_rows[0]?.cells,[name+'及相关责任人','对机构罚款50万元']);
  assert(!result.text.includes('evil'));assert.equal(result.tables[0]?.rows.length,3);
  assert.deepEqual(result.attachments,[{title:'决定书',url:'https://www.nfra.gov.cn/file/public.pdf'}]);
  assert.equal(requests[0]?.url,'https://www.nfra.gov.cn/cbircweb/DocInfo/SelectByDocId?docId=900000001');
  assert.equal(requests[0]?.init?.redirect,'error');
  assert.equal(new Headers(requests[0]?.init?.headers).has('Authorization'),false);
  const second=await service.read(page(900000001),'另一银行',signal());
  assert.equal(requests.length,1);assert.equal(second.retrieved_at,result.retrieved_at);
  assert.deepEqual(second.matched_rows[0]?.cells,['另一银行','罚款30万元']);
});

test('static fallback uses the same fixed official document ID and rejects mismatched JSON',async()=>{
  const urls:string[]=[];
  const service=new OfficialInfoService(config,async input=>{
    urls.push(String(input));return urls.length===1?response(123):response(900000002,{docClob:`<p>${name}出现在正文中</p>`});
  });
  const result=await service.read(page(900000002),name,signal());
  assert.equal(result.status,'retrieved');assert.equal(result.name_match,'text_only');
  assert.equal(urls[1],'https://www.nfra.gov.cn/cn/static/data/DocInfo/SelectByDocId/data_docId=900000002.json');
  assert.equal(result.api_url,urls[1]);
});

test('unsupported, unavailable and absent-name outcomes stay distinct and errors are generic',async()=>{
  let calls=0;
  const failed=new OfficialInfoService(config,async()=>{calls++;throw new Error('secret provider data');});
  assert.equal((await failed.read('https://www.gsxt.gov.cn/',name,signal())).status,'unsupported_source');assert.equal(calls,0);
  const result=await failed.read(page(900000003),name,signal());
  assert.equal(result.status,'unavailable');assert.equal(calls,2);assert.equal(result.error_code,'OFFICIAL_SOURCE_UNAVAILABLE');
  assert(!JSON.stringify(result).includes('secret'));
  const empty=new OfficialInfoService(config,async()=>response(900000004,{docClob:'<p>其他机构的公告</p>'}));
  const unmatched=await empty.read(page(900000004),name,signal());
  assert.equal(unmatched.status,'retrieved');assert.equal(unmatched.name_match,'not_found');
});

test('oversized API responses are bounded and cancellation is propagated',async()=>{
  const big=new OfficialInfoService(config,async()=>new Response('x'.repeat(2*1024*1024+1)));
  assert.equal((await big.read(page(900000005),name,signal())).status,'unavailable');
  const controller=new AbortController();controller.abort();
  await assert.rejects(big.read(page(900000005),name,controller.signal),{code:'TASK_CANCELLED'});
});
