import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeRule, rulePresentation, summarizeRules } from '../shared/rule-policy.ts';

test('rule presentation consistently maps each nature and status to its risk tone', () => {
  const cases = [
    ['prohibited', 'triggered', 'red', 'red', '已命中'],
    ['disclosure', 'triggered', 'yellow', 'amber', '已命中'],
    ['advisory', 'triggered', 'blue', 'blue', '场景提示'],
    ['prohibited', 'insufficient_data', 'yellow', 'amber', '信息不足'],
    ['disclosure', 'insufficient_data', 'blue', 'blue', '信息不足'],
    ['advisory', 'insufficient_data', 'blue', 'blue', '信息不足'],
    ['prohibited', 'not_triggered', 'blue', 'green', '未命中'],
    ['disclosure', 'not_triggered', 'blue', 'green', '未命中'],
    ['advisory', 'not_triggered', 'blue', 'green', '未命中'],
    ['prohibited', 'not_applicable', 'blue', 'neutral', '不适用'],
    ['disclosure', 'not_applicable', 'blue', 'neutral', '不适用'],
    ['advisory', 'not_applicable', 'blue', 'neutral', '不适用'],
  ] as const;

  for (const [nature, status, level, tone, label] of cases) {
    const presentation = rulePresentation({ nature, status });
    assert.equal(presentation.level, level, `${nature}/${status} level`);
    assert.equal(presentation.tone, tone, `${nature}/${status} tone`);
    assert.equal(presentation.label, label, `${nature}/${status} label`);
  }

  assert.equal(gradeRule('disclosure', 'triggered').risk_level, 'yellow');
  assert.equal(gradeRule('advisory', 'triggered').risk_level, null);
  assert.equal(rulePresentation({ nature: 'prohibited', status: 'insufficient_data' }).factLabel, '待补充必要信息');
  assert.equal(rulePresentation({ nature: 'advisory', status: 'not_applicable' }).factLabel, '不在适用范围');
});

test('rule summary separates confirmed issues, unknown checks, advisory hints, and non-hits', () => {
  const summary = summarizeRules([
    { nature: 'prohibited', status: 'insufficient_data' },
    { nature: 'disclosure', status: 'triggered' },
    { nature: 'advisory', status: 'triggered' },
    { nature: 'prohibited', status: 'not_triggered' },
    { nature: 'disclosure', status: 'not_applicable' },
  ]);

  assert.deepEqual(summary.counts, {
    confirmed_issues: 1,
    pending_checks: 1,
    advisory_hints: 1,
    not_triggered: 1,
    not_applicable: 1,
  });
  assert.equal(summary.level, 'yellow');
});

test('unknown and advisory results alone do not raise the conclusion risk level', () => {
  const summary = summarizeRules([
    { nature: 'prohibited', status: 'insufficient_data' },
    { nature: 'advisory', status: 'triggered' },
    { nature: 'disclosure', status: 'not_triggered' },
    { nature: 'prohibited', status: 'not_applicable' },
  ]);

  assert.equal(summary.level, 'blue');
  assert.equal(summary.counts.confirmed_issues, 0);
  assert.equal(summary.counts.pending_checks, 1);
  assert.equal(summary.counts.advisory_hints, 1);
});
