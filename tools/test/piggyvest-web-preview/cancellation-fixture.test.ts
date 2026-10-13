import { expect, it } from 'vitest';
import { createCancellationFixture } from './cancellation-fixture';

function confirmation(fixture: ReturnType<typeof createCancellationFixture>) {
  const {
    status: _status,
    dispatch: _dispatch,
    interestDisposition: _interest,
    ...assertions
  } = fixture.quote;
  return { ...assertions, operationId: fixture.operationId, accepted: true };
}

it('returns synthetic prepared and uncertain receipts for exact confirmations', async () => {
  for (const result of ['prepared', 'uncertain'] as const) {
    const fixture = createCancellationFixture('a', result);
    expect(fixture.quote).toMatchObject({
      principalKobo: 10000,
      paidInterestKobo: 700,
      pendingInterestKobo: 300,
    });
    const input = confirmation(fixture);
    const receipt = await fixture.prepare(input);
    expect(receipt).toMatchObject({
      goalId: fixture.quote.goalId,
      operationId: fixture.operationId,
      status: result === 'prepared' ? 'prepared' : 'unavailable',
      dispatch: 'contract_gap',
    });
    expect(await fixture.prepare(input)).toEqual(receipt);
  }
});

it('rejects malformed, extra, unaccepted and stale confirmation fields', async () => {
  const fixture = createCancellationFixture('a', 'prepared');
  const input = confirmation(fixture);
  for (const change of [
    { accepted: false },
    { confirmed: true },
    { principalKobo: 9999 },
    { paidInterestKobo: 701 },
    { pendingInterestKobo: 301 },
    { goalId: createCancellationFixture('b', 'prepared').quote.goalId },
    { operationId: '80000000-0000-4000-8000-000000000099' },
    { revisionId: '70000000-0000-4000-8000-000000000099' },
    { termsVersion: 'other' },
    { termsHash: 'b'.repeat(64) },
    { consentVersion: 'other' },
  ]) {
    await expect(fixture.prepare({ ...input, ...change })).rejects.toThrow();
  }
});
