import { isIP } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppError } from './errors.ts';

export interface SearchMcpSettings {
  url?: string;
  authorization?: string;
  timeout: number;
}

export interface LenderSearchSource {
  title: string;
  url: string;
  snippet: string;
  official: boolean;
  name_match: boolean;
}

export interface LenderSearchCategory {
  kind: 'license' | 'registry' | 'penalty';
  status: 'sources_found' | 'no_indexed_results' | 'unavailable';
  sources: LenderSearchSource[];
  error_code?: string;
}

export interface LenderSearchResult {
  name: string;
  queried_at: string;
  provider: 'mcp_websearch';
  scope: 'public_index_search';
  license_determination: 'not_performed';
  categories: LenderSearchCategory[];
  limitations: string[];
}

export interface SearchToolInput {
  query: string;
  numResults: 3;
  includeDomains: string[];
  contents: { text: { maxCharacters: 1800 } };
}

export type SearchToolCaller = (
  input: SearchToolInput,
  signal: AbortSignal,
  timeout: number,
) => Promise<unknown>;

const CATEGORY_QUERIES: Array<{
  kind: LenderSearchCategory['kind'];
  qualifier: string;
  includeDomains: string[];
}> = [
  {
    kind: 'license',
    qualifier: '(金融许可证 OR 银行 OR 小额贷款公司 OR 地方金融组织)',
    includeDomains: ['gov.cn', 'nfra.gov.cn', 'pbc.gov.cn'],
  },
  {
    kind: 'registry',
    qualifier: '(企业登记 OR 企业信用信息)',
    includeDomains: ['gsxt.gov.cn'],
  },
  {
    kind: 'penalty',
    qualifier: '(行政处罚 OR 监管处罚 OR 处罚决定)',
    includeDomains: ['nfra.gov.cn', 'pbc.gov.cn', 'gov.cn'],
  },
];

const LIMITATIONS = [
  '检索来自公开搜索索引，来源内容未经核验；结果不构成事实认定或法律结论。',
  '未执行许可状态判断；没有检索结果不代表未获许可，索引可能不完整或过期。',
  '部分来源可能需要在浏览器中人工打开并核对。',
];

const MAX_RESPONSE_CHARS = 100_000;
const MAX_SOURCES_PER_CATEGORY = 10;
const MAX_TITLE_CHARS = 240;
const MAX_SNIPPET_CHARS = 1_800;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;

function abortError(): AppError {
  return new AppError('TASK_CANCELLED', '任务已取消。', 499);
}

function boundedTimeout(timeout: number): number {
  if (!Number.isFinite(timeout)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.trunc(timeout)));
}

function escapedName(name: string): string {
  return name.replace(/[\\"\u0000-\u001f\u007f]/g, (character) => `\\${character}`);
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]/gu, '');
}

function isPrivateIp(hostname: string): boolean {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const octets = hostname.split('.').map(Number);
    const [a, b] = octets;
    return a === undefined || a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
      normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('::ffff:');
  }
  return false;
}

function safeOfficialUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || isPrivateIp(hostname) || hostname === 'localhost' ||
      hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return undefined;
    if (!(hostname === 'gov.cn' || hostname.endsWith('.gov.cn'))) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function textField(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maximum);
}

function sourceFromFields(titleValue: unknown, urlValue: unknown, snippetValue: unknown, name: string): LenderSearchSource | undefined {
  const url = safeOfficialUrl(urlValue);
  if (!url) return undefined;
  const title = textField(titleValue, MAX_TITLE_CHARS) || url;
  const snippet = textField(snippetValue, MAX_SNIPPET_CHARS);
  const normalizedTarget = normalizedName(name);
  const nameMatch = Boolean(normalizedTarget &&
    `${normalizedName(title)}${normalizedName(snippet)}`.includes(normalizedTarget));
  return { title, url, snippet, official: true, name_match: nameMatch };
}

function structuredSources(value: unknown, name: string): LenderSearchSource[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { results?: unknown }).results)) return [];
  const results = (value as { results: unknown[] }).results.slice(0, 50);
  const sources: LenderSearchSource[] = [];
  for (const candidate of results) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    const source = sourceFromFields(item.title, item.url ?? item.link, item.snippet ?? item.text, name);
    if (source) sources.push(source);
  }
  return sources;
}

function formattedSources(text: string, name: string): LenderSearchSource[] {
  const bounded = text.slice(0, MAX_RESPONSE_CHARS);
  const blocks = bounded.split(/(?=^\[\d+\]\s*Title\s*:)/gim).slice(0, 50);
  const sources: LenderSearchSource[] = [];
  for (const block of blocks) {
    const title = block.match(/^\[\d+\]\s*Title\s*:\s*(.*)$/im)?.[1];
    const url = block.match(/^\s*URL\s*:\s*(\S+)\s*$/im)?.[1];
    const rawSnippet = block.match(/^\s*\[Text\]\s*:\s*([\s\S]*)/im)?.[1];
    const snippet = rawSnippet?.split(/^\s*\[(?:Published|Author|Image|Thumbnail)\]\s*:/im, 1)[0]?.trim();
    const source = sourceFromFields(title, url, snippet, name);
    if (source) sources.push(source);
  }
  return sources;
}

/** Parses MCP web_search output without fetching or trusting result URLs. */
export function parseLenderSearchSources(response: unknown, name: string): LenderSearchSource[] {
  if (!response || typeof response !== 'object') return [];
  const result = response as Record<string, unknown>;
  const sources = structuredSources(result.structuredContent, name);
  const content = Array.isArray(result.content) ? result.content : [];
  let text = '';
  for (const part of content.slice(0, 100)) {
    if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
      text += `${text ? '\n' : ''}${textField((part as { text?: unknown }).text, MAX_RESPONSE_CHARS)}`;
      if (text.length >= MAX_RESPONSE_CHARS) break;
    }
  }
  sources.push(...formattedSources(text, name));
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  }).slice(0, MAX_SOURCES_PER_CATEGORY);
}

function makeInput(name: string, category: (typeof CATEGORY_QUERIES)[number]): SearchToolInput {
  return {
    query: `"${escapedName(name)}" ${category.qualifier}`,
    numResults: 3,
    includeDomains: [...category.includeDomains],
    contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } },
  };
}

export class LenderSearchService {
  private readonly settings: SearchMcpSettings;
  private readonly injectedCaller?: SearchToolCaller;

  constructor(settings: SearchMcpSettings, injectedCaller?: SearchToolCaller) {
    this.settings = settings;
    this.injectedCaller = injectedCaller;
  }

  async search(name: string, signal: AbortSignal, onProgress?: (category: string) => void): Promise<LenderSearchResult> {
    if (!this.settings.url) throw new AppError('SEARCH_NOT_CONFIGURED', '尚未配置公开搜索服务。', 503);
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new AppError('SEARCH_INVALID_NAME', '机构名称长度应为 2 到 100 个字符。', 400);
    }
    if (signal.aborted) throw abortError();

    const institutionName = name.trim();
    const timeout = boundedTimeout(this.settings.timeout);
    const categories: LenderSearchCategory[] = [];
    let client: Client | undefined;
    let transport: StreamableHTTPClientTransport | undefined;

    try {
      let caller = this.injectedCaller;
      if (!caller) {
        let endpoint: URL;
        try {
          endpoint = new URL(this.settings.url);
          if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') throw new Error('invalid protocol');
        } catch {
          throw new AppError('SEARCH_NOT_CONFIGURED', '公开搜索服务配置无效。', 503);
        }
        client = new Client({ name: 'lender-public-search', version: '1.0.0' });
        transport = new StreamableHTTPClientTransport(endpoint, {
          requestInit: this.settings.authorization ? { headers: { Authorization: this.settings.authorization } } : undefined,
          redirectPolicy: 'same-origin',
        });
        await client.connect(transport, { signal, timeout });
        caller = async (input, requestSignal, requestTimeout) => {
          const response = await client!.callTool({ name: 'web_search', arguments: { ...input } }, undefined, {
            signal: requestSignal,
            timeout: requestTimeout,
          });
          if (response.isError) throw new Error('provider tool error');
          return response;
        };
      }

      const outcomes = await Promise.all(CATEGORY_QUERIES.map(async (category): Promise<LenderSearchCategory> => {
        if (signal.aborted) throw abortError();
        onProgress?.(category.kind);
        try {
          const response = await caller!(makeInput(institutionName, category), signal, timeout);
          if (signal.aborted) throw abortError();
          const sources = parseLenderSearchSources(response, institutionName);
          return { kind: category.kind, status: sources.length ? 'sources_found' : 'no_indexed_results', sources };
        } catch (error) {
          if (signal.aborted || (error instanceof AppError && error.code === 'TASK_CANCELLED')) throw abortError();
          return { kind: category.kind, status: 'unavailable', sources: [], error_code: 'SEARCH_PROVIDER_ERROR' };
        }
      }));
      categories.push(...outcomes);
    } catch (error) {
      if (signal.aborted || (error instanceof AppError && error.code === 'TASK_CANCELLED')) throw abortError();
      if (error instanceof AppError && error.code === 'SEARCH_NOT_CONFIGURED') throw error;
      for (const category of CATEGORY_QUERIES) {
        categories.push({ kind: category.kind, status: 'unavailable', sources: [], error_code: 'SEARCH_PROVIDER_ERROR' });
      }
    } finally {
      if (client) await client.close().catch(() => undefined);
      else if (transport) await transport.close().catch(() => undefined);
    }

    if (signal.aborted) throw abortError();
    return {
      name: institutionName,
      queried_at: new Date().toISOString(),
      provider: 'mcp_websearch',
      scope: 'public_index_search',
      license_determination: 'not_performed',
      categories,
      limitations: [...LIMITATIONS],
    };
  }
}
