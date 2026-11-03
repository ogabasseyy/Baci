import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail } from './mock-sandbox-types';
import { createMemoryJournal } from './mutation-journal';
import { runBvnCollision } from './proof-1-bvn-collision';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { ProofResult } from './types';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const answer = (result: ProofResult, id: string) =>
  result.findings.find((f) => f.id === id)?.answer;
const posts = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter((call) => call.method === 'POST').length;

async function collide(h: ReturnType<typeof harness>, setup = true) {
  if (setup) await setupScenario(h.ctx);
  const b = new ProofBuilder('p1', 'Create-customer re-POST');
  await runBvnCollision(h.ctx, b);
  return b.build(h.ctx);
}

describe('proof 1: same BVN under a different third_party_identifier', () => {
  it('records that the provider hands back the original customer and wallet, and changes nothing', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const before = posts(h);
    const result = await collide(h, false);
    expect(posts(h)).toBe(before + 1);
    expect(result.status).toBe('observed');
    expect(answer(result, 'bvn_collision_accepted')).toBe('yes');
    expect(answer(result, 'bvn_collision_returns_original_customer')).toBe(
      'yes'
    );
    expect(answer(result, 'bvn_collision_reports_new_customer')).toBe('no');
    expect(
      answer(result, 'bvn_collision_returns_original_default_wallet')
    ).toBe('yes');
    expect(answer(result, 'original_identifier_unchanged')).toBe('yes');
    expect(result.values.bvn_collision_http_status).toBe(200);
    expect(result.values.other_identifier_lookup).toBe('none');
    expect(
      result.shapes.some((s) => s.name.startsWith('POST /customers (same BVN'))
    ).toBe(true);
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('records a separate customer when the provider does not match on BVN, and never uses it', async () => {
    const h = harness({ mock: { customerMatchOn: 'email_only' } });
    await setupScenario(h.ctx);
    const before = posts(h);
    const result = await collide(h, false);
    expect(answer(result, 'bvn_collision_returns_original_customer')).toBe(
      'no'
    );
    expect(answer(result, 'bvn_collision_reports_new_customer')).toBe('yes');
    expect(
      answer(result, 'bvn_collision_returns_original_default_wallet')
    ).toBe('no');
    expect(result.values.other_identifier_lookup).toBe('other_customer');
    // Nothing is created or moved under the second customer.
    expect(posts(h)).toBe(before + 1);
    expect(h.mock.sandbox.customers).toHaveLength(2);
    expect(h.state.authorized.size).toBe(2);
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('records a refusal as not applicable for the follow-up questions', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    vi.spyOn(h.mock.sandbox, 'createCustomer').mockReturnValue(
      fail('BVN 00012345678 is already registered', 400)
    );
    const result = await collide(h, false);
    expect(answer(result, 'bvn_collision_accepted')).toBe('no');
    expect(answer(result, 'bvn_collision_returns_original_customer')).toBe(
      'not_applicable'
    );
    expect(answer(result, 'bvn_collision_reports_new_customer')).toBe(
      'not_applicable'
    );
    expect(result.values.bvn_collision_outcome).toBe('rejected');
    expect(result.values.bvn_collision_message).toBe(
      'BVN <number> is already registered'
    );
    expect(result.status).toBe('observed');
  });

  it('never resends the collision create on a re-run', async () => {
    const journal = createMemoryJournal();
    const first = harness({ journal });
    await collide(first);
    first.dispose();
    const h = harness({ journal });
    h.mock.sandbox.adopt(first.mock.sandbox);
    await setupScenario(h.ctx);
    const before = posts(h);
    const result = await collide(h, false);
    expect(posts(h)).toBe(before);
    expect(result.status).toBe('inconclusive');
    expect(answer(result, 'bvn_collision_accepted')).toBe('unknown');
  });

  it('sends nothing in read-only mode or without a QA customer', async () => {
    const readonly = harness({ mode: 'live-readonly' });
    const r1 = await collide(readonly);
    expect(posts(readonly)).toBe(0);
    expect(r1.status).toBe('inconclusive');
    expect(r1.reason).toMatch(/QA customer unavailable/);
    readonly.dispose();

    const h = harness();
    const r2 = await collide(h, false);
    expect(posts(h)).toBe(0);
    expect(r2.status).toBe('inconclusive');
  });
});
