/** Supported official detail pages. The backend constructs a fixed API URL. */
export function nfraDocId(source:string):string|null {
  try {
    const url=new URL(source);
    if(!['https:','http:'].includes(url.protocol) || !['www.nfra.gov.cn','nfra.gov.cn'].includes(url.hostname) || url.username || url.password || url.port) return null;
    if(!/^\/(?:cn|branch\/[a-zA-Z0-9_-]+)\/view\/pages\/(?:common\/)?ItemDetail\.html$/.test(url.pathname)) return null;
    const ids=url.searchParams.getAll('docId');
    return ids.length===1 && /^[1-9][0-9]{0,9}$/.test(ids[0]!) ? ids[0]! : null;
  } catch { return null; }
}
