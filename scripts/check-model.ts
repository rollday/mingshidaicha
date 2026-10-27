import OpenAI from 'openai';
import { config } from '../src/config.ts';

if (!config.apiKey) throw new Error('OPENAI_API_KEY is not configured');
const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 30000, maxRetries: 0 });
try {
  const started = Date.now();
  const response = await client.chat.completions.create({
    model: config.model, stream: true, response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: '这是接口连通性测试。只输出 JSON 对象 {"ok":true}，不解释。' }],
    max_tokens: 128,
  });
  let content = '', chunks = 0, model = '', finish: string | null = null;
  for await (const chunk of response) {
    model = chunk.model;
    if (chunk.choices[0]?.delta.content) { content += chunk.choices[0].delta.content; chunks++; }
    if (chunk.choices[0]?.finish_reason) finish = chunk.choices[0].finish_reason;
  }
  const data = JSON.parse(content);
  if (data.ok !== true || finish !== 'stop') throw new Error('Unexpected model response');
  console.log(JSON.stringify({ ok: true, requested_model: config.model, returned_model: model, streaming_chunks: chunks, json_mode: true, elapsed_ms: Date.now() - started }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, status: error instanceof OpenAI.APIError ? error.status : undefined, error: error instanceof SyntaxError ? 'INVALID_JSON' : 'MODEL_CHECK_FAILED' }));
  process.exitCode = 1;
}
