import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLabConfig,
  labRequestOrigin,
  parseRawAcceptances,
  parseRawInventoryRecords,
} from './lab-route';

const RECORD = {
  assetId: 'logo-a',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  sha256: 'd'.repeat(64),
  slot: 'header-logo',
  sourcePath: 'logo-a.png',
  url: 'https://cdn.example.com/media/logo-a.png',
};

describe('parseRawInventoryRecords', () => {
  it('passes through well-formed records', () => {
    expect(parseRawInventoryRecords([RECORD])).toEqual([RECORD]);
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
});

describe('getLabConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires the lab roots before reading anything', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', '');
    vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', '');
    await expect(getLabConfig()).rejects.toThrow(/INPUT_ROOT/);
  });
});

describe('labRequestOrigin', () => {
  it('builds the origin from well-formed headers', () => {
    expect(
      labRequestOrigin({ host: 'shop.example:3101', proto: 'https' })
    ).toBe('https://shop.example:3101');
  });

  it('takes the first proto token, case-normalized', () => {
    expect(
      labRequestOrigin({ host: 'shop.example', proto: 'HTTPS, http' })
    ).toBe('https://shop.example');
  });

  it('falls back to http for non-http protos', () => {
    expect(
      labRequestOrigin({ host: 'shop.example', proto: 'javascript:' })
    ).toBe('http://shop.example');
    expect(labRequestOrigin({ host: 'shop.example', proto: null })).toBe(
      'http://shop.example'
    );
  });

  it('normalizes the host and drops any path', () => {
    expect(labRequestOrigin({ host: 'Shop.Example/evil', proto: 'http' })).toBe(
      'http://shop.example'
    );
  });

  it('falls back to loopback for missing or malformed hosts', () => {
    expect(labRequestOrigin({ host: null, proto: 'https' })).toBe(
      'http://localhost:3000'
    );
    expect(labRequestOrigin({ host: 'not a host!!', proto: 'https' })).toBe(
      'http://localhost:3000'
    );
  });
});
