import { describe, expect, it } from 'vitest';
import {
  findMonnifyBodyVendReference,
  hasMonnifyProviderReference,
  ignoreMonnifyRequestEcho,
  readMonnifyRejectionVendReference,
} from './monnify-rejection-vend-reference';

const ref = 'a1b2c3d4e5f6a1b2c3d4e5f6';

describe('readMonnifyRejectionVendReference', () => {
  it("returns Monnify's own vendReference", () => {
    expect(
      readMonnifyRejectionVendReference(
        { responseBody: { vendReference: ' MFBP-9 ' } },
        ref
      )
    ).toBe('MFBP-9');
  });

  it('ignores an echo of our own request reference', () => {
    expect(
      readMonnifyRejectionVendReference(
        { responseBody: { vendReference: ref.toUpperCase() } },
        ref
      )
    ).toBeUndefined();
  });

  it.each([
    null,
    'x',
    [],
    { responseBody: null },
    { responseBody: {} },
  ])('returns nothing for %j', (answer) => {
    expect(readMonnifyRejectionVendReference(answer, ref)).toBeUndefined();
  });
});

describe('bugfix: vendReference is found in every supported answer shape', () => {
  it.each([
    ['snake_case keys', { response_body: { vend_reference: 'MFBP-1' } }],
    ['PascalCase keys', { ResponseBody: { VendReference: 'MFBP-1' } }],
    [
      'a form-encoded answer parsed into one-pair objects',
      [{ responseBody: { vendReference: 'MFBP-1' } }, { responseCode: '99' }],
    ],
    [
      'a deeper nested body',
      { data: { responseBody: { vendReference: 'MFBP-1' } } },
    ],
  ])('finds it in %s', (_label, answer) => {
    expect(findMonnifyBodyVendReference(answer)).toBe('MFBP-1');
  });

  it('does not take a top-level vendReference outside responseBody', () => {
    expect(
      findMonnifyBodyVendReference({ vendReference: 'MFBP-1' })
    ).toBeUndefined();
  });

  it('ignores blank values and reads a numeric reference as a string', () => {
    expect(
      findMonnifyBodyVendReference({ responseBody: { vendReference: '  ' } })
    ).toBeUndefined();
    expect(
      findMonnifyBodyVendReference({ responseBody: { vendReference: 12 } })
    ).toBe('12');
  });
});

describe('ignoreMonnifyRequestEcho', () => {
  it('keeps a different reference and drops our own', () => {
    expect(ignoreMonnifyRequestEcho('MFBP-1', ref)).toBe('MFBP-1');
    expect(ignoreMonnifyRequestEcho(ref, ref)).toBeUndefined();
    expect(ignoreMonnifyRequestEcho(undefined, ref)).toBeUndefined();
  });
});

describe('bugfix: ambiguous or shallow-first vendReference selection', () => {
  it('prefers the shallowest reference over a deeper one', () => {
    expect(
      findMonnifyBodyVendReference({
        responseBody: {
          vendReference: 'MFBP-TOP',
          history: { responseBody: { vendReference: 'MFBP-OLD' } },
        },
      })
    ).toBe('MFBP-TOP');
  });

  it('returns nothing when two different references sit at the same depth', () => {
    expect(
      findMonnifyBodyVendReference([
        { responseBody: { vendReference: 'MFBP-1' } },
        { responseBody: { vendReference: 'MFBP-2' } },
      ])
    ).toBeUndefined();
  });
});

describe('hasMonnifyProviderReference', () => {
  it('is true for a reference that is not an exact echo of our request', () => {
    expect(
      hasMonnifyProviderReference(
        { responseBody: { transactionReference: 'T-1' } },
        ref
      )
    ).toBe(true);
    expect(
      hasMonnifyProviderReference(
        { responseBody: { vendReference: 'MFBP-1' } },
        ref
      )
    ).toBe(true);
  });

  it('is true for a DIFFERENT 24-hex reference (only an exact echo is excluded)', () => {
    expect(
      hasMonnifyProviderReference(
        { responseBody: { vendReference: 'ffffffffffffffffffffffff' } },
        ref
      )
    ).toBe(true);
  });

  it('is false for an exact echo (any casing) or no reference', () => {
    expect(
      hasMonnifyProviderReference(
        { responseBody: { transactionReference: ref.toUpperCase() } },
        ref
      )
    ).toBe(false);
    expect(hasMonnifyProviderReference({ responseBody: {} }, ref)).toBe(false);
  });
});

describe('bugfix: top-level provider references count as evidence', () => {
  it('finds a top-level transactionReference or vendReference', () => {
    expect(
      hasMonnifyProviderReference({ transactionReference: 'T-1' }, ref)
    ).toBe(true);
    expect(hasMonnifyProviderReference({ vendReference: 'MFBP-1' }, ref)).toBe(
      true
    );
  });

  it('still ignores an exact top-level echo of our request reference', () => {
    expect(hasMonnifyProviderReference({ vendReference: ref }, ref)).toBe(
      false
    );
  });

  it('does not use a top-level vendReference as the requery reference', () => {
    expect(
      findMonnifyBodyVendReference({ vendReference: 'MFBP-1' })
    ).toBeUndefined();
  });
});

describe('bugfix: every reference shape vend evidence reads counts as a provider reference', () => {
  it.each([
    [
      'numeric transactionReference',
      { responseBody: { transactionReference: 12345 } },
    ],
    ['paymentReference', { responseBody: { paymentReference: 'PAY-1' } }],
    ['transactionId', { responseBody: { transactionId: 'TX-1' } }],
  ])('counts %s', (_label, answer) => {
    expect(hasMonnifyProviderReference(answer, ref)).toBe(true);
  });

  it('ignores validation/request/customer references', () => {
    expect(
      hasMonnifyProviderReference(
        {
          validationReference: 'v',
          customerReference: 'c',
          requestReference: 'r',
        },
        ref
      )
    ).toBe(false);
  });
});

describe('bugfix: array-valued references and the short top-level ref key', () => {
  it('reads an array-valued transactionReference', () => {
    expect(
      hasMonnifyProviderReference(
        { responseBody: { transactionReference: ['MFBP-1'] } },
        ref
      )
    ).toBe(true);
  });
});

describe('bugfix: a foreign bare top-level reference counts, an exact echo does not', () => {
  it('counts a provider-issued top-level reference or ref', () => {
    expect(hasMonnifyProviderReference({ reference: 'MFBP-1' }, ref)).toBe(
      true
    );
    expect(hasMonnifyProviderReference({ ref: 'MFBP-1' }, ref)).toBe(true);
  });

  it('ignores an exact echo under reference or ref', () => {
    expect(hasMonnifyProviderReference({ reference: ref }, ref)).toBe(false);
    expect(hasMonnifyProviderReference({ ref: ref.toUpperCase() }, ref)).toBe(
      false
    );
  });
});

describe('bugfix: a vendReference under a non-vend ancestor is not the requery key', () => {
  it.each([
    'refund',
    'request',
    'error',
    'reversal',
  ])('ignores responseBody.%s.vendReference', (parent) => {
    expect(
      findMonnifyBodyVendReference({
        responseBody: { [parent]: { vendReference: 'MFBP-OTHER' } },
      })
    ).toBeUndefined();
  });

  it('prefers the real responseBody.vendReference beside a refund one', () => {
    expect(
      findMonnifyBodyVendReference({
        responseBody: {
          vendReference: 'MFBP-REAL',
          refund: { vendReference: 'MFBP-OTHER' },
        },
      })
    ).toBe('MFBP-REAL');
  });
});
