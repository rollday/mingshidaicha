import type { ApiError } from '../types/audit.ts';

export type ErrorCopy = { title: string; body: string };

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const badInput = (): ErrorCopy => ({
  title: '有一处数字没通过检查',
  body: '重算的时候发现有一处填写不合理，比如金额不是数字、期数是空的、日期格式不对。请回到核对这一步改好，再确认一次。',
});

/** Codes whose backend message is either English or too terse for the people reading this page. */
const copies: Record<string, (error: ApiError) => ErrorCopy> = {
  PDF_PAGE_LIMIT_EXCEEDED: error => {
    const details = (error.details && typeof error.details === 'object' ? error.details : {}) as { page_count?: unknown; max_pages?: unknown };
    const pages = finite(details.page_count), limit = finite(details.max_pages);
    return {
      title: '这份 PDF 页数太多',
      body: `${pages === null ? '这份 PDF 超出了单份材料的页数上限。' : `这份 PDF 有 ${pages} 页，`}${limit === null ? '' : `一次最多读 ${limit} 页。`}只需要截取明示表、收费条款所在的几页再传一次就行。`,
    };
  },
  PDF_ENCRYPTED: () => ({ title: '这份 PDF 有密码', body: '加了密码的 PDF 读不了。请先打开、另存一份不加密的，或者只把需要核对的几页打印成新的 PDF 再上传。' }),
  PDF_OPEN_FAILED: () => ({ title: '这份 PDF 打不开', body: '文件可能已经损坏。可以换一份原始文件，或者把关键几页截图成图片上传。' }),
  PDF_DEPENDENCY_MISSING: () => ({ title: '这台服务器暂时读不了 PDF', body: '服务端缺少解析 PDF 的组件。这不是你的材料问题，请联系开发者处理。' }),
  VISION_PAGE_LIMIT: error => {
    const details = (error.details && typeof error.details === 'object' ? error.details : {}) as { page_count?: unknown; max_pages?: unknown };
    const pages = finite(details.page_count), limit = finite(details.max_pages);
    const count = pages === null ? '' : `有 ${pages} 页无法直接读取文字。`;
    const cap = limit === null ? '需要按图片识别的页数超过上限。' : `单份材料最多按图片识别 ${limit} 页。`;
    return {
      title: '这份材料需要识别的图片页太多',
      body: `${count}${cap}请上传可选中文字的 PDF，或先对扫描件做文字识别再上传。也可以选择手工填写。`,
    };
  },
  DOCUMENT_LIMIT: () => ({ title: '材料份数超了', body: '一次最多 5 份材料。把同一份文件的多页合成一个 PDF，或者先删掉不打算核对的那份，再提交。' }),
  FILE_TOO_LARGE: () => ({ title: '文件太大', body: '单份材料不能超过 10MB。可以压缩 PDF，或者只截取需要核对的那几页。' }),
  UNSUPPORTED_MEDIA: () => ({ title: '这个格式读不了', body: '只支持 PDF、PNG、JPG。材料是 WORD 或表格导出的话，先导成 PDF 再上传。' }),
  INVALID_PDF: () => ({ title: '这份 PDF 打不开', body: '文件内容不像有效的 PDF，可能已损坏或只是改了后缀名。请用原始文件重新导出一次。' }),
  INVALID_IMAGE: () => ({ title: '这张图片读不了', body: '文件内容不像有效的 PNG 或 JPG，可能已损坏。请重新截图或另存一次。' }),
  DOCUMENT_TOO_LONG: () => ({ title: '材料文字太长', body: '几份材料合起来超过 20 万字。只传明示表和收费条款所在的页面，比传整本合同更容易核对。' }),
  DUPLICATE_DOCUMENT: () => ({ title: '同一份材料传了两次', body: '同一个文件只需上传一次，多余的可以先删掉。' }),
  EMPTY_CASE: () => ({ title: '还没有材料', body: '请先上传材料、粘贴文字，或者改用手工填写。' }),
  INVALID_NUMBER: badInput,
  INVALID_PERIOD: badInput,
  INVALID_DATE: badInput,
  INVALID_INPUT: badInput,
  INVALID_TIMING: badInput,
  INVALID_METHOD: badInput,
  INVALID_SCHEDULE: badInput,
  INVALID_REPAY_METHOD: () => ({ title: '还款方式还缺一项', body: '选择了逐期等额这种方式，但没有可用的还款计划。补上每期金额，或者换成按合同逐期表填写。' }),
  NO_IRR_ROOT: () => ({ title: '这组还款算不出年化', body: '每期金额、期数和本金对不上，找不到能求解的年化利率。请核对这三个数字，特别是实际到账金额。' }),
  UNSUPPORTED_CASHFLOW: () => ({ title: '这组还款算不出年化', body: '现金流的方向不对，第一笔应当是放款到账。请核对你填的本金、实际到账与每期还款。' }),
};

const looksTechnical = (message: string) => /^[\x00-\x7F\s]*$/.test(message) || /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(message);

/**
 * Backend messages are the diagnostic record; this page is read by people who only need to know
 * what happened and what to do next. Unknown Chinese messages pass through, anything that still
 * looks like a machine string (English sentence, snake_case field) is replaced rather than shown.
 */
export function errorCopy(error: ApiError): ErrorCopy {
  const mapped = copies[error.code]?.(error);
  if (mapped) return mapped;
  const message = error.message ?? '';
  if (!message.trim() || looksTechnical(message)) {
    return { title: '这一步没有完成', body: '这次没有跑完，也没有返回可以解释的原因。请重试一次；如果还是这样，就是材料处理出了问题，请联系开发者。' };
  }
  return { title: '这一步没有完成', body: message };
}
