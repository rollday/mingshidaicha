# 前端开发交接

React + TypeScript + Vite + Tailwind CSS，使用交接包提供的 `theme.css` 和基础组件。后端仍使用 Node.js / Python；接口见 [docs/api.md](../docs/api.md)。

在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm dev          # 终端一：Node 后端，默认 18987
pnpm dev:frontend # 终端二：Vite，默认 5173，代理 /api 和 /ws
```

生产构建执行根目录 `pnpm build`。前端输出到 `public/ui`，由 Node 同源服务；构建完成后 `/` 为新界面，`/debug` 保留原联调页，`/dev/components` 为组件预览。未构建前端时，根路径仍可使用原联调页。

```text
src/pages/Upload.tsx            上传、样本、试算入口
src/pages/Confirm.tsx           核对页和吸底确认栏
src/pages/Report.tsx            报告页组装
src/components/base/           共用 Card/Button/Tag/Field/Table 等
src/components/FieldCard.tsx    字段编辑与证据入口
src/components/SourceCard.tsx   原文页码定位和布局缓存读取
src/components/RecheckCard.tsx  用途、主体、披露状态和逐项费用
src/components/report/         前端可继续迭代的八个报告区块
src/lib/case-client.ts          HTTP/WS、请求关联、会话恢复与重置
src/lib/use-case.ts             React 状态订阅
src/lib/format.ts               十进制字符串显示
src/types/audit.ts              重导出后端共享类型
src/styles/theme.css            视觉 token 和 Tailwind 入口
```

页面层持有数据和动作；报告区块只收 `report` props，不自行 fetch。`shared/audit.ts` 派生命令、事实与报告类型，不要复制字段。新版绑定修正见接口契约的“显示规则”。

目前提供可运行的三屏骨架和完整数据流，尚不等于设计稿逐像素验收。后续重点是 PDF 页面覆盖高亮、字段编辑体验和报告视觉细节；在线放贷方核验、模型置信度和八份设计样本均未实现，不应伪装成已有能力。滑块试算先进入核对页，确认后由 Python 计算，不运行浏览器 IRR。
