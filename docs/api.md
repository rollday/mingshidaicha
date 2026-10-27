# 前后端接口契约

类型唯一入口是 `shared/audit.ts`，前端从 `frontend/src/types/audit.ts` 导入。`CaseFacts`、`AuditReport`、命令类型直接派生自后端，修改业务字段时不要在前端另抄一套。

## 连接与上传

1. `POST /api/sessions` 得到 `session_id`、`session_token`、`websocket_path`、`expires_in_seconds`。
2. 连接同源 `/ws`，首条消息为 `{type:"session.authenticate",request_id,token:session_token}`；收到 `session.ready` 才能发送任务。
3. 文件通过 `POST /api/documents` 单独上传，body 是文件原始字节，不是 multipart。支持 `application/pdf`、`image/png`、`image/jpeg`，每份默认最多 10MB，每会话五份。
4. 应用令牌放在 `X-Session-Token`，该方式能与网关的 Basic 验证共存。直连后端也接受 `Authorization: Bearer <session_token>`。不要把会话令牌放在 URL。

```ts
const response = await fetch('/api/documents', {
  method: 'POST',
  headers: { 'Content-Type': file.type, 'X-Session-Token': sessionToken },
  body: file,
});
const { document_id } = await response.json();
```

`GET /api/documents/{document_id}` 需同样的会话令牌；只能读本会话材料。`DELETE /api/sessions/current` 清理案件和材料并中止任务。`GET /api/samples` 是自建模拟样本，不是测试金标准；`GET /api/health` 不会主动探测模型。

## 完整流程

发送 `case.start`：

```json
{"type":"case.start","request_id":"unique-1","documents":[{"document_id":"上传返回的UUID","role":"disclosure"}],"context":{"is_student":false,"purpose":"普通消费"}}
```

材料角色为 `disclosure|contract|schedule|other`；也可使用 `text`。`manual_facts` 为手工录入入口，不能与 `documents/text` 同时提交。未知字段可省略，后端会填入协议默认值。

事件顺序：

```text
task.started
task.progress / document.parsed / model.progress
case.review
task.completed
→ 用户核对、修改
case.confirm { case_id, expected_revision, facts: 完整最终事实 }
task.started → case.confirmed → case.checked
→ report.result → task.completed
```

每个命令都有唯一 `request_id`。前端须按 ID 关联进度和结果，不能把其他任务事件覆盖到当前任务。`case.confirmed` 会增加版本并保存修正记录；使用最新版本再次确认可以重算。`case.get {case_id}` 回读当前快照；`case.report {case_id,expected_revision}` 重试报告，必须已经确认过。

材料不足时会额外发出 `case.calculation_unavailable`，随后仍可能得到 `report.result`；AI 输出不可用时发出 `report.warning`，报告标记 `generation.mode=template`。两者均不应被前端当成整个任务失败。真正失败使用 `task.error` / `request.error`，包含 `code`、`message` 和可选 `details`。

## PDF 解析与原文定位

完整流程中，每份 PDF 在模型抽取之前广播 `document.parsed`：

```ts
{
  document_id, page_count, needs_vision,
  pages: [{ page, width, height, text, blocks: [{ bbox: [x0,y0,x1,y1], text }] }]
}
```

前端按 `document_id` 缓存。坐标是 PyMuPDF 页面空间中的文本块范围，页面绘制时需按页面尺寸、缩放与旋转做转换；不是 `evidence.quote` 的逐字矩形。跨块引文需要文本匹配才能进一步定位。

扫描 PDF 的该事件产生于视觉转录之前，空白文本页没有后续 OCR 坐标。直接上传 PNG/JPG 不发 `document.parsed`。这两种情况用页码和带 `vision_transcript` 标记的摘录展示，并让用户对照原图。当前骨架保留 PDF 布局缓存，提供按证据定位材料与页码的文本视图，尚未实现 PDF 页面覆盖高亮。

## 显示规则

- 金额和利率都是十进制字符串，`"0.12"` 表示 12%。显示用 `lib/format.ts`，不要先 `Number()`。
- 披露年化对应 `facts.disclosure.quoted_apr`；同口径重算值对应 `calculation.calculation.comparison.computed_apr`，口径用 `comparison.method`。`nominal_apr` 是名义年化，不能标为单利。
- `gap_pp` 已经是百分点，不能再乘 100；`null` 表示不能比对，不能显示成零。
- `disclosure.present / items_complete / contingent_disclosed` 分别展示“是 / 否 / 待确认”，没有“完整度 4/6”。
- `fees[].amount` 是单次金额，合计按费用 `id` 连接 `fee_totals`。或有费用、发生条件未知的费用与已确认正常费用分开展示。
- `included_in_cashflows`（已含在到账或还款额）和 `included_in_disclosed_cost`（已计入披露年化）独立。不能合成一个“是否计入”。
- 规则四态都要显示：`triggered / not_triggered / insufficient_data / not_applicable`；`yellow` 映射设计 token `amber`。
- 后端没有 `confidence_tier`，也没有真实机构联网核验接口。前端只展示证据与待核实状态，不伪造置信度或核验进度。
- 清空金额表示 `null`，不自动变成零。若确认不存在费用，应明确删除费用项或填写零。

## 连接中断与有效期

会话在服务内存中保留，15 分钟无操作过期；服务重启后不可恢复。`CaseClient` 在当前页面生命周期保留令牌，重连后使用 `case.get` 回读已创建案件。不会写入 localStorage。全部 WS 断开会取消任务，不能保证重放进度或恢复尚未完成的抽取。

`REVISION_CONFLICT` 表示客户端版本过期，应先回读；`UNAUTHORIZED` 表示需要新建会话。任务超时、文件过大、数据冲突等都保留后端原始错误码，界面使用中性错误状态，避免将技术失败显示成贷款风险。
