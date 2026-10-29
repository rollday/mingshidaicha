import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaseModel } from '../src/case-model.ts';

type MockChunk = {
  choices: Array<{ finish_reason: string | null; delta: { content: string | null } }>;
};

type MockStream = AsyncIterable<MockChunk> & { controller: { abort(): void } };

function responseStream(content: string, finishReason: string | null = 'stop'): MockStream {
  return {
    controller: { abort() {} },
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ finish_reason: finishReason, delta: { content } }] };
    },
  };
}

function modelWith(create: (call: number, signal: AbortSignal) => MockStream | Promise<MockStream>) {
  const model = new CaseModel({ apiKey: '', model: 'test-model', reasoningEffort: 'none' } as CaseModel['settings']);
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: (_request: unknown, options: { signal: AbortSignal }) => create(++calls, options.signal),
      },
    },
  };
  model.client = client as unknown as NonNullable<CaseModel['client']>;
  return { model, callCount: () => calls };
}

function json(model: CaseModel, signal = new AbortController().signal) {
  return model.json('system', 'content', signal, () => {});
}

test('accepts valid JSON from the first model response without retrying', async () => {
  const fixture = modelWith(() => responseStream('{"ok":true}'));

  assert.deepEqual(await json(fixture.model), { ok: true });
  assert.equal(fixture.callCount(), 1);
});

test('retries invalid JSON once and accepts valid JSON from the retry', async () => {
  const responses = ['not JSON', '{"ok":true}'];
  const fixture = modelWith(call => responseStream(responses[call - 1]!));

  assert.deepEqual(await json(fixture.model), { ok: true });
  assert.equal(fixture.callCount(), 2);
});

test('notifies a streaming caller before retry so it can clear invalid first-attempt text', async () => {
  const responses = ['not JSON', '{"ok":true}'];
  const fixture = modelWith(call => responseStream(responses[call - 1]!));
  let streamedRaw = '';
  let retryNotifications = 0;

  const result = await fixture.model.json('system', 'content', new AbortController().signal, () => {},
    delta => { streamedRaw += delta; },
    () => { retryNotifications++; streamedRaw = ''; });

  assert.deepEqual(result, { ok: true });
  assert.equal(retryNotifications, 1);
  assert.equal(streamedRaw, '{"ok":true}');
  assert.equal(fixture.callCount(), 2);
});

test('throws MODEL_INVALID_JSON after the single retry also returns invalid JSON', async () => {
  const fixture = modelWith(() => responseStream('not JSON'));

  await assert.rejects(json(fixture.model), { code: 'MODEL_INVALID_JSON' });
  assert.equal(fixture.callCount(), 2);
});

test('does not retry an incomplete model response', async () => {
  const fixture = modelWith(() => responseStream('{"ok":true}', 'length'));

  await assert.rejects(json(fixture.model), { code: 'MODEL_INCOMPLETE' });
  assert.equal(fixture.callCount(), 1);
});

test('does not retry a network failure', async () => {
  const fixture = modelWith(() => { throw new Error('network unavailable'); });

  await assert.rejects(json(fixture.model), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(fixture.callCount(), 1);
});

test('does not retry after cancellation', async () => {
  const controller = new AbortController();
  const fixture = modelWith(() => {
    controller.abort();
    return responseStream('{"ok":true}');
  });

  await assert.rejects(json(fixture.model, controller.signal), { code: 'TASK_CANCELLED' });
  assert.equal(fixture.callCount(), 1);
});

test('extract spends its only retry on JSON parsing before structure validation', async () => {
  const responses = ['not JSON', '{}'];
  const fixture = modelWith(call => responseStream(responses[call - 1]!));

  await assert.rejects(fixture.model.extract([], undefined, new AbortController().signal, () => {}), { code: 'MODEL_INVALID_FIELDS' });
  assert.equal(fixture.callCount(), 2);
});

test('extract spends its only retry on structure repair and does not retry invalid JSON again', async () => {
  const responses = ['{}', 'not JSON'];
  const fixture = modelWith(call => responseStream(responses[call - 1]!));

  await assert.rejects(fixture.model.extract([], undefined, new AbortController().signal, () => {}), { code: 'MODEL_INVALID_JSON' });
  assert.equal(fixture.callCount(), 2);
});

test('extract can still complete one successful structure repair', async () => {
  const responses = ['{}', '{"facts":{},"evidence":[],"questions":[],"conflicts":[]}'];
  const fixture = modelWith(call => responseStream(responses[call - 1]!));

  const result = await fixture.model.extract([], undefined, new AbortController().signal, () => {});
  assert.deepEqual(result.evidence, []);
  assert.equal(fixture.callCount(), 2);
});
