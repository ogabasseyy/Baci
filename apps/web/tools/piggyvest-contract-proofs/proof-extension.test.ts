import { describe, expect, it } from 'vitest';
import type { ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { mergeResults, mergeStatus, withExtension } from './proof-extension';
import { Redactor } from './redactor';
import { HarnessRefusal } from './safety-guards';
import type { ProofResult } from './types';

const base = (over: Partial<ProofResult> = {}): ProofResult => ({
  proof: 'p2',
  title: 'Base title',
  status: 'observed',
  findings: [{ id: 'a', question: 'A?', answer: 'yes' }],
  shapes: [],
  values: { shared: 1, only_base: true },
  notes: ['base note'],
  ...over,
});

const ctx = { redactor: new Redactor() } as unknown as ProofContext;
const runner = (result: ProofResult) => async () => result;

describe('mergeStatus', () => {
  it('keeps the worst outcome: failed, then inconclusive; skipped only when both are', () => {
    expect(mergeStatus('observed', 'observed')).toBe('observed');
    expect(mergeStatus('observed', 'inconclusive')).toBe('inconclusive');
    expect(mergeStatus('inconclusive', 'observed')).toBe('inconclusive');
    expect(mergeStatus('observed', 'skipped')).toBe('inconclusive');
    expect(mergeStatus('skipped', 'skipped')).toBe('skipped');
    expect(mergeStatus('skipped', 'failed')).toBe('failed');
    expect(mergeStatus('failed', 'observed')).toBe('failed');
  });
});

describe('mergeResults', () => {
  it('appends findings, shapes and notes and never drops a colliding value', () => {
    const merged = mergeResults(
      base(),
      base({
        status: 'inconclusive',
        reason: 'added step not settled',
        findings: [{ id: 'b', question: 'B?', answer: 'unknown' }],
        values: { shared: 2, only_extra: 'x' },
        notes: ['extra note'],
      })
    );
    expect(merged.proof).toBe('p2');
    expect(merged.title).toBe('Base title');
    expect(merged.status).toBe('inconclusive');
    expect(merged.reason).toBe('added step not settled');
    expect(merged.findings.map((f) => f.id)).toEqual(['a', 'b']);
    expect(merged.values).toEqual({
      shared: 1,
      only_base: true,
      shared_ext: 2,
      only_extra: 'x',
    });
    expect(merged.notes).toEqual(['base note', 'extra note']);
  });

  it('joins both reasons when both parts fall short, and carries none when observed', () => {
    expect(
      mergeResults(
        base({ status: 'inconclusive', reason: 'one' }),
        base({ status: 'failed', reason: 'two' })
      ).reason
    ).toBe('one; two');
    expect(mergeResults(base(), base())).not.toHaveProperty('reason');
  });
});

describe('withExtension', () => {
  it('runs the base proof, then the added step on a builder for the same proof', async () => {
    const order: string[] = [];
    const run = withExtension(
      async () => {
        order.push('base');
        return base();
      },
      async (_ctx, b: ProofBuilder) => {
        order.push('extension');
        b.finding('b', 'B?', 'no').value('only_extra', 3);
      }
    );
    const result = await run(ctx);
    expect(order).toEqual(['base', 'extension']);
    expect(result.status).toBe('observed');
    expect(result.findings.map((f) => f.id)).toEqual(['a', 'b']);
    expect(result.values.only_extra).toBe(3);
  });

  it('records an unexpected error in the added step as a failure, details withheld', async () => {
    const run = withExtension(runner(base()), async () => {
      throw new Error('provider said: secret detail');
    });
    const result = await run(ctx);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('details withheld');
    expect(JSON.stringify(result)).not.toContain('secret detail');
  });

  it('lets a harness refusal stop the whole run', async () => {
    const run = withExtension(runner(base()), async () => {
      throw new HarnessRefusal('WALLET_NOT_AUTHORIZED', 'no');
    });
    await expect(run(ctx)).rejects.toBeInstanceOf(HarnessRefusal);
  });
});
