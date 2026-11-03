import { describe, expect, it } from 'vitest';
import { answerOf, ProofBuilder } from './proof-builder';
import { Redactor } from './redactor';

const SECRET_ID = '023f843a-be7e-494a-bc5d-9f49f4cc640f';

function ctx() {
  const redactor = new Redactor();
  redactor.register('W', SECRET_ID);
  return { redactor };
}

describe('ProofBuilder', () => {
  it('builds an observed result with findings, values, shapes and notes', () => {
    const b = new ProofBuilder('p1', 'Title')
      .finding('f1', 'Question?', 'yes', 'detail')
      .value('count', 3)
      .value('flag', false)
      .value('missing', null)
      .shape('GET /x', 200, { a: 1, b: 'text' })
      .note('a note');
    const result = b.build(ctx());
    expect(result).toMatchObject({
      proof: 'p1',
      title: 'Title',
      status: 'observed',
      values: { count: 3, flag: false, missing: null },
      notes: ['a note'],
    });
    expect(result.findings).toEqual([
      { id: 'f1', question: 'Question?', answer: 'yes', detail: 'detail' },
    ]);
    expect(result.shapes[0]).toMatchObject({ name: 'GET /x', httpStatus: 200 });
    expect(result.shapes[0].fields.map((f) => f.path)).toEqual(['a', 'b']);
    expect(result.reason).toBeUndefined();
  });

  it('omits the detail key when there is no detail', () => {
    const result = new ProofBuilder('p2', 'T')
      .finding('f', 'Q', 'no')
      .build(ctx());
    expect(result.findings[0]).not.toHaveProperty('detail');
  });

  it('redacts registered values in details, string values, notes and the reason', () => {
    const result = new ProofBuilder('p3', 'T')
      .finding('f', 'Q', 'yes', `wallet ${SECRET_ID}`)
      .value('where', SECRET_ID)
      .note(`saw ${SECRET_ID}`)
      .skip(`blocked on ${SECRET_ID}`)
      .build(ctx());
    expect(JSON.stringify(result)).not.toContain(SECRET_ID);
    expect(result.findings[0].detail).toBe('wallet W1');
    expect(result.values.where).toBe('W1');
    expect(result.reason).toBe('blocked on W1');
  });

  it('ignores a shape whose value is undefined', () => {
    const result = new ProofBuilder('p4', 'T')
      .shape('GET /none', 404, undefined)
      .build(ctx());
    expect(result.shapes).toEqual([]);
  });

  it('records a null http status for a shape taken from a nested object', () => {
    const result = new ProofBuilder('p4', 'T')
      .shape('edge', null, { id: 'x' })
      .build(ctx());
    expect(result.shapes[0].httpStatus).toBeNull();
  });

  describe('status transitions', () => {
    it('skip sets skipped with a reason', () => {
      const result = new ProofBuilder('p5', 'T')
        .skip('needs mutations')
        .build(ctx());
      expect(result).toMatchObject({
        status: 'skipped',
        reason: 'needs mutations',
      });
    });

    it('inconclusive downgrades observed, keeping the first reason', () => {
      const result = new ProofBuilder('p5', 'T')
        .inconclusive('first')
        .inconclusive('second')
        .build(ctx());
      expect(result).toMatchObject({ status: 'inconclusive', reason: 'first' });
    });

    it('inconclusive never overrides skipped or failed', () => {
      expect(
        new ProofBuilder('p5', 'T').skip('s').inconclusive('i').build(ctx())
      ).toMatchObject({ status: 'skipped', reason: 's' });
      expect(
        new ProofBuilder('p5', 'T').fail('f').inconclusive('i').build(ctx())
      ).toMatchObject({ status: 'failed', reason: 'f' });
    });

    it('fail overrides everything', () => {
      const result = new ProofBuilder('p5', 'T')
        .inconclusive('i')
        .fail('boom')
        .build(ctx());
      expect(result).toMatchObject({ status: 'failed', reason: 'boom' });
    });
  });
});

describe('answerOf', () => {
  it('maps true, false and null', () => {
    expect(answerOf(true)).toBe('yes');
    expect(answerOf(false)).toBe('no');
    expect(answerOf(null)).toBe('unknown');
  });
});

describe('ProofBuilder: observed means no finding is left unanswered', () => {
  it('turns an observed proof into inconclusive when a finding is unknown, naming it', () => {
    const result = new ProofBuilder('p5', 'T')
      .finding('answered', 'Q1', 'yes')
      .finding('unanswered', 'Q2', 'unknown', 'a read failed')
      .build(ctx());
    expect(result.status).toBe('inconclusive');
    expect(result.reason).toMatch(/unanswered/);
    expect(result.reason).not.toMatch(/answered,/);
  });

  it('keeps an explicit reason that was set first', () => {
    const result = new ProofBuilder('p5', 'T')
      .inconclusive('the transfer was rejected')
      .finding('f', 'Q', 'unknown')
      .build(ctx());
    expect(result.reason).toBe('the transfer was rejected');
  });

  it('does not count a finding declared unobservable, and records it as unknown', () => {
    const result = new ProofBuilder('p3', 'T')
      .finding('f', 'Q', 'yes')
      .unobservable('webhook', 'Q?', 'the harness has no receiver')
      .build(ctx());
    expect(result.status).toBe('observed');
    expect(result.findings[1]).toMatchObject({
      id: 'webhook',
      answer: 'unknown',
      detail: 'the harness has no receiver',
    });
  });

  it('never upgrades a skipped or failed proof, and leaves an all-answered one observed', () => {
    expect(
      new ProofBuilder('p1', 'T')
        .finding('f', 'Q', 'unknown')
        .skip('off')
        .build(ctx()).status
    ).toBe('skipped');
    expect(
      new ProofBuilder('p1', 'T')
        .finding('f', 'Q', 'unknown')
        .fail('bad')
        .build(ctx()).status
    ).toBe('failed');
    expect(
      new ProofBuilder('p1', 'T').finding('f', 'Q', 'no').build(ctx()).status
    ).toBe('observed');
  });
});
