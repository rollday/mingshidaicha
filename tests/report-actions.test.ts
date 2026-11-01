import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupActions } from '../frontend/src/components/report/action-groups.ts';

test('repeated advice is shown once without losing its rule links', () => {
  const groups = groupActions([
    { text: '补充贷款合同或放款日期。', rule_id: 'R01' },
    { text: '补充贷款合同或放款日期。', rule_id: 'R02' },
    { text: '核实收费主体。', rule_id: 'R03' },
    { text: '补充贷款合同或放款日期。', rule_id: 'R01' },
    { text: '核实收费主体。', rule_id: null },
  ]);
  assert.deepEqual(groups, [
    { text: '补充贷款合同或放款日期。', ruleIds: ['R01', 'R02'] },
    { text: '核实收费主体。', ruleIds: ['R03'] },
  ]);
});

test('similar but different advice remains separate', () => {
  const groups = groupActions([
    { text: '核实收费主体。', rule_id: 'R03' },
    { text: '核实收费金额。', rule_id: 'R04' },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.ruleIds), [['R03'], ['R04']]);
});
