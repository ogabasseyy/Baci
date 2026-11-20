import { describe, expect, it } from 'vitest';
import {
  findMonnifyBodyVendReference,
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

  it('ignores blank and non-string values', () => {
    expect(
      findMonnifyBodyVendReference({ responseBody: { vendReference: '  ' } })
    ).toBeUndefined();
    expect(
      findMonnifyBodyVendReference({ responseBody: { vendReference: 12 } })
    ).toBeUndefined();
  });
});

describe('ignoreMonnifyRequestEcho', () => {
  it('keeps a different reference and drops our own', () => {
    expect(ignoreMonnifyRequestEcho('MFBP-1', ref)).toBe('MFBP-1');
    expect(ignoreMonnifyRequestEcho(ref, ref)).toBeUndefined();
    expect(ignoreMonnifyRequestEcho(undefined, ref)).toBeUndefined();
  });
});
