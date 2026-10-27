import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createBackend} from '../src/server.ts';
import {config} from '../src/config.ts';
import {locateHighlights} from '../frontend/src/lib/pdf.ts';
import type {DocumentParsed} from '../shared/audit.ts';

test('PDF highlighting preserves digits and uses displayed coordinates on rotated pages',()=>{
  const page:DocumentParsed['pages'][number]={page:1,width:200,height:300,rotation:90,text:'Principal 10000 yuan',blocks:[],words:[
    {text:'Principal',bbox:[1,2,3,4],display_bbox:[150,10,170,60]},
    {text:'10000',bbox:[3,4,5,6],display_bbox:[150,61,170,100]},
    {text:'yuan',bbox:[5,6,7,8],display_bbox:[150,101,170,130]},
  ]};
  const found=locateHighlights(page,'10000\nyuan');
  assert.equal(found.precision,'word');assert.equal(found.highlights.length,2);
  assert.equal(found.highlights[0]!.left,'75%');
  assert.deepEqual(found.highlights[0]!.box,[150,61,170,100]);
  assert.equal(locateHighlights(page,'10001 yuan').precision,'none');
  assert.equal(locateHighlights({...page,words:page.words!.map(({display_bbox,...word})=>word)},'10000').precision,'none');
});

test('page preview requires its owning session and renders bounded original pixels',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'viewer-test-'));
  const path=join(directory,'source.pdf');
  const generated=spawnSync(config.python,['-c',"import pymupdf,sys;d=pymupdf.open();p=d.new_page(width=300,height=200);p.insert_text((30,50),'Principal 10000 yuan');p.set_rotation(90);d.save(sys.argv[1]);d.close()",path]);
  assert.equal(generated.status,0);
  const backend=await createBackend({...config,apiKey:undefined});
  t.after(async()=>{await backend.close();await rm(directory,{recursive:true,force:true});});
  backend.server.listen(0,'127.0.0.1');await once(backend.server,'listening');
  const address=backend.server.address();assert(address && typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`;
  const session=await(await fetch(base+'/api/sessions',{method:'POST'})).json() as {session_token:string};
  const headers={'X-Session-Token':session.session_token};
  const upload=await fetch(base+'/api/documents',{method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:await readFile(path)});
  const {document_id}=await upload.json() as {document_id:string};
  const endpoint=base+`/api/documents/${document_id}/pages/1.png`;
  assert.equal((await fetch(endpoint)).status,401);
  const foreign=await(await fetch(base+'/api/sessions',{method:'POST'})).json() as {session_token:string};
  assert.equal((await fetch(endpoint,{headers:{'X-Session-Token':foreign.session_token}})).status,404);
  const response=await fetch(endpoint,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  const png=Buffer.from(await response.arrayBuffer());assert(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.equal(png.readUInt32BE(16),400);assert.equal(png.readUInt32BE(20),600);
  assert.equal((await fetch(base+`/api/documents/${document_id}/pages/2.png`,{headers})).status,422);
  await fetch(base+'/api/sessions/current',{method:'DELETE',headers});
  assert.equal((await fetch(endpoint,{headers})).status,401);
});
