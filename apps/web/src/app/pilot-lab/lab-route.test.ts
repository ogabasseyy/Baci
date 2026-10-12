import { describe, expect, it } from 'vitest';
import { parseRawAcceptances, parseRawInventoryRecords } from './lab-route';

const RECORD = {
  assetId: 'logo-a',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  schemaVersion: 1,
  sha256: 'd'.repeat(64),
  slot: 'header-logo',
  sourcePath: 'logo-a.png',
  url: 'https://cdn.example.com/media/logo-a.png',
};

describe('parseRawInventoryRecords', () => {
  it('passes through well-formed records', () => {
    // The version gates parsing but is not part of the normalized
    // binding shape downstream.
    expect(parseRawInventoryRecords([RECORD])).toEqual([
      {
        assetId: RECORD.assetId,
        merchantId: RECORD.merchantId,
        role: RECORD.role,
        sha256: RECORD.sha256,
        slot: RECORD.slot,
        sourcePath: RECORD.sourcePath,
        url: RECORD.url,
      },
    ]);
    expect(
      parseRawInventoryRecords([
        { ...RECORD, sourcePath: 'nested/dir/logo-a.png' },
      ])
    ).toHaveLength(1);
  });

  it('rejects non-arrays and malformed records with input-validation errors', () => {
    expect(() => parseRawInventoryRecords({})).toThrow(/must be an array/);
    expect(() => parseRawInventoryRecords([null])).toThrow(/inventory\[0\]/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, merchantId: 7 }])
    ).toThrow(/inventory\[0\].merchantId/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, assetId: undefined }])
    ).toThrow(/inventory\[0\].assetId/);
  });

  it('rejects future or missing inventory schema versions', () => {
    // The generator refuses non-current versions; the route must not
    // normalize them into current-shape bindings.
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, schemaVersion: 2 }])
    ).toThrow(/inventory\[0\].schemaVersion must be 1/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, schemaVersion: undefined }])
    ).toThrow(/inventory\[0\].schemaVersion must be 1/);
  });

  it('rejects missing, non-string, and unsafe source paths', () => {
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, sourcePath: undefined }])
    ).toThrow(/inventory\[0\].sourcePath/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, sourcePath: 42 }])
    ).toThrow(/inventory\[0\].sourcePath/);
    expect(() =>
      parseRawInventoryRecords([{ ...RECORD, sourcePath: '' }])
    ).toThrow(/inventory\[0\].sourcePath/);
    for (const sourcePath of [
      '../escape.png',
      'a/../../escape.png',
      '/abs/logo.png',
      'a\\b.png',
      './logo.png',
      // Transformer-parity hardening: length cap, control characters,
      // and encoded separators fail here, not downstream. Every
      // decode layer is validated, so nested encodings fail too.
      `${'a'.repeat(253)}.png`,
      'a\nb.png',
      'a%2flogo.png',
      'a%5clogo.png',
      'a%00.png',
      'a%252flogo.png',
      'a%25252flogo.png',
      '%2e%2e%2fescape.png',
      '..%2fescape.png',
    ]) {
      expect(() =>
        parseRawInventoryRecords([{ ...RECORD, sourcePath }])
      ).toThrow(/safe relative path/);
    }
  });
});

describe('parseRawAcceptances', () => {
  it('requires an array and passes elements through for schema parsing', () => {
    expect(() => parseRawAcceptances({})).toThrow(/must be an array/);
    expect(parseRawAcceptances([{ verdict: 'accepted' }])).toHaveLength(1);
  });

  it('rejects non-object elements with input-validation errors', () => {
    for (const element of [null, 42, 'accepted', []]) {
      expect(() => parseRawAcceptances([element])).toThrow(
        /acceptances\[0\] must be an object/
      );
    }
    expect(() => parseRawAcceptances([{ verdict: 'accepted' }, null])).toThrow(
      /acceptances\[1\] must be an object/
    );
  });
});
