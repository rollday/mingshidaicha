import { resolve } from 'node:path';
import { z } from 'zod';

const env = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(18987),
  OPENAI_BASE_URL: z.url().default('https://newapi.rollday.site/v1'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('deepseek-flash'),
  OPENAI_REASONING_EFFORT: z.enum(['none', 'low', 'high', 'max']).default('none'),
  PYTHON_BIN: z.string().default('.venv/bin/python'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10485760),
  MAX_PDF_PAGES: z.coerce.number().int().positive().max(100).default(30),
  MAX_CONCURRENT_TASKS: z.coerce.number().int().positive().default(4),
  SEARCH_MCP_URL: z.preprocess(value=>value===''?undefined:value,z.url().optional()),
  SEARCH_MCP_AUTHORIZATION: z.string().optional(),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
}).parse(process.env);

export const config = {
  host: env.HOST, port: env.PORT,
  baseURL: env.OPENAI_BASE_URL.replace(/\/$/, ''), apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL, reasoningEffort: env.OPENAI_REASONING_EFFORT, python: resolve(env.PYTHON_BIN),
  allowedOrigins: new Set(env.ALLOWED_ORIGINS.split(',').map(x => x.trim()).filter(Boolean)),
  modelTimeout: env.MODEL_TIMEOUT_MS, maxUpload: env.MAX_UPLOAD_BYTES,
  maxPdfPages: env.MAX_PDF_PAGES, maxConcurrent: env.MAX_CONCURRENT_TASKS,
  searchMcpURL: env.SEARCH_MCP_URL, searchAuthorization: env.SEARCH_MCP_AUTHORIZATION, searchTimeout: env.SEARCH_TIMEOUT_MS,
};

export type Config = typeof config;
