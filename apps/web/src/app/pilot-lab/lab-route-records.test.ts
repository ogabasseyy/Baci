import { describe, expect, it } from 'vitest';
import {
  parseRawAcceptances,
  parseRawInventoryRecords,
} from './lab-route-records';

function inventoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    assetId: 'logo-a',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    role: 'logo',
    schemaVersion: 1,
    sha256: 'a'.repeat(64),
    slot: 'header-logo',
    sourcePath: 'snapshots/logo-a.png',
    url: 'https://cdn.example.com/media/logo-a.png',
    ...overrides,
  };
}

describe('parseRawInventoryRecords', () => {
  it('parses valid records, projecting only the raw fields', () => {
    const parsed = parseRawInventoryRecords([
      inventoryRecord({ extra: 'dropped' }),
    ]);
    expect(parsed).toEqual([
      {
        assetId: 'logo-a',
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        role: 'logo',
        sha256: 'a'.repeat(64),
        slot: 'header-logo',
        sourcePath: 'snapshots/logo-a.png',
        url: 'https://cdn.example.com/media/logo-a.png',
      },
    ]);
  });

  it('rejects every malformed record shape with an input-validation error', () => {
    expect(() => parseRawInventoryRecords({})).toThrow(
      /inventory\.json must be an array/
    );
    expect(() => parseRawInventoryRecords([null])).toThrow(
      /inventory\[0\] is not a record/
    );
    expect(() =>
      parseRawInventoryRecords([inventoryRecord({ assetId: '' })])
    ).toThrow(/inventory\[0\]\.assetId must be a nonempty string/);
    expect(() =>
      parseRawInventoryRecords([inventoryRecord({ slot: 7 })])
    ).toThrow(/inventory\[0\]\.slot must be a nonempty string/);
    expect(() =>
      parseRawInventoryRecords([
        inventoryRecord({ sourcePath: '../escape.png' }),
      ])
    ).toThrow(/sourcePath must be a safe relative path/);
    expect(() =>
      parseRawInventoryRecords([inventoryRecord({ schemaVersion: 2 })])
    ).toThrow(/schemaVersion must be 1/);
  });
});

describe('parseRawAcceptances', () => {
  it('passes objects through for the lab-index schema', () => {
    const acceptance = { verdict: 'accepted' };
    expect(parseRawAcceptances([acceptance])).toEqual([acceptance]);
  });

  it('rejects non-arrays and non-object elements', () => {
    expect(() => parseRawAcceptances({})).toThrow(
      /acceptances\.json must be an array/
    );
    expect(() => parseRawAcceptances(['verdict'])).toThrow(
      /acceptances\[0\] must be an object/
    );
    expect(() => parseRawAcceptances([null])).toThrow(
      /acceptances\[0\] must be an object/
    );
    expect(() => parseRawAcceptances([[{}]])).toThrow(
      /acceptances\[0\] must be an object/
    );
  });
});
