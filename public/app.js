const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
let socket, session, ready = false, busy = false, current, latestReport;
const stages = { parse_pdf: '提取 PDF 文字与坐标', read_images: '读取图像文字，需人工核对', extract_case: '对齐贷款事实与原文证据', prepare_review: '准备手工录入', calculate: '生成还款计划并计算成本', check_rules: '执行规则检查', write_report: 'AI 撰写核查报告' };
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function active(step) { for (const key of ['input', 'review', 'report']) $('step-' + key).classList.toggle('active', key === step); }
function controls(value) { busy = value; for (const id of ['start', 'manual', 'confirm', 'retry', 'add-fee', 'apply-json']) $(id).disabled = value || !ready; $('cancel').hidden = !value; }
function send(type, data = {}) { if (!ready) throw new Error('连接尚未就绪'); socket.send(JSON.stringify({ type, request_id: crypto.randomUUID(), ...data })); }
function log(text) { $('progress-section').hidden = false; $('progress').append(node('li', text)); }
async function connect() {
  session = await fetch('/api/sessions', { method: 'POST' }).then(async r => { if (!r.ok) throw new Error('无法创建会话'); return r.json(); });
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'session.authenticate', request_id: crypto.randomUUID(), token: session.session_token }));
  socket.onerror = () => notice('连接发生错误，请检查服务状态。');
  socket.onclose = () => { ready = false; controls(false); $('connection').textContent = '连接已关闭'; notice('会话连接已断开，请刷新页面重新连接。'); };
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data), d = event.data;
    if (event.type === 'session.ready') { ready = true; controls(false); $('connection').textContent = '已连接'; }
    else if (event.type === 'task.started') controls(true);
    else if (event.type === 'task.progress') log(stages[d.stage] || d.stage);
    else if (event.type === 'case.review' || event.type === 'case.snapshot') { current = d; renderReview(); if (d.report) renderReport(d.report); }
    else if (event.type === 'case.confirmed') { current.revision = d.revision; log('已保存确认结果与修改记录'); }
    else if (event.type === 'case.calculation_unavailable') notice('现有信息不足或有冲突，报告将明确注明无法核算。待补充字段：' + (d.missing_fields.join('、') || d.code));
    else if (event.type === 'report.warning') notice('AI 报告生成未通过，已展示计算、规则和模板报告；可以重试。');
    else if (event.type === 'report.result') { current.revision = d.revision; latestReport = d.report; renderReport(d.report); }
    else if (event.type === 'task.completed') { controls(false); log('本次处理完成'); }
    else if (event.type === 'task.error' || event.type === 'request.error') { controls(false); notice(d.message + '（' + d.code + '）'); }
  };
}
function getPath(object, path) { return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((v, k) => v?.[k], object); }
function setPath(object, path, value) { const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.'); const last = parts.pop(); const parent = parts.reduce((v, k) => v[k], object); parent[last] = value; }
const booleans = [['', '待确认'], ['true', '是'], ['false', '否']];
function field(parent, label, path, type = 'text', options) {
  const wrap = node('label', label), value = getPath(current.facts, path);
  const input = options ? node('select') : node('input');
  if (options) for (const [key, title] of options) { const option = node('option', title); option.value = key; input.append(option); }
  input.value = value === null || value === undefined ? '' : String(value); input.dataset.path = path; input.dataset.kind = type;
  if (!options && type === 'money') { input.inputMode = 'decimal'; input.placeholder = '待确认（元）'; }
  if (!options && type === 'integer') input.inputMode = 'numeric';
  wrap.append(input); parent.append(wrap);
}
function collect() {
  const facts = structuredClone(current.facts);
  for (const input of $('review-section').querySelectorAll('[data-path]')) {
    let value = input.value.trim();
    if (value === '') value = null;
    else if (input.dataset.kind === 'boolean') value = value === 'true';
    else if (input.dataset.kind === 'integer') { value = Number(value); if (!Number.isInteger(value)) throw new Error('期数必须为整数'); }
    setPath(facts, input.dataset.path, value);
  }
  return facts;
}
function renderReview() {
  $('review-section').hidden = false; $('report-section').hidden = true; active('review'); $('fields').replaceChildren(); $('fees').replaceChildren();
  const grid = node('div', undefined, 'grid'); $('fields').append(grid);
  field(grid, '合同本金', 'loan.principal', 'money'); field(grid, '实际到账', 'loan.disbursed', 'money'); field(grid, '期数', 'loan.term_periods', 'integer');
  field(grid, '每年期数（月度为 12）', 'loan.periods_per_year', 'integer'); field(grid, '每期约定还款额', 'loan.period_payment', 'money');
  field(grid, '合同名义年利率（小数）', 'loan.nominal_apr'); field(grid, '放款日期', 'loan.start_date');
  field(grid, '还款方式', 'loan.repay_method', 'text', [['unknown','待确认'],['equal_installment','等额本息'],['equal_principal','等额本金'],['interest_only','先息后本'],['bullet','到期一次还本付息'],['schedule','按明确还款表']]);
  field(grid, '在校学生', 'borrower.is_student', 'boolean', booleans); field(grid, '借款用途', 'borrower.purpose');
  field(grid, '放贷机构名称', 'lender.name'); field(grid, '机构类型', 'lender.type', 'text', [['unknown','待确认'],['bank','银行'],['consumer_finance','消费金融公司'],['microloan','小额贷款公司'],['platform','平台'],['other','其他']]);
  field(grid, '主体资质（需自行核实）', 'lender.licensed', 'boolean', booleans); field(grid, '互联网消费贷款', 'lender.internet_consumer_loan', 'boolean', booleans); field(grid, '互联网助贷业务', 'lender.internet_assisted', 'boolean', booleans);
  field(grid, '提供了明示表', 'disclosure.present', 'boolean', booleans); field(grid, '明示项目完整', 'disclosure.items_complete', 'boolean', booleans); field(grid, '已披露或有成本', 'disclosure.contingent_disclosed', 'boolean', booleans);
  field(grid, '明示年化（小数）', 'disclosure.quoted_apr'); field(grid, '明示计算口径', 'disclosure.quoted_method', 'text', [['unknown','未明确'],['nominal','名义年化'],['effective','复利年化'],['simple','到期单利'],['xirr','按实际日期 XIRR']]);
  field(grid, '资金最终付给谁', 'funds_to', 'text', [['unknown','待确认'],['borrower','借款人'],['training_provider','培训机构'],['third_party','其他第三方']]);
  current.facts.fees.forEach((fee, i) => {
    const box = node('div', undefined, 'fee'), fields = node('div', undefined, 'grid'); box.append(node('h3', '费用 ' + (i + 1)), fields); $('fees').append(box);
    field(fields, '费用名称', `fees[${i}].name`); field(fields, '单次／每期金额', `fees[${i}].amount`, 'money');
    field(fields, '收费时点', `fees[${i}].timing`, 'text', [['unknown','待确认'],['upfront','放款时'],['per_period','每期'],['at_maturity','到期时'],['specific_period','指定期次']]);
    field(fields, '指定期次', `fees[${i}].period`, 'integer'); field(fields, '收取主体', `fees[${i}].payee`);
    field(fields, '主体角色', `fees[${i}].payee_type`, 'text', [['unknown','待确认'],['lender','贷款人'],['platform','平台'],['guarantor','增信机构'],['other','其他']]);
    field(fields, '已列在明示表', `fees[${i}].in_disclosure`, 'boolean', booleans); field(fields, '已含在到账净额／还款额中', `fees[${i}].included_in_cashflows`, 'boolean', booleans);
    field(fields, '已纳入明示年化合计', `fees[${i}].included_in_disclosed_cost`, 'boolean', booleans); field(fields, '仅违约等条件下产生', `fees[${i}].contingent`, 'boolean', booleans);
    const remove = node('button', '删除误识别费用', 'secondary'); remove.onclick = () => { current.facts = collect(); current.facts.fees.splice(i, 1); renderReview(); }; box.append(remove);
  });
  $('advanced').value = JSON.stringify(current.facts, null, 2);
  $('questions').replaceChildren(...current.questions.map(q => node('li', q.question)), ...current.conflicts.map(c => node('li', '材料存在冲突：' + c.description)));
  $('evidence').replaceChildren();
  for (const evidence of current.evidence) {
    const box = node('div'); box.append(node('p', `${evidence.field} · ${evidence.document_id === 'text' ? '粘贴材料' : '上传材料'} · ${evidence.page ? '第' + evidence.page + '页' : '页码未定位'}${evidence.source_type === 'vision_transcript' ? ' · 图像识别，待人工核对' : ''}`, 'small muted'), node('blockquote', evidence.quote)); $('evidence').append(box);
  }
  if (!current.evidence.length) $('evidence').append(node('p', '当前为手工录入，没有机器提取的原文证据。', 'muted'));
  $('materials').replaceChildren(); for (const material of current.materials) for (const page of material.pages) $('materials').append(node('h3', `${material.role} · 第${page.page}页`), node('pre', page.text));
}
function decimalText(value, shift = 0) {
  if (value === null || value === undefined) return '未确定';
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.'), digits = whole + fraction, position = whole.length + shift;
  const expanded = digits.padEnd(position + 3, '0'); let amount = BigInt(expanded.slice(0, position + 2)); if (expanded[position + 2] >= '5') amount++;
  const text = amount.toString().padStart(3, '0'); return (negative && amount !== 0n ? '-' : '') + text.slice(0, -2) + '.' + text.slice(-2);
}
function renderReport(report) {
  latestReport = report; $('report-section').hidden = false; $('retry').hidden = report.generation.mode === 'ai'; active('report');
  $('report-mode').textContent = report.generation.mode === 'ai' ? 'AI 撰写 · 已通过数字与引用校验' : '模板报告 · AI 生成未完成';
  const root = $('report'); root.replaceChildren();
  const summary = node('div', undefined, 'report-card ' + report.conclusion.level); summary.append(node('p', report.narrative.summary));
  const counts=report.conclusion.counts;
  if(counts)summary.append(node('p',`已确认核查项 ${counts.confirmed_issues}；待核实 ${counts.pending_checks}；阅读提示 ${counts.advisory_hints}。`,'small'));
  if(report.conclusion.information_incomplete)summary.append(node('p','部分必要信息尚未补齐；待核实项不计入已确认问题。','small muted'));
  root.append(summary);
  if (report.calculation) {
    const calc = report.calculation.calculation, metrics = node('div', undefined, 'metrics');
    const chosen = calc.comparison.computed_apr;
    for (const [label, value] of [['与披露口径一致的重算年化', chosen === null ? '口径待确认' : decimalText(chosen, 2) + '%'], ['正常履约总成本', decimalText(report.calculation.summary.total_cost) + '元'], ['额外独立支付费用', decimalText(report.calculation.summary.total_additional_fees) + '元']]) { const box = node('div', undefined, 'metric'); box.append(node('span', label), node('strong', value)); metrics.append(box); }
    root.append(metrics);
    const detail = node('p', undefined, 'small muted'); detail.textContent = [['名义年化',calc.nominal_apr],['复利年化',calc.effective_apr],['到期单利',calc.simple_apr],['按实际日期年化',calc.xirr_apr]].filter(([,v]) => v !== null).map(([label,v]) => label + ' ' + decimalText(v,2) + '%').join('；'); root.append(detail);
  } else root.append(node('p', '材料不足或存在冲突，本次报告未给出可用的成本计算值。', 'questions'));
  if (report.facts.fees.length) {
    const table = node('table'), head = node('tr'); for (const label of ['项目','合计金额','收取主体','在明示表中']) head.append(node('th',label)); table.append(head);
    for (const fee of report.facts.fees) { const total = report.calculation?.fee_totals.find(f => f.id === fee.id); const row = node('tr'); for (const text of [fee.name, fee.contingent === true ? '或有成本，未计入' : total ? decimalText(total.total) + '元' : '未确定',fee.payee || '待核实',fee.in_disclosure === true ? '是' : fee.in_disclosure === false ? '否' : '待核实']) row.append(node('td',text)); table.append(row); } const scroll=node('div',undefined,'scroll');scroll.append(table);root.append(scroll);
  }
  root.append(node('h3','检查结果与原文依据'));
  const statusNames = { triggered:'发现需关注事项', insufficient_data:'信息不足', not_triggered:'本项未发现明确问题', not_applicable:'本项不适用' };
  for (const rule of report.rules) {
    const details = node('details',undefined,'report-card ' + (['triggered','insufficient_data'].includes(rule.status) ? rule.level : 'blue'));
    details.append(node('summary',`${rule.rule_id} ${rule.title} · ${statusNames[rule.status]}`));
    details.append(node('p',report.narrative.findings.find(f=>f.rule_id===rule.rule_id)?.explanation || rule.reason));
    if(rule.citation?.verification === 'official_checked') { details.append(node('blockquote',rule.citation.quote)); const link=node('a',rule.citation.document+' '+rule.citation.article); link.href=rule.citation.url; link.target='_blank'; link.rel='noopener noreferrer'; details.append(link); } else details.append(node('p','项目提示项，未绑定可核验的对应官方条文。','small muted'));
    for (const id of rule.evidence_ids) { const evidence=report.evidence.find(e=>e.id===id); if(evidence) details.append(node('blockquote',evidence.quote)); } root.append(details);
  }
  root.append(node('h3','接下来可以核实的事项')); const actions=node('ul'); for(const action of report.narrative.actions)actions.append(node('li',action.text));root.append(actions);
  root.append(node('h3','材料与判断局限'));const limits=node('ul');for(const text of report.narrative.limitations)limits.append(node('li',text));root.append(limits);
  root.append(node('p',`用户修正记录：${report.corrections.length}处。`, 'small muted'));
  if(report.corrections.length){const changes=node('details');changes.append(node('summary','查看修正前后内容'));for(const change of report.corrections)changes.append(node('p',`${change.field}：${String(change.before)} → ${String(change.after)}`,'small'));root.append(changes);}
  root.append(node('p',report.disclaimer,'small muted'));
}
$('files').onchange = () => { $('file-list').replaceChildren(); for (const [i,file] of [...$('files').files].entries()) { const row=node('label',file.name), select=node('select'); select.dataset.fileIndex=i;for(const [value,text] of [['other','材料类型待识别'],['disclosure','明示表'],['contract','借款合同'],['schedule','还款计划']]){const option=node('option',text);option.value=value;select.append(option);}row.append(select);$('file-list').append(row);} };
$('start').onclick = async () => {
  try { controls(true);notice();$('progress').replaceChildren();const documents=[];
    for(const [i,file] of [...$('files').files].entries()) { log('上传 '+file.name);const response=await fetch('/api/documents',{method:'POST',headers:{'X-Session-Token':session.session_token,'Content-Type':file.type || (file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'application/octet-stream')},body:file});const body=await response.json();if(!response.ok)throw new Error(body.error.message);documents.push({document_id:body.document_id,role:$('file-list').querySelector(`[data-file-index="${i}"]`).value}); }
    const identity=$('student').value;send('case.start',{documents,text:$('source-text').value.trim() || undefined,context:{is_student:identity==='unknown'?null:identity==='true',purpose:$('purpose').value.trim() || 'unknown'}});
  } catch(error){controls(false);notice(error.message);}
};
$('manual').onclick=()=>{notice();send('case.start',{manual_facts:{}});controls(true);};
$('confirm').onclick=()=>{try{const facts=collect();notice();send('case.confirm',{case_id:current.case_id,expected_revision:current.revision,facts});controls(true);}catch(error){notice(error.message);}};
$('retry').onclick=()=>{send('case.report',{case_id:current.case_id,expected_revision:current.revision});controls(true);};
$('cancel').onclick=()=>send('task.cancel');
$('add-fee').onclick=()=>{try{current.facts=collect();current.facts.fees.push({id:crypto.randomUUID(),name:'待确认费用',amount:null,timing:'unknown',period:null,payee:null,payee_type:'unknown',in_disclosure:null,included_in_cashflows:null,included_in_disclosed_cost:null,contingent:null});renderReview();}catch(error){notice(error.message);}};
$('apply-json').onclick=()=>{try{current.facts=JSON.parse($('advanced').value);renderReview();notice('已应用完整数据，请核对后提交。');}catch(error){notice('数据格式错误：'+error.message);}};
$('new-session').onclick=async()=>{if(session)await fetch('/api/sessions/current',{method:'DELETE',headers:{'X-Session-Token':session.session_token}});location.reload();};
$('download').onclick=()=>{const blob=new Blob([JSON.stringify(latestReport,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='loan-audit-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
fetch('/api/samples').then(r=>r.json()).then(samples=>{for(const sample of samples){const button=node('button',sample.name);button.append(node('small',sample.description));button.onclick=()=>{$('source-text').value=sample.text;$('purpose').value=sample.context.purpose;$('student').value=String(sample.context.is_student);$('files').value='';$('file-list').replaceChildren();notice('已载入自建模拟材料，点击读取即可核查。');};$('samples').append(button);}}).catch(()=>{});
connect().catch(error=>notice(error.message));
