import type { DocumentParsed, LayoutText } from '../types/audit.ts';
type Page = DocumentParsed['pages'][number];
export type Highlight = { box: [number,number,number,number]; left: string; top: string; width: string; height: string };
const compact = (text: string) => text.replace(/\s/g, '');
/** Match only whitespace-normalized source characters; never repair digits or punctuation. */
export function locateHighlights(page: Page, quote: string): { highlights: Highlight[]; precision:'word'|'block'|'none'; occurrences:number } {
  const needle = compact(quote);
  if (!needle || page.width <= 0 || page.height <= 0) return {highlights:[],precision:'none',occurrences:0};
  for (const [precision, tokens] of [['word',page.words ?? []],['block',page.blocks]] as const) {
    const parts = tokens.map(token => compact(token.text));
    const text = parts.join('');
    const matches: number[] = [];
    for (let at = text.indexOf(needle); at >= 0 && matches.length < 20; at = text.indexOf(needle,at + needle.length)) matches.push(at);
    if (!matches.length) continue;
    let offset = 0;
    const chosen: LayoutText[] = [];
    for (const [index,token] of tokens.entries()) {
      const end = offset + parts[index]!.length;
      if (matches.some(start => end > start && offset < start + needle.length)) chosen.push(token);
      offset = end;
    }
    const highlights = chosen.flatMap(token => {
      const box = token.display_bbox ?? (!page.rotation ? token.bbox : undefined);
      if (!box || !box.every(Number.isFinite)) return [];
      const x0=Math.max(0,box[0]),y0=Math.max(0,box[1]),x1=Math.min(page.width,box[2]),y1=Math.min(page.height,box[3]);
      if (x1 <= x0 || y1 <= y0) return [];
      return [{box:[x0,y0,x1,y1] as Highlight['box'],left:`${x0 / page.width * 100}%`,top:`${y0 / page.height * 100}%`,width:`${(x1 - x0) / page.width * 100}%`,height:`${(y1 - y0) / page.height * 100}%`}];
    });
    return {highlights,precision:highlights.length ? precision : 'none',occurrences:matches.length};
  }
  return {highlights:[],precision:'none',occurrences:0};
}
