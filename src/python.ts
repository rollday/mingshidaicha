import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';

export type PythonProgress={stage:'parse_pdf';page:number;total_pages:number};
export function runPython(settings: Config, operation: string, payload: unknown, signal?: AbortSignal,onProgress?:(progress:PythonProgress)=>void): Promise<unknown> {
  return new Promise((accept, reject) => {
    // Do not forward model credentials or the full Node environment to workers.
    const child = spawn(settings.python, [resolve('python/worker.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });
    let output = '', bytes = 0, settled = false;
    let result:{ok?:boolean;result?:unknown;error?:{code?:string;message?:string;details?:unknown}}|undefined;
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
    const line=(text:string)=>{
      if(!text.trim())return;
      const message=JSON.parse(text);
      if(result)throw new Error('extra worker message');
      if('progress' in message){
        const p=message.progress;
        if(!onProgress||p?.stage!=='parse_pdf'||!Number.isInteger(p.page)||!Number.isInteger(p.total_pages)||p.page<1||p.page>p.total_pages||p.total_pages>settings.maxPdfPages)throw new Error('invalid progress');
        if(!signal?.aborted)onProgress({stage:'parse_pdf',page:p.page,total_pages:p.total_pages});
      }else if(typeof message.ok==='boolean')result=message;
      else throw new Error('invalid worker message');
    };
    child.stdout.on('data', (data: string) => {
      if(settled)return;
      bytes += Buffer.byteLength(data);
      if (bytes > 24 * 1024 * 1024) return finish(new AppError('OUTPUT_TOO_LARGE', '文档解析结果过大。', 413));
      output += data;
      try{let end:number;while((end=output.indexOf('\n'))>=0){line(output.slice(0,end));output=output.slice(end+1);}}
      catch{finish(new AppError('PYTHON_PROTOCOL_ERROR','Python 返回了无效结果。',502));}
    });
    child.on('close', code => {
      if (settled) return;
      try {
        if(output.trim())line(output);
        if(!result)throw new Error('missing result');
        if (!result.ok) return finish(new AppError(result.error?.code ?? 'PYTHON_FAILURE', result.error?.message ?? 'Python 处理失败。', 422, result.error?.details));
        if (code !== 0) return finish(new AppError('PYTHON_FAILURE', 'Python 工作进程异常退出。', 502));
        finish(undefined, result.result);
      } catch { finish(new AppError('PYTHON_PROTOCOL_ERROR', 'Python 返回了无效结果。', 502)); }
    });
    if (signal?.aborted) abort();
    else { signal?.addEventListener('abort', abort, { once: true }); child.stdin.end(JSON.stringify({ operation, payload, ...(onProgress?{stream_progress:true}:{}) })); }
  });
}
