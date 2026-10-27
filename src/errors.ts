export class AppError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function publicError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message, details: error.details };
  return { code: 'INTERNAL_ERROR', message: '处理失败，请稍后重试。' };
}
