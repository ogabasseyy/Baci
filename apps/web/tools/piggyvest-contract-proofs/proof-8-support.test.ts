import { describe, expect, it } from 'vitest';
import { selectDestinationRow, sharedIdFields } from './proof-8-support';

const expected = {
  reference: 'pvbproof-r1-wallet_transfer-0001',
  amountKobo: 100_000,
  excludeIds: new Set(['old-1']),
};

describe('selectDestinationRow', () => {
  it('prefers the row carrying our reference', () => {
    const match = selectDestinationRow(
      [
        { id: 'a', type: 'credit', amount: 100_000 },
        {
          id: 'b',
          type: 'credit',
          amount: 99_000,
          third_party_reference: expected.reference,
        },
      ],
      expected
    );
    expect(match).toEqual({
      row: expect.objectContaining({ id: 'b' }),
      matchedBy: 'reference',
      ambiguous: false,
    });
  });

  it('never picks a row that existed before the transfer', () => {
    const match = selectDestinationRow(
      [
        {
          id: 'old-1',
          type: 'credit',
          amount: 100_000,
          third_party_reference: expected.reference,
        },
      ],
      expected
    );
    expect(match).toEqual({ row: null, matchedBy: 'none', ambiguous: false });
  });

  it('falls back to the amount only when exactly one new credit row matches', () => {
    expect(
      selectDestinationRow(
        [
          { id: 'c', type: 'credit', amount: 100_000 },
          { id: 'd', type: 'debit', amount: 100_000 },
          'not a record',
        ],
        expected
      )
    ).toEqual({
      row: expect.objectContaining({ id: 'c' }),
      matchedBy: 'amount',
      ambiguous: false,
    });
    expect(
      selectDestinationRow(
        [
          { id: 'c', type: 'credit', amount: 100_000 },
          { id: 'e', type: 'credit', amount: 100_000 },
        ],
        expected
      )
    ).toEqual({ row: null, matchedBy: 'none', ambiguous: true });
  });
});

describe('selectDestinationRow foreign references', () => {
  it('never falls back to a same-amount credit naming another transfer', () => {
    const match = selectDestinationRow(
      [
        {
          id: 'x',
          type: 'credit',
          amount: 100_000,
          third_party_reference: 'pvbproof-r1-wallet_transfer-0099',
        },
      ],
      expected
    );
    expect(match).toEqual({ row: null, matchedBy: 'none', ambiguous: false });
  });

  it('still accepts a lone unreferenced credit beside a foreign one', () => {
    const match = selectDestinationRow(
      [
        {
          id: 'x',
          type: 'credit',
          amount: 100_000,
          third_party_reference: 'other',
        },
        { id: 'y', type: 'credit', amount: 100_000 },
      ],
      expected
    );
    expect(match.row).toEqual(expect.objectContaining({ id: 'y' }));
    expect(match.matchedBy).toBe('amount');
  });
});

describe('sharedIdFields', () => {
  it('names the id-like fields both records hold with the same value', () => {
    expect(
      sharedIdFields(
        { id: 'x', reference: 'r', internal_reference: 'i', session_id: '' },
        { id: 'y', reference: 'r', internal_reference: 'i', session_id: '' }
      )
    ).toEqual(['reference', 'internal_reference']);
  });

  it('is null when either record is missing', () => {
    expect(sharedIdFields(null, { id: 'x' })).toBeNull();
    expect(sharedIdFields({ id: 'x' }, null)).toBeNull();
  });
});
