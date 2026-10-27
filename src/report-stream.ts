import type {DraftSection} from '../shared/progress.ts';

/** A bounded read-only JSON-prefix scanner. Only narrative fields are exposed. */
export function reportPrefix(raw:string):DraftSection[] {
  const values=new Map<string,string|null>();let cursor=0;
  const space=()=>{while(/\s/.test(raw[cursor]??'') && cursor<raw.length)cursor++;};
  const string=():{text:string;complete:boolean}=>{
    cursor++;let text='';
    while(cursor<raw.length){
      let char=raw[cursor++]!;
      if(char==='"')return {text,complete:true};
      if(char==='\\'){
        if(cursor>=raw.length)break;
        const escaped=raw[cursor++]!;
        if(escaped==='u'){
          const hex=raw.slice(cursor,cursor+4);if(!/^[0-9a-fA-F]{4}$/.test(hex))break;
          char=String.fromCharCode(parseInt(hex,16));cursor+=4;
        }else{
          const escapedChars:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
          if(!(escaped in escapedChars))break;char=escapedChars[escaped]!;
        }
      }else if(char<' ')break;
      if(text.length<4000)text+=char;
    }
    return {text:text.replace(/[\uD800-\uDBFF]$/,''),complete:false};
  };
  const value=(path:string[],depth:number):boolean=>{
    if(depth>8 || values.size>=128)return false;
    space();const char=raw[cursor];
    if(char==='"'){const result=string();values.set(path.join('.'),result.text);return result.complete;}
    if(char==='{'){
      cursor++;space();if(raw[cursor]==='}'){cursor++;return true;}
      for(let count=0;count<20;count++){
        space();if(raw[cursor]!=='"')return false;
        const key=string();if(!key.complete)return false;
        space();if(raw[cursor++]!==':')return false;
        if(!value([...path,key.text],depth+1))return false;
        space();if(raw[cursor]==='}'){cursor++;return true;}if(raw[cursor++]!==',')return false;
      }
      return false;
    }
    if(char==='['){
      cursor++;space();if(raw[cursor]===']'){cursor++;return true;}
      for(let index=0;index<20;index++){
        if(!value([...path,String(index)],depth+1))return false;
        space();if(raw[cursor]===']'){cursor++;return true;}if(raw[cursor++]!==',')return false;
      }
      return false;
    }
    const start=cursor;while(cursor<raw.length&&!/[\s,}\]]/.test(raw[cursor]!))cursor++;
    const token=raw.slice(start,cursor);
    if(token==='null')values.set(path.join('.'),null);
    return /^(?:null|true|false|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(token);
  };
  value([],0);
  const sections:DraftSection[]=[];
  const summary=values.get('summary');if(summary)sections.push({id:'summary',kind:'summary',text:summary});
  for(const [key,text] of values){
    if(typeof text!=='string'||!text)continue;
    const match=/^(findings|actions)\.(\d+)\.(explanation|text)$/.exec(key);
    if(match && ((match[1]==='findings'&&match[3]==='explanation')||(match[1]==='actions'&&match[3]==='text'))){
      const rule_id=values.get(`${match[1]}.${match[2]}.rule_id`);
      if(rule_id!==undefined)sections.push({id:key,kind:match[1]==='findings'?'finding':'action',text,rule_id});
    }else if(/^limitations\.\d+$/.test(key))sections.push({id:key,kind:'limitation',text});
  }
  return sections.slice(0,36);
}
