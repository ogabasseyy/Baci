import { describe, expect, it } from 'vitest';
import { sourceManifestSchema } from './public-document-sources';

describe('public document source manifest', () => {
  it.each([
    {
      url: 'https://example.com/doc.md',
      kind: 'official_markdown',
      fetch: true,
    },
    {
      url: 'https://example.com/ref',
      kind: 'quarantined_reference_only',
      fetch: false,
    },
  ])('accepts valid source variants', (source) => {
    expect(
      sourceManifestSchema.safeParse({ version: 1, sources: [source] }).success
    ).toBe(true);
  });
  it.each([
    { url: 'https://example.com', kind: 'other', fetch: false },
    { url: 'https://example.com', kind: 'official_markdown', fetch: false },
    {
      url: 'https://example.com',
      kind: 'quarantined_reference_only',
      fetch: true,
    },
    {
      url: 'https://example.com',
      kind: 'official_markdown',
      fetch: true,
      extra: 1,
    },
  ])('rejects unsupported or inconsistent source variants', (source) => {
    expect(
      sourceManifestSchema.safeParse({ version: 1, sources: [source] }).success
    ).toBe(false);
  });
  it('rejects unknown manifest keys', () => {
    expect(
      sourceManifestSchema.safeParse({ version: 1, sources: [], extra: true })
        .success
    ).toBe(false);
  });
});
