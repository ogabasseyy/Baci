import { describe, expect, it } from 'vitest';
import {
  extractMetadataField,
  getSafeMetadataDiagnostics,
  isMetadataRecord,
  isString,
  normalizeMetadata,
} from './vtu-metadata-fields';

describe('vtu-metadata-fields', () => {
  it('narrows strings only', () => {
    expect(isString('abc')).toBe(true);
    expect(isString('')).toBe(true);
    expect(isString(42)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString({})).toBe(false);
  });

  it('accepts plain records and rejects arrays, null, and primitives', () => {
    expect(isMetadataRecord({})).toBe(true);
    expect(isMetadataRecord({ a: 1 })).toBe(true);
    expect(isMetadataRecord([])).toBe(false);
    expect(isMetadataRecord([1])).toBe(false);
    expect(isMetadataRecord(null)).toBe(false);
    expect(isMetadataRecord('x')).toBe(false);
    expect(isMetadataRecord(7)).toBe(false);
  });

  it('normalizes non-records to an empty record', () => {
    const record = { a: 1 };
    expect(normalizeMetadata(record)).toBe(record);
    expect(normalizeMetadata(null)).toEqual({});
    expect(normalizeMetadata([1])).toEqual({});
    expect(normalizeMetadata('x')).toEqual({});
  });

  it('extracts validated fields and rejects everything else', () => {
    // Hit: record + present key + passing validator.
    expect(
      extractMetadataField({ gateway: 'paystack' }, 'gateway', isString)
    ).toBe('paystack');
    // Missing key.
    expect(extractMetadataField({}, 'gateway', isString)).toBeNull();
    // Non-record metadata.
    expect(extractMetadataField(null, 'gateway', isString)).toBeNull();
    expect(extractMetadataField([], 'gateway', isString)).toBeNull();
    // Present key, failing validator.
    expect(
      extractMetadataField({ gateway: 42 }, 'gateway', isString)
    ).toBeNull();
  });

  it('allow-lists safe keys and redacts secrets for diagnostics', () => {
    expect(
      getSafeMetadataDiagnostics({
        gateway: 'paystack',
        paymentReference: 'VTU-1',
        voucherPin: '1234',
        customerName: 'Ada',
        internalToken: 'secret',
      })
    ).toEqual({
      gateway: 'paystack',
      paymentReference: 'VTU-1',
      voucherPin: '[REDACTED]',
      customerName: '[REDACTED]',
    });
    expect(getSafeMetadataDiagnostics({})).toEqual({});
  });
});
