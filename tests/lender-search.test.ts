import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors.ts';
import { LenderSearchService, parseLenderSearchSources, type SearchToolInput } from '../src/lender-search.ts';

const name = '示例小额贷款有限公司';
const settings = { url: 'https://search.example/mcp', timeout: 2_000 };

function formattedResponse(title = `${name} 许可信息`) {
  return {
    content: [{
      type: 'text',
      text: `Params used: {"query":"test"}\nSearch results:\n[1] Title: ${title}\nURL: https://www.nfra.gov.cn/example\n[Text]: ${name} 相关公开信息\n[Published]: 2026-01-01`,
    }],
  };
}

test('parser accepts official public URLs and marks only exact normalized name matches', () => {
  const sources = parseLenderSearchSources({
    structuredContent: {
      results: [
        { title: `公告：${name}`, url: 'https://nfra.gov.cn/a', snippet: '公开页面' },
        { title: '相似机构公告', url: 'https://pbc.gov.cn/b', snippet: '另一个机构的公开信息' },
      ],
    },
    content: [{ type: 'text', text: '' }],
  }, name);

  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.official, true);
  assert.equal(sources[0]?.name_match, true);
  assert.equal(sources[1]?.name_match, false);
  assert.equal(sources[0]?.url, 'https://nfra.gov.cn/a');
});

test('parser rejects credentialed, local, non-HTTP, and lookalike URLs', () => {
  const response = {
    structuredContent: {
      results: [
        { title: name, url: 'https://user:secret@nfra.gov.cn/path', snippet: name },
        { title: name, url: 'http://127.0.0.1/private', snippet: name },
        { title: name, url: 'file:///etc/passwd', snippet: name },
        { title: name, url: 'https://gov.cn.attacker.example/page', snippet: name },
        { title: name, url: 'https://example.com/page', snippet: name },
      ],
    },
  };
  assert.deepEqual(parseLenderSearchSources(response, name), []);
});

test('formatted parser ignores missing names and malformed URLs', () => {
  const noName = parseLenderSearchSources({ content: [{
    type: 'text',
    text: 'Search results:\n[1] Title: 金融监管公告\nURL: https://www.nfra.gov.cn/example\n[Text]: 公开信息',
  }] }, name);
  assert.equal(noName[0]?.name_match, false);
  const malformed = parseLenderSearchSources({ content: [{ type: 'text', text: '[1] Title: Test\nURL: javascript:alert(1)\n[Text]: test' }] }, name);
  assert.deepEqual(malformed, []);
});

test('search returns the three category outcomes and escaped, bounded tool inputs', async () => {
  const seen: SearchToolInput[] = [];
  const service = new LenderSearchService(settings, async (input) => {
    seen.push(input);
    return input.includeDomains.includes('gsxt.gov.cn') ? { content: [] } : formattedResponse();
  });
  const result = await service.search(`${name}\"`, new AbortController().signal);

  assert.equal(result.provider, 'mcp_websearch');
  assert.equal(result.scope, 'public_index_search');
  assert.equal(result.license_determination, 'not_performed');
  assert.equal(result.categories.length, 3);
  assert.deepEqual(result.categories.map((category) => category.status), [
    'sources_found', 'no_indexed_results', 'sources_found',
  ]);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((input) => input.numResults === 3 && input.contents.text.maxCharacters === 1_800));
  assert.ok(seen.every((input) => input.query.includes('\\"')));
});

test('category errors stay generic and do not discard successful categories', async () => {
  const service = new LenderSearchService(settings, async (input) => {
    if (input.includeDomains.includes('gsxt.gov.cn')) throw new Error('secret token and provider URL');
    return formattedResponse();
  });
  const result = await service.search(name, new AbortController().signal);

  assert.deepEqual(result.categories.map((category) => category.status), [
    'sources_found', 'unavailable', 'sources_found',
  ]);
  assert.equal(result.categories[1]?.error_code, 'SEARCH_PROVIDER_ERROR');
  assert.equal(JSON.stringify(result).includes('secret token'), false);
  assert.equal(JSON.stringify(result).includes('search.example'), false);
});

test('cancellation is surfaced as TASK_CANCELLED', async () => {
  const controller = new AbortController();
  const service = new LenderSearchService(settings, async (_input, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    controller.abort();
  }));
  await assert.rejects(service.search(name, controller.signal), (error: unknown) =>
    error instanceof AppError && error.code === 'TASK_CANCELLED' && error.status === 499);
});

test('missing provider configuration throws SEARCH_NOT_CONFIGURED', async () => {
  const service = new LenderSearchService({ timeout: 1_000 });
  await assert.rejects(service.search(name, new AbortController().signal), (error: unknown) =>
    error instanceof AppError && error.code === 'SEARCH_NOT_CONFIGURED' && error.status === 503);
});
