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

`GET /api/documents/{document_id}/pages/{page}.png` 返回会话内材料的原始页面预览，同样使用 `X-Session-Token`。页面从 1 开始，最长边不超过 1600 像素，服务同时最多处理两个预览；超出返回 `PREVIEW_BUSY`。请求中断会取消渲染，材料不属于当前会话时返回 404。

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
  pages: [{ page, width, height, rotation, text,
    blocks: [{ bbox: [x0,y0,x1,y1], display_bbox: [x0,y0,x1,y1], text }],
    words: [{ bbox: [x0,y0,x1,y1], display_bbox: [x0,y0,x1,y1], text }] }]
}
```

前端按 `document_id` 缓存。`bbox` 为未旋转页面坐标，`display_bbox` 已转换到渲染页面坐标，配合 `width/height` 缩放。前端按只移除空白的原文匹配定位词级范围，找不到词级匹配时才退到文本块。多处相同文本会标出多处候选并提示核对；不修改数字或标点来制造匹配。

扫描 PDF 的该事件产生于视觉转录之前，空白文本页没有后续 OCR 坐标。直接上传 PNG/JPG 不发 `document.parsed`。这两种情况展示原始页面与带 `vision_transcript` 标记的摘录，让用户对照原图，不伪造文字坐标。

## 放贷方公开来源检索

`lender.search {request_id,case_id,expected_revision,name?}` 在用户点击后检索机构名称；省略 `name` 时使用确认的放贷方名称。通过 `task.progress` 的 `search_license / search_registry / search_penalty` 阶段展示真实进度，最终返回 `lender.result {case_id,revision,result}`。

`result` 包含 `name`、`queried_at`、三类 `categories`、来源链接及摘要、名称是否出现在摘要中，以及限制说明。状态区分 `sources_found / no_indexed_results / unavailable`。搜索只保留政府域名来源，不将摘要当作许可状态或处罚事实。没有结果不能解释为没有牌照。

结果在案件快照的 `lender_search` 和报告数据的 `public_source_search` 中保留；不修改确认事实、规则状态或财务计算。重新确认事实后清除原检索记录。服务端从 `SEARCH_MCP_URL`、`SEARCH_MCP_AUTHORIZATION`、`SEARCH_TIMEOUT_MS` 读取 MCP 配置，凭据不发给前端或 Python。

### 直接读取官方详情

`lender.detail {request_id,case_id,expected_revision,url}` 读取本次搜索结果内、已接通的金融监管总局 `ItemDetail.html?docId=...` 公告。只接受当前案件结果中已有的 URL，服务端将文档编号映射到固定官方 JSON 接口，不执行任意网址抓取。进度为 `read_official_source`，完成仍发 `lender.result`。

`result.official_documents[url]` 保存 `status`（`retrieved / unavailable / unsupported_source`）、原文/API 地址、读取时间、标题、发布日期、发布机构、纯文本全文、表格和官方附件链接。Python 清理 HTML，不执行脚本。`matched_rows` 只选择当事人名称栏与完整机构名匹配的行（允许“及相关责任人”后缀）；`name_match` 区分 `subject_row / text_only / not_found`。正文提及机构不等于认定该机构受罚，处罚记录也不等于当前持牌状态。

每次检索最多保留八份详情。官方响应上限 2MiB，单份保存结果上限 512KiB；请求超时或格式不支持返回 `unavailable`，不表示没有记录。公开文档缓存十分钟，缓存命中保留原读取时间。模型及搜索凭据不会转发给官方接口；详情不传入报告模型、不修改确认事实或规则。

2026-10-27 实测总局 `cbircweb/DocInfo/SelectByDocId` 和对应静态 JSON 可读。金融许可证入口要求验证码，当前保留人工查询；国家企业信用信息公示系统本次访问返回 521，尚未接通登记详情。上述观察不保证所有页面长期可用。

## 实时处理记录与报告草稿

`task.activity` 是公开处理记录：`id/timestamp/revision/stage/kind/status/message`，可附材料页号、`evidence_ids/rule_ids` 或官方原文链接。`kind=analysis` 是由实际材料、计算、规则或官方返回生成的分析摘要，不是模型内部推理。每个案件最多保留最近 180 条；快照 `activities` 和报告 `processing_activity` 可回读、随报告数据导出。旧版本摘要保留版本标记，不与当前规则结果混用。

PDF worker 可选 `stream_progress:true` 时按 NDJSON 发送 `{progress:{stage:"parse_pdf",page,total_pages}}`，最后仍发送唯一 `{ok,result/error}`；未启用时保持单份 JSON。Node 将真实页进度转成 WS 活动记录，不按时间伪造百分比。`document.parsed` 仍在整份 PDF 解析完成后发出，前端可以立即展开已读取原文。

`case.checked` 在报告撰写之前发送，并保存在案件快照 `checked` 中。前端立即展示这份确定性计算与四态规则结果，无须等 `report.result`；再次确认事实时立即清除旧结果。`lender.category {category}` 则在每个并行检索分类完成后发送，随后 `lender.result` 给出最终完整结果。

`report.draft {attempt,status,sections}` 持续替换当前草稿，章节类型为 `summary/finding/action/limitation`。状态为 `streaming/validating/retrying/discarded/accepted`，每次生成最多两次尝试。后端只提取白名单叙述字段；完整金额占位符从可信计算渲染，不转发原始 JSON、系统提示或推理字段。前缀检查会隐藏未知占位符、未经允许的数字和规则引用；草稿仍须明确标记“未校验”，只有完整结构及引用校验通过后才由 `report.result` 替代。

重试先撤回上一份草稿；取消、失败或断线清空草稿内容，已完成核算可以保留。草稿不写入案件快照，不在断线后恢复。事件只作用于当前 `request_id`，取消或结束后的迟到分片不得重新显示；重连通过 `case.get` 恢复处理记录和已核算结果。处理记录与材料同样只在会话内存存活，服务重启或会话过期后不可恢复。

## 显示规则

- 金额和利率都是十进制字符串，`"0.12"` 表示 12%。显示用 `lib/format.ts`，不要先 `Number()`。
- 披露年化对应 `facts.disclosure.quoted_apr`；同口径重算值对应 `calculation.calculation.comparison.computed_apr`，口径用 `comparison.method`。`nominal_apr` 是名义年化，不能标为单利。
- `gap_pp` 已经是百分点，不能再乘 100；`null` 表示不能比对，不能显示成零。
- `disclosure.present / items_complete / contingent_disclosed` 分别展示“是 / 否 / 待确认”，没有“完整度 4/6”。
- `fees[].amount` 是单次金额，合计按费用 `id` 连接 `fee_totals`。或有费用、发生条件未知的费用与已确认正常费用分开展示。
- `included_in_cashflows`（已含在到账或还款额）和 `included_in_disclosed_cost`（已计入披露年化）独立。不能合成一个“是否计入”。
- 规则四态都要显示：`triggered / not_triggered / insufficient_data / not_applicable`；`yellow` 映射设计 token `amber`。
- 后端没有 `confidence_tier`。机构检索提供公开来源线索，不直接判断持牌与否；前端不伪造置信度或核验结论。
- 清空金额表示 `null`，不自动变成零。若确认不存在费用，应明确删除费用项或填写零。

## 连接中断与有效期

会话在服务内存中保留，15 分钟无操作过期；服务重启后不可恢复。`CaseClient` 在当前页面生命周期保留令牌，重连后使用 `case.get` 回读已创建案件。不会写入 localStorage。全部 WS 断开会取消任务，不能保证重放进度或恢复尚未完成的抽取。

`REVISION_CONFLICT` 表示客户端版本过期，应先回读；`UNAUTHORIZED` 表示需要新建会话。任务超时、文件过大、数据冲突等都保留后端原始错误码，界面使用中性错误状态，避免将技术失败显示成贷款风险。
