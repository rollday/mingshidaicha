export interface BatchDocument {
  path: string;
  role: 'disclosure' | 'contract' | 'schedule' | 'other';
  mime: string;
  bytes: Buffer;
  sha256: string;
}
export interface PreparedSample {
  id: string;
  text?: string;
  context?: Record<string, unknown>;
  documents: BatchDocument[];
  confirmedFacts?: Record<string, unknown>;
  factsHash?: string;
}
export interface PreparedManifest {
  version: 1;
  base_url: string;
  target_revision: string;
  grading_policy: string;
  mode: 'extract' | 'pipeline';
  samples: PreparedSample[];
  manifest_sha256: string;
}
export interface BatchResult {
  id: string;
  status: 'completed' | 'failed';
  cleanup: 'not_needed' | 'deleted' | 'failed';
  elapsed_ms: number;
  error?: string;
  generation_mode?: string | null;
  calculation_available?: boolean;
  calculation_error?: string | null;
}
export function prepareManifest(path: string): Promise<PreparedManifest>;
export function runBatch(manifest: PreparedManifest, options: {
  output: string;
  credentials: { username: string; password: string };
  timeout?: number;
}): Promise<{ finished_at: string; planned: number; attempted: number; completed: number; results: BatchResult[] }>;
export function main(argv?: string[]): Promise<number>;
