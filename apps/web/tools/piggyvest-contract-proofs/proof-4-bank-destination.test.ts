import { afterEach, describe, expect, it } from 'vitest';
import { runBankDestinationCheck } from './proof-4-bank-destination';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { ProofResult } from './types';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const answer = (result: ProofResult, id: string) =>
  result.findings.find((f) => f.id === id)?.answer;

async function check(h: ReturnType<typeof harness>) {
  await setupScenario(h.ctx);
  const posts = h.mock.calls.filter((c) => c.method === 'POST').length;
  const b = new ProofBuilder('p4', 'Withdrawal counter');
  await runBankDestinationCheck(h.ctx, b);
  expect(h.mock.calls.filter((c) => c.method === 'POST').length).toBe(posts);
  return b.build(h.ctx);
}

describe('proof 4: sandbox bank destination check (reads only)', () => {
  it('confirms a listed bank code and a resolvable account, never emitting the account name', async () => {
    const h = harness();
    const result = await check(h);
    expect(result.status).toBe('observed');
    expect(answer(result, 'bank_code_listed')).toBe('yes');
    expect(answer(result, 'bank_destination_resolves')).toBe('yes');
    expect(result.values.bank_list_size).toBe(2);
    expect(JSON.stringify(result)).not.toContain('SANDBOX ACCOUNT HOLDER');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('shows why a configured destination would be refused', async () => {
    const h = harness({ bank: { code: '9999999', account: '0123456789' } });
    const result = await check(h);
    expect(answer(result, 'bank_code_listed')).toBe('no');
    expect(answer(result, 'bank_destination_resolves')).toBe('no');
    expect(result.values.name_enquiry_message).toBe(
      'Could not resolve account name'
    );
    expect(JSON.stringify(result)).not.toContain('9999999');
    expect(JSON.stringify(result)).not.toContain('0123456789');
  });

  it('sends GET requests only, whatever the run mode', async () => {
    const h = harness({ mode: 'live-readonly' });
    const result = await check(h);
    expect(answer(result, 'bank_code_listed')).toBe('yes');
  });

  it('is inconclusive when no destination is configured', async () => {
    const h = harness({ bank: null });
    const result = await check(h);
    expect(answer(result, 'bank_code_listed')).toBe('unknown');
    expect(result.status).toBe('inconclusive');
    expect(result.reason).toMatch(/PVB_PROOF_BANK_CODE/);
  });
});
