# 第二轮线上测试联调交接

核对日期：2026-11-17（Asia/Hong_Kong）。本次只通过 SSH 读取部署配置和镜像标签、核对本地协议，并在回环地址运行模拟网关测试。没有向公网业务地址发送 HTTP / WS 请求，没有运行线上样本，没有改动部署或测试账号。

## 六项确认结果

| 项目 | 已核实内容 | 就绪状态 |
| --- | --- | --- |
| 站点与测试租户 | 当前应用入口为 `https://loancheck.rollday.site/`，不是根域名 `https://rollday.site/`。现有站点仍是共享实例，没有第二轮独立测试租户；应用会话隔离不等同于独立租户。 | 现有入口已核实；独立测试环境未提供 |
| Basic Auth | 现有网关启用 Basic Auth；本地访问凭据已通过服务端密码哈希比对，未进行公网登录。它是当前共享实例的访问凭据，不是新建的独立测试租户账号。凭据单独交付，不进入本说明、脚本或压缩包。 | 现有凭据可单独交付 |
| 应用鉴权 | 与 `docs/api.md` 一致。公网 HTTP 同时携带 `Authorization: Basic …` 和 `X-Session-Token: …`。WS 握手携带 Basic，建连后首条消息认证应用会话。 | 已核对文档、实现及网关配置 |
| 批跑脚本 | 新增 `scripts/run_batch.mjs`，默认仅验证本地清单与输入文件；必须显式加 `--execute` 才发送请求。逐样本创建和删除会话，串行执行，记录抽取、核算与报告结果。 | 本地模拟链路验证通过；尚未公网验收 |
| 被测版本 | 当前线上镜像 `mingshidaicha:1a09de7-20261109`，修订 `1a09de7070828b86cf53d120931a002682ba832f`。核对时本地代码基线为 `1a1cad7e8be831c661eda105294a0f4337e74a04`，二者不同。新增跑批工具随本说明一并交付，工具版本以对应 Git commit 和脚本 SHA-256 为准，与线上应用构建分别记录。 | 线上版本已识别；第二轮目标构建尚待冻结 |
| 分级策略与金标准 | 线上与本地 `grading_policy` 均为 `2026-10-29.v2`。项目分级规范见 `docs/rules.md`、实现见 `shared/rule-policy.ts`。第二轮 `expected_values.csv` 和评分方独立评分细则尚未收到。 | 项目分级策略可提供；金标准缺失 |

在独立环境要求、被测构建和第二轮金标准未确认前，不把当前站点标记为“第二轮可开跑”。若同意在共享实例测试，应由测试双方明确确认这一安排及测试时段。

## 线上调用链路

```text
客户端 ── HTTPS / WSS + Basic Auth ── 网关 ── Node.js 应用
  1. POST /api/sessions
     → session_id / session_token / websocket_path
  2. POST /api/documents
     Authorization: Basic …
     X-Session-Token: …
     Content-Type: application/pdf（或 image/png、image/jpeg）
     body: 文件原始字节，不使用 multipart
     → document_id
  3. WSS /ws，升级请求带 Basic
     → {type:"session.authenticate", request_id, token:session_token}
     ← session.ready
  4. case.start {documents:[{document_id,role}], context?}
     ← task.started / task.progress / document.parsed / model.progress
     ← case.review / task.completed
  5. case.confirm {case_id, expected_revision, facts:完整确认事实}
     ← case.confirmed / case.checked
     ← report.result / task.completed
  6. DELETE /api/sessions/current
     Authorization: Basic …
     X-Session-Token: …
```

纯文本样本在 `case.start` 中使用 `text`。`role` 为 `disclosure | contract | schedule | other`。每次命令使用不同的 `request_id`，按该 ID 关联响应；`case.confirm` 使用本次 `case.review` 给出的版本，不硬编码版本号。

直连后端时也支持 `Authorization: Bearer <session_token>`。公网网关需要 Basic，这时应用令牌应放在 `X-Session-Token`，避免争用同一个 `Authorization` 头。WS 的应用令牌放在认证消息中，不放 URL。

报告 PDF 导出另用 `POST /api/reports/pdf`，JSON 为 `{case_id, expected_revision}`，鉴权与上传相同。完整链路清单可加 `"export_pdf": true` 保存用户可下载的报告及其 SHA-256。机构检索和浏览器界面需要单独的测试用例。

## run_batch.mjs 使用说明

环境：仓库要求的 Node.js 24 及已安装依赖（`pnpm install --frozen-lockfile`）。脚本只依赖现有 `ws` 包，不启动本地后端，也不直接调用模型或 Python。

清单示例：

```json
{
  "version": 1,
  "base_url": "https://loancheck.rollday.site/",
  "target_revision": "1a09de7070828b86cf53d120931a002682ba832f",
  "grading_policy": "2026-10-29.v2",
  "mode": "extract",
  "samples": [
    {
      "id": "S2-01",
      "documents": [{"path": "samples/S2-01.pdf", "role": "contract"}]
    }
  ]
}
```

文件路径相对清单所在目录。样本 ID 唯一，仅含英文字母、数字、下划线或连字符。当前站点地址和 commit 仅表示已观察到的部署状态，不代表第二轮环境已批准；运行前用确认后的值替换并冻结清单。

### 离线校验

```bash
node scripts/run_batch.mjs --manifest /path/to/manifest.json
```

不提供 `--execute` 时不读取账号口令，不创建会话、不上传材料、不连接 WS。离线校验检查文件能否读取、类型和大小、样本 ID、清单字段等；不判断 PDF 内容或金标准正确性。

### 授权开跑后执行

```bash
node scripts/run_batch.mjs \
  --manifest /path/to/manifest.json \
  --execute \
  --basic-auth-file /private/path/basic-auth.json \
  --output .runtime/round2-run-unique
```

私有鉴权文件仅包含 `username`、`password` 两个字段，权限设为 `0600`；在测试人员自己的机器上准备，不提交或加入资料包，也不把口令作为命令行参数。输出目录必须尚不存在，避免覆盖既有结果。

### 两种运行方式

- `mode=extract`：保存 `case.review` 后清理会话，不确认事实、不计算或写报告，适合独立评价抽取质量。
- `mode=pipeline`：每个样本必须显式提供 `confirmation:"extracted"` 或 `confirmed_facts_file`。前者按抽取原值自动确认，记录为 `extracted_unreviewed`，不能声称经过人工核对；后者读取人工确认的完整 `CaseFacts` JSON，仅在抽取完成后送入 `case.confirm`，适合单独评价下游计算与规则。两种确认来源不可同时使用。

清单里的 `expected_values` 或其他未声明字段不会送入抽取接口。脚本不生成金标准、不自行计算评分，也不把样本的技术完成状态当作答案正确。

### 留档与错误处理

每次运行保存：

- `run.json`：清单与脚本 SHA-256、各输入 SHA-256、目标地址、声明的目标 commit、确认来源和预期分级策略。
- 每个样本的 `events.jsonl`、`extracted.json`；完整流程另存 `checked.json`、`report.json`；`result.json` 记录技术状态、耗时与清理结果。
- `summary.json`：尝试数、完成数及逐样本结果。`completed` 仅表示协议流程完成，不表示金标准通过；清理失败也会以非零退出码结束批次。

每个样本使用独立会话，串行执行；失败后清理本会话，再处理下一样本。清理失败时停止批次，避免持续积累会话。客户端不自动重试样本；后端自身的模型 JSON 重试按接口契约执行。

`report.warning`、`generation.mode=template` 和 `case.calculation_unavailable` 分别留档，不误当传输失败；是否应判为业务失败，由评分方规则和样本预期决定。返回策略版本不匹配时标记 `GRADING_POLICY_MISMATCH`。

日志脱敏 Basic 密码、授权头和应用会话令牌；原始材料及抽取结果仍是测试数据，应按测试约定保管。输出留在 `.runtime/`，不进入公开仓库。

当前 `/api/health` 不返回 commit，也不实时探测上游模型。因此脚本把 `target_revision` 记录为**外部声明值**，并明确写入 `target_revision_verified_by_runner=false`。正式运行前后应由部署方核对镜像修订；测试期间冻结部署。

## 第二轮收尾评分

按 `T19-r1-a1` 格式为样本设置唯一清单 ID，包含样本编号、轮次和尝试次序。验收记录一次尝试一个目录，清单启用 PDF 导出。先跑 T19–T22 各三轮，四个样本均满足金标准后再跑 T01–T18。

离线运行 `python3 scripts/grade_round2.py --gold expected_values.csv --revision <完整提交哈希> --runs <批跑输出目录> --output <新目录>`。评分机须安装 `pdftotext`。评分脚本核对账本、利率、comparison、规则及最终报告和 PDF。现金流误差上限为 0.01 元，利率误差和三轮波动上限为 0.01 个百分点。0.5 个百分点仅用于核对是否超过披露比较容差。首次结果和重试分开保存。

金标准 CSV 每行一份样本，含 `sample_id`、`final_sha256`、`gold_status`、`source_status`、`grading_policy`，以及 `facts_json`、`cashflows_json`、`rates_json`、`comparison_json`、`rules_json`。金额和利率用十进制字符串，现金流按期或按日期逐笔登记。只有来源与金标准均标为 `verified`，且具备全部核查规则的独立预期，该样本方可正式评分。未封存、缺原件或证据不齐的样本为 `UNSCORABLE`。

## grading_policy 与 expected_values.csv 的边界

`grading_policy=2026-10-29.v2` 是产品规则的分级策略版本，不自动等于评分方计算准确率、召回率、误报率等指标的评分细则。资料包中的 `grading_policy.json` 是当前项目策略的机器可读快照；完整规则适用条件仍以 `rules.md` 和对应代码为准。

金额、利率保持十进制字符串；`0.12` 表示 12%，`gap_pp` 已是百分点，`null` 表示无法计算或比对，不能当成零。0.5 个百分点是项目 R02 的比较容差，不能直接挪作测试金标准的数值误差阈值。规则按 `triggered / not_triggered / insufficient_data / not_applicable` 四态评价，R08/R09 为提示项。

第二轮 `expected_values.csv` 尚未交付。测试方截图提到已准备样本和三份 CSV，但本工作区未收到相应第二轮文件；需要标注/评分负责人提供原始文件、样本 ID 对应关系、版本及哈希。不能依据系统输出补写预期值，也不能把旧样本的年化或第一轮不完整标注当成第二轮金标准。

## 本次验证

新增六项本地模拟测试覆盖默认不联网、Basic 与会话双层鉴权、输入路径解析、逐样本隔离、抽取与确认分离、大金额字符串保留、策略不匹配、错误清理及日志脱敏。完整 Node 测试 153/153 通过，前后端类型检查通过。本次未做公网完整流程验证。
