# 明示贷查后端

Node.js 24 + TypeScript + OpenAI 官方 SDK + pnpm + WebSocket。Python 负责十进制金融计算和 PDF 文本、坐标提取。HTTP 使用 Node 原生服务，WS 使用 `ws`，不依赖旧方案中的服务端框架。

当前已实现完整业务闭环：多材料上传 → PDF 解析或图像转录 → 模型抽取与对齐业务事实 → 用户确认及修正记录 → Python 生成还款计划并计算 → 确定性规则检查 → AI 撰写报告 → 数字与引用校验 → WS 返回。根路径提供可直接操作的联调页面。

## 启动

新版 React 前端骨架位于 `frontend/`，包括上传、核对、报告三屏；[前端交接说明](frontend/README.md) 和 [接口契约](docs/api.md) 给出了开发入口与数据边界。`pnpm build` 会同时构建后端与前端，构建后根路径显示新版界面，原联调页保留在 `/debug`。

文本 PDF 支持原始页面预览与原文匹配高亮，扫描件显示原图和转录摘录。报告页支持可选的 MCP 公开来源检索：配置 `SEARCH_MCP_URL` 和完整的 `SEARCH_MCP_AUTHORIZATION` 请求头值后，用户可以按机构名称查找许可、登记和处罚页面；结果只作为可复核线索，不自动认定资质或修改规则结论。

搜索结果中的金融监管总局公告可直接读取官方 JSON，展示标题、发布日期、全文与表格，按当事人名称匹配机构记录。官方详情与搜索摘要分别标注，不交给模型改写或自动改变资质。金融许可证查询有验证码，目前人工核对；企业登记详情尚未接通。协议及具体限制见 [docs/api.md](docs/api.md)。

处理页通过 WS 实时显示 PDF 页进度、可追溯的分析摘要和报告草稿。计算与规则检查完成后立即展示结果；报告草稿按生成尝试隔离，校验通过后才替换成正式报告，重试、取消或断线会撤回草稿。处理记录及已核算结果可在同一会话重连后回读，模型内部推理和系统提示不传给前端。

```bash
pnpm install --frozen-lockfile
uv venv .venv
uv pip install --python .venv/bin/python -r python/requirements.txt
cp .env.example .env
# 编辑 .env，填写模型服务地址、模型名和服务端密钥。
pnpm dev
```

默认监听 `127.0.0.1:18987`，打开该地址即可走完整流程。`.env` 已加入忽略规则，应限制文件权限；密钥不会传入 Python 子进程环境或前端返回值。SDK 使用 `OPENAI_BASE_URL` 和 `OPENAI_MODEL` 配置兼容的模型服务。`OPENAI_REASONING_EFFORT=none` 时对 DeepSeek 显式关闭 thinking，避免抽取与报告任务把预算耗在隐藏推理上；也可配置其他支持的推理强度。

```bash
pnpm typecheck
pnpm test
pnpm test:python
pnpm build
pnpm start
```

`pnpm check:model` 验证模型连通性；`pnpm test:live` 验证兼容的底层抽取/计算接口。`pnpm test:full` 生成两份模拟 PDF，验证真实模型抽取、用户修正、费用计算、规则、AI 报告和案件回读。`pnpm test:images` 把明示表转成 PNG，验证图像识别分支。这些命令调用模型并产生费用，普通单测不访问外部模型。

## 完整案件流程

网页提供模拟样本、PDF/PNG/JPG 上传、材料角色选择、原文证据核对、业务字段编辑、完整事实编辑、修正记录及报告展示，也可以手工录入而跳过模型抽取。页面是联调入口。

先创建会话并认证 WS，然后启动案件；可以同时上传明示表和合同：

```json
{"type":"case.start","request_id":"case-1","documents":[{"document_id":"上传的UUID","role":"disclosure"},{"document_id":"另一份UUID","role":"contract"}],"context":{"is_student":true,"purpose":"职业培训"}}
```

也可用 `text` 提供材料文字，或使用 `manual_facts` 手工提供事实（与材料抽取二选一）。材料角色为 `disclosure|contract|schedule|other`，最多五份。图像页经 Python 限制尺寸后交给同一模型转录，再抽取；每份材料最多四张图像页。图像转录证据标记 `source_type=vision_transcript`，其准确性须由用户对照原图确认。

服务返回 `case.review`：包含 `case_id`、`revision`、`facts`、`evidence`、`questions`、`conflicts`、`materials`。事实保留机构类型、学生身份、收费主体、费用条件、披露状态等信息；不能把这些信息提前压成现金流。未知值保持 `null/unknown`。

用户核对后提交**完整的最终事实**：

```json
{"type":"case.confirm","request_id":"confirm-1","case_id":"案件UUID","expected_revision":0,"facts":{"此处":"用case.review返回并由用户修正的完整facts替换"}}
```

该示例只展示命令结构，`facts` 的准确字段见 `src/domain.ts` 和网页完整数据编辑器。费用 `amount` 是单次金额；`per_period` 由 Python 扩展。`included_in_cashflows` 表示已含在到账净额或约定还款额，`included_in_disclosed_cost` 表示已计入**披露的年化合计**，两者独立，不能混用。或有费用不进入正常成本。

确认会增加案件版本，保存字段修改前后值，然后自动计算、检查和写报告。期数及每期金额等信息齐备时由 Python 生成计划，不要求模型展开每期表。合同约定等间隔的计划保留名义/复利口径，日历日期可补充 XIRR；明确的不规则日期计划按 ACT/365 计算。

新增 WS 事件：

| 事件 | 内容 |
| --- | --- |
| `case.review` | 待确认事实、原文证据、冲突与补充问题 |
| `case.confirmed` | 已保存的版本与修正记录 |
| `case.calculation_unavailable` | 缺字段或数据冲突，不能核算；仍可生成明确标注材料不足的报告 |
| `case.checked` | Python 计算结果与全部规则状态 |
| `report.result` | 完整报告，包括事实、费用、计算、规则、证据、修正和 AI 文字 |
| `report.warning` | AI 报告生成失败或校验不通过，已降级为明确标识的模板 |
| `case.snapshot` | 会话内已保存案件的最新状态、历史与报告 |

`case.get` 使用 `case_id` 回读；`case.report` 使用 `case_id` 和 `expected_revision` 重试报告。再次 `case.confirm` 可修改后重算，过期版本返回 `REVISION_CONFLICT`。未确认的案件不能直接生成报告。每个会话最多五个案件。

规则的结果区分命中、未命中、信息不足和不适用。日期和业务范围不足时保留待核实；R02 只读 Python 的同口径比较，0.5pp 是项目容差。R08/R09 是项目提示项，没有对应的已核验官方条文，不能作为法律定性。其余原文及核验状态见 `data/regulations.json`，报告保留引用来源；用户确认的主体资质不等于系统已联网查验。

AI 只写解释与核实建议。报告中的数值通过受控占位符填入，规则等级、条款和证据由代码提供；不允许任意添加数字或规则引用。输出格式或报告校验失败时最多自动修正一次；仍失败则保留计算和规则，返回 `generation.mode=template`，成功为 `ai`。校验不能保证每句自然语言都正确，报告仍需结合材料复核。

## 兼容的底层接口

HTTP 负责创建会话、上传文件和销毁会话；WS 负责命令、进度、待确认字段和计算结果。不使用轮询。

| HTTP 接口 | 行为 |
| --- | --- |
| `GET /api/health` | 返回本服务状态、模型配置状态，不代表实时探测了上游模型 |
| `POST /api/sessions` | 返回 `session_id`、`session_token`、`websocket_path` |
| `POST /api/documents` | 上传 PDF 原始字节，返回 `document_id` |
| `DELETE /api/sessions/current` | 中止任务并清理该会话文件 |

上传与删除须带 `Authorization: Bearer <session_token>` 或 `X-Session-Token: <session_token>`；后者适合在反向代理使用 HTTP Basic 验证时保留应用会话认证。上传类型为 `application/pdf`、`image/png` 或 `image/jpeg`，body 直接传 `File`，不是 multipart。文件上限默认 10MB，PDF 30 页，每个会话最多 5 份。`GET /api/documents/{id}` 可用同一令牌读取本会话原始材料。

连接 `/ws` 后，第一条命令必须是认证，不把令牌拼到 URL：

```js
const session = await fetch('/api/sessions', { method: 'POST' }).then(r => r.json());
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
ws.onopen = () => ws.send(JSON.stringify({
  type: 'session.authenticate', request_id: crypto.randomUUID(),
  token: session.session_token,
}));
ws.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  // 按 event.type / event.request_id 更新页面状态。
};
```

前后端分开启动时，使用后端的实际 HTTP/WS 地址，并把前端 Origin 配进 `ALLOWED_ORIGINS`；示例默认包含本机 5173 端口。

认证成功后可发这些命令，所有 `request_id` 由前端生成。同一会话中的任务 ID 不可重复：

```json
{"type":"audit.document","request_id":"read-1","document_id":"上传返回的UUID"}
```

```json
{"type":"audit.extract","request_id":"read-2","text":"待抽取的完整贷款材料文本"}
```

```json
{
  "type": "audit.calculate",
  "request_id": "calc-1",
  "input": {
    "timing": "periodic",
    "periods_per_year": 12,
    "disbursements": [{"amount":"1000","period":0}],
    "repayments": [{"amount":"1100","period":12}],
    "fees": [],
    "quoted_apr": "0.1",
    "quoted_method": "simple",
    "comparison_tolerance_pp": "0.5"
  }
}
```

```json
{"type":"task.cancel","request_id":"cancel-1"}
```

每条服务端事件都有相同外壳：

```json
{"version":1,"type":"task.progress","request_id":"read-1","timestamp":"ISO时间","data":{"stage":"parse_pdf"}}
```

| WS 事件 | `data` 内容 |
| --- | --- |
| `session.ready` | 已认证的会话 ID |
| `task.started` | 任务类型 |
| `task.progress` | `parse_pdf`、`extract_fields` 或 `calculate` 阶段 |
| `document.parsed` | 页数、逐页文本、文本块坐标、`needs_vision` |
| `model.progress` | 已接收的模型字节数；不把未校验的半截 JSON 当结果 |
| `audit.review` | `calculation`、`evidence`、`missing_fields`、`notes`、`requires_confirmation:true` |
| `audit.result` | Python 返回的现金流、各口径结果与比较结果 |
| `task.completed` | 耗时；本次任务结束，未必已完成整个核查流程 |
| `task.error` / `request.error` | `code`、`message`、可选 `details` |

收到 `audit.review` 后由用户检查字段，再发送 `audit.calculate`。抽取与计算分开；修改后重算也使用 `audit.calculate` 和新的请求 ID。每个会话同时运行一个任务，服务默认最多运行 4 个任务。

## 数值与材料约定

- 金额、利率和计算结果都用十进制字符串传输，前端显示和汇总不要先转 `Number`。`"0.12"` 表示 12%，`gap_pp` 用百分点。
- `disbursements` 是实际到账，`repayments` 是实际还款总额。费用已体现在到账净额或还款总额中时，`included_in_cashflows:true`；否则会作为独立现金流扣除。不能同时重复计费。
- `timing:"periodic"` 使用非负整数 `period`；`timing:"dated"` 使用 `date:"YYYY-MM-DD"`。不把日期流冒充等间隔期数。
- Python 在 80 位 Decimal 上下文中构造现金流、年化和比较，IRR 求解使用 60 位精度。输出保留高精度，0.5pp 边界仅消除求解器收敛误差，不先按展示小数位舍入。
- 定期现金流返回 `period_rate`、`nominal_apr`、`effective_apr`；只有两次净现金流时另给 `simple_apr`。日期现金流返回 ACT/365 的 `xirr_apr`。
- `quoted_method` 可选 `nominal`、`effective`、`simple`、`xirr`、`unknown`。未知或不适用时比较结果为空，不猜材料口径。容差是应用参数，不是法规阈值。
- 目前支持常规贷款净现金流：初期净到账为正，之后是支出。可能有多根的现金流会显式报错，不随意挑一个解。
- 模型负责材料抽取和报告文字，不计算还款表，也不判断法律责任。金额必须有匹配原文证据；无完整材料时允许 `calculation:null`，交由人工补录。
- 底层 `audit.document` 仅支持文本 PDF；完整 `case.start` 支持图像转录，图像内容仍需要人工核对。

会话、原始抽取、修正历史和报告存于本进程内存，15 分钟无操作过期。上传文件仅在临时目录内保存；显式删除会话、过期清理或正常停服时删除。断开全部 WS 连接会取消当前任务，但文件仍保留至会话清理。可用原令牌和案件 ID 回读当前快照；尚无进程重启后的持久化或 WS 事件回放。

## 代码位置

- `src/server.ts`：HTTP、WS、会话与任务生命周期。
- `src/model.ts`：OpenAI SDK 流式抽取和字段、证据校验。
- `src/python.ts`：有超时和取消机制的 Python 子进程桥接。
- `src/contracts.ts`：WS 命令和计算数据契约。
- `src/domain.ts`、`src/cases.ts`：业务事实、案件版本和完整流程。
- `src/case-model.ts`：多材料事实抽取、图像转录。
- `src/rules.ts`、`data/regulations.json`：确定性检查和条款来源。
- `src/report.ts`：AI 报告、数字与引用校验、失败降级。
- `public/`：可操作的全流程联调页面。
- `python/loan_plan.py`：确认事实转还款计划及费用现金流。
- `python/calculation.py`：Decimal IRR、XIRR 和口径比较。
- `python/pdf_tools.py`：PDF 文本与坐标解析。

参考：[OpenAI Chat Completions 流式接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events/)、[ws 官方说明](https://github.com/websockets/ws)。这些资料只用于 SDK 和传输实现，不用于判断第三方模型能力或金融监管口径。
