import { describe, expect, it } from 'vitest';
import {
  acceptanceKey,
  isHttpUrl,
  isSafeRelativePath,
  sameAcceptance,
  stagedOriginalName,
  validAcceptanceShape,
  validInventoryRecord,
} from './merchant-image-pilot-preflight-records.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('acceptanceKey', () => {
  it('keys acceptances by merchant and asset', () => {
    expect(acceptanceKey({ assetId: 'a', merchantId: MERCHANT })).toBe(
      `${MERCHANT}/a`
    );
  });
});

describe('sameAcceptance', () => {
  const base = {
    generationId: 'c'.repeat(64),
    outputHashes: ['a'.repeat(64), 'b'.repeat(64)],
    recipeId: 'pilot/r1',
    sourceSha256: 'd'.repeat(64),
    verdict: 'accepted',
  };

  it('compares identity fields with positional hashes', () => {
    expect(sameAcceptance(base, { ...base })).toBe(true);
    expect(
      sameAcceptance(base, {
        ...base,
        outputHashes: ['b'.repeat(64), 'a'.repeat(64)],
      })
    ).toBe(false);
    expect(sameAcceptance(base, { ...base, verdict: 'rejected' })).toBe(false);
    expect(
      sameAcceptance(base, { ...base, outputHashes: ['a'.repeat(64)] })
    ).toBe(false);
  });
});

describe('stagedOriginalName', () => {
  const binding = { assetId: 'logo-a', merchantId: MERCHANT };

  it('derives the staged name from the verified format, never the filename', () => {
    // The inventory filename may lie about the bytes; the suffix always
    // describes the decode-verified manifest format, exactly like the
    // loader — otherwise staging and preflight desync on lying names.
    expect(stagedOriginalName(binding, 'png')).toBe(`${MERCHANT}-logo-a.png`);
    expect(stagedOriginalName(binding, 'jpeg')).toBe(`${MERCHANT}-logo-a.jpg`);
    expect(stagedOriginalName(binding, 'webp')).toBe(`${MERCHANT}-logo-a.webp`);
    expect(stagedOriginalName(binding, 'avif')).toBe(`${MERCHANT}-logo-a.avif`);
  });

  it('fails closed on formats with no servable suffix', () => {
    expect(() => stagedOriginalName(binding, 'tiff')).toThrow(
      /no servable suffix/
    );
    expect(() => stagedOriginalName(binding, '')).toThrow(/no servable suffix/);
  });
});

describe('isSafeRelativePath', () => {
  it('accepts clean relative paths', () => {
    expect(isSafeRelativePath('snapshots/a.png')).toBe(true);
  });

  it('rejects traversal, absolute, and backslash forms', () => {
    for (const bad of [
      '',
      '/abs.png',
      '../escape.png',
      'a/../../escape.png',
      'a/./b.png',
      'a//b.png',
      'a\\b.png',
      '..',
      '.',
      // Route parity: length cap, control characters, encoded separators.
      `${'a'.repeat(253)}.png`,
      'a\nb.png',
      'a%2fb.png',
      'a%5cb.png',
      'a%00.png',
      // Nested encodings: every decode layer is validated.
      'a%252fb.png',
      'a%25252fb.png',
      '%2e%2e%2fescape.png',
      '..%2fescape.png',
      null,
      undefined,
      42,
    ]) {
      expect(isSafeRelativePath(bad)).toBe(false);
    }
  });
});

describe('isHttpUrl', () => {
  it('allows http(s) and rejects the rest', () => {
    expect(isHttpUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/a.png')).toBe(true);
    expect(isHttpUrl('ftp://cdn.example.com/a.png')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
});

describe('validInventoryRecord', () => {
  const good = {
    assetId: 'logo-a',
    merchantId: MERCHANT,
    role: 'logo',
    sha256: 'd'.repeat(64),
    slot: 'header-logo',
    sourcePath: 'snapshots/logo-a.png',
    url: 'https://cdn.example.com/media/logo-a.png',
  };

  it('accepts a well-formed record', () => {
    expect(validInventoryRecord(good)).toBe(true);
  });

  it('rejects records the route would reject', () => {
    for (const bad of [
      { ...good, merchantId: 'not-a-uuid' },
      { ...good, assetId: '../evil' },
      { ...good, role: 'banner' },
      { ...good, slot: '' },
      { ...good, slot: 's'.repeat(129) },
      { ...good, sha256: 'short' },
      { ...good, sourcePath: '../escape.png' },
      { ...good, url: 'ftp://cdn.example.com/a.png' },
      null,
      [],
    ]) {
      expect(validInventoryRecord(bad)).toBeFalsy();
    }
  });
});

describe('validAcceptanceShape', () => {
  const good = {
    assetId: 'logo-a',
    generationId: 'c'.repeat(64),
    merchantId: MERCHANT,
    note: 'looks right',
    outputHashes: ['e'.repeat(64)],
    recipeId: 'pilot/r1',
    reviewedAt: '2026-10-01T10:00:00Z',
    reviewer: 'lab-operator',
    schemaVersion: 1,
    sourceSha256: 'd'.repeat(64),
    verdict: 'accepted',
  };

  it('accepts a strict well-formed acceptance', () => {
    expect(validAcceptanceShape(good)).toBe(true);
  });

  it('enforces strict keys and field contracts', () => {
    const { note, ...missing } = good;
    expect(note).toBe('looks right');
    for (const bad of [
      missing,
      { ...good, extra: 1 },
      { ...good, verdict: 'maybe' },
      { ...good, outputHashes: [] },
      { ...good, outputHashes: ['short'] },
      { ...good, reviewedAt: '2026-10-01' },
      { ...good, schemaVersion: 2 },
      { ...good, generationId: 'short' },
      null,
      [],
    ]) {
      expect(validAcceptanceShape(bad)).toBe(false);
    }
  });
});
