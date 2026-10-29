import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addExpandedRule,
  navigateToRule,
  resolveRuleHash,
  ruleAnchorId,
  ruleIdFromHash,
  toggleExpandedRule,
} from '../frontend/src/components/report/rule-navigation.ts';

test('rule anchors round-trip encoded ids and reject malformed fragments', () => {
  assert.equal(ruleAnchorId('R03'), 'rule-R03');
  assert.equal(ruleAnchorId('R/03'), 'rule-R%2F03');
  assert.equal(ruleIdFromHash('#rule-R03'), 'R03');
  assert.equal(ruleIdFromHash(`#${ruleAnchorId('R/03')}`), 'R/03');
  assert.equal(ruleIdFromHash('#report-rules'), null);
  assert.equal(ruleIdFromHash('#rule-%E0%A4%A'), null);
});

test('navigation resolves only rules in the report and expands the requested accordion', () => {
  const ruleIds = new Set(['R02', 'R03']);
  const currentlyExpanded = new Set(['R02']);

  assert.equal(resolveRuleHash('#rule-R03', ruleIds), 'R03');
  assert.equal(resolveRuleHash('#rule-R99', ruleIds), null);
  assert.equal(resolveRuleHash('#process-rule-R03', ruleIds), null);
  assert.deepEqual([...addExpandedRule(currentlyExpanded, 'R03')], ['R02', 'R03']);
  assert.deepEqual([...toggleExpandedRule(currentlyExpanded, 'R02')], []);
});

test('navigation writes a history entry only for a changed hash and always dispatches', (t) => {
  const historyState = { keep: 'existing state' };
  const pushes: unknown[][] = [];
  const events: string[] = [];
  const windowDouble = {
    location: { hash: '#before' },
    history: {
      state: historyState,
      pushState: (...args: unknown[]) => {
        pushes.push(args);
        windowDouble.location.hash = String(args[2]);
      },
    },
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  } as unknown as Window;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowDouble });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  navigateToRule('R03');
  navigateToRule('R03');

  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0], [historyState, '', '#rule-R03']);
  assert.deepEqual(events, ['report:rule-navigation', 'report:rule-navigation']);
});
