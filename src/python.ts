import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';

export function runPython(settings: Config, operation: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
  return new Promise((accept, reject) => {
    // Do not forward model credentials or the full Node environment to workers.
    const child = spawn(settings.python, [resolve('python/worker.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });
    let output = '', bytes = 0, settled = false;
    child.stdout.setEncoding('utf8');
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) { child.kill('SIGKILL'); reject(error); } else accept(value);
    };
    const abort = () => finish(new AppError('TASK_CANCELLED', '任务已取消。', 499));
    const timer = setTimeout(() => finish(new AppError('PYTHON_TIMEOUT', 'Python 处理超时。', 504)), settings.modelTimeout);
    child.on('error', () => finish(new AppError('PYTHON_UNAVAILABLE', 'Python 工作进程无法启动。', 503)));
    child.stdin.on('error', () => finish(new AppError('PYTHON_FAILURE', 'Python 输入通道中断。', 502)));
    child.stderr.resume();
    child.stdout.on('data', (data: string) => {
      bytes += Buffer.byteLength(data);
      if (bytes > 24 * 1024 * 1024) return finish(new AppError('OUTPUT_TOO_LARGE', '文档解析结果过大。', 413));
      output += data;
    });
    child.on('close', code => {
      if (settled) return;
      try {
        const result = JSON.parse(output);
        if (!result.ok) return finish(new AppError(result.error?.code ?? 'PYTHON_FAILURE', result.error?.message ?? 'Python 处理失败。', 422, result.error?.details));
        if (code !== 0) return finish(new AppError('PYTHON_FAILURE', 'Python 工作进程异常退出。', 502));
        finish(undefined, result.result);
      } catch { finish(new AppError('PYTHON_PROTOCOL_ERROR', 'Python 返回了无效结果。', 502)); }
    });
    if (signal?.aborted) abort();
    else { signal?.addEventListener('abort', abort, { once: true }); child.stdin.end(JSON.stringify({ operation, payload })); }
  });
}
