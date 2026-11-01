import {
  type ChowdeckEvidenceManifestInputV1,
  computeEvidenceDigests,
  parseEvidenceManifest,
} from './evidence-schema';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const CAPTURED_AT = '2026-09-05T12:34:56.000Z';
const SOURCE_URL =
  'https://chowdeck-api.readme.io/reference/get-merchant-profile.md';
const STABLE_CHANGES: [string, Partial<ChowdeckEvidenceManifestInputV1>][] = [
  ['claim', { claims: [{ ...makeManifest().claims[0], status: 'unproven' }] }],
  ['tool', { captureToolDigest: `sha256:${'b'.repeat(64)}` }],
  [
    'source',
    {
      claims: [
        {
          ...makeManifest().claims[0],
          sourceUrl:
            'https://chowdeck-api.readme.io/reference/list-menu-items.md',
        },
      ],
    },
  ],
];

function makeManifest(
  overrides: Partial<ChowdeckEvidenceManifestInputV1> = {}
): ChowdeckEvidenceManifestInputV1 {
  return {
    contractVersion: 1,
    capturedAt: CAPTURED_AT,
    captureToolDigest: SHA_A,
    runMetrics: {
      documentsAttempted: 1,
      documentsCaptured: 1,
      parsedNodes: 12,
      parsedTextBytes: 120,
      transferredBytes: 240,
    },
    claims: [
      {
        capability: 'account.read',
        status: 'documented',
        sourceUrl: SOURCE_URL,
        sourceKind: 'official_markdown',
        operation: { status: 'unproven' },
        requestFields: [],
        responseFields: [{ name: 'name', type: 'string', required: true }],
        authScheme: 'bearer',
        pagination: 'not_applicable',
        limitations: ['live_behavior_unproven'],
      },
    ],
    limitations: ['public_documentation_shape_only'],
    ...overrides,
  };
}

describe('evidence manifest schema', () => {
  it('accepts a closed documented claim and computes both digests', () => {
    const manifest = computeEvidenceDigests(makeManifest());
    const parsed = parseEvidenceManifest(JSON.stringify(manifest));

    expect(parsed.claims[0]?.status).toBe('documented');
    expect(parsed.sanitizedProjectionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parsed.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('keeps the stable projection digest independent of capture metrics', () => {
    const first = computeEvidenceDigests(makeManifest());
    const second = computeEvidenceDigests(
      makeManifest({
        capturedAt: '2026-09-06T00:00:00.000Z',
        runMetrics: {
          documentsAttempted: 9,
          documentsCaptured: 8,
          parsedNodes: 200,
          parsedTextBytes: 2_000,
          transferredBytes: 4_000,
        },
      })
    );

    expect(second.sanitizedProjectionDigest).toBe(
      first.sanitizedProjectionDigest
    );
    expect(second.digest).not.toBe(first.digest);
  });

  it.each(STABLE_CHANGES)('binds each stable %s value', (_label, overrides) => {
    const baseline = computeEvidenceDigests(makeManifest());
    const changed = computeEvidenceDigests(makeManifest(overrides));

    expect(changed.sanitizedProjectionDigest).not.toBe(
      baseline.sanitizedProjectionDigest
    );
  });

  it('rejects an unknown field instead of persisting it', () => {
    const input = makeManifest();
    const tainted = {
      ...input,
      claims: [{ ...input.claims[0], authorization: 'Bearer value' }],
    };

    expect(() => parseEvidenceManifest(tainted)).toThrow(
      'Invalid evidence manifest'
    );
  });

  it('rejects an unallowlisted URL labeled as an official source', () => {
    const input = makeManifest();
    const claim = input.claims[0];
    if (claim === undefined) throw new Error('invalid test fixture');
    input.claims = [{ ...claim, sourceUrl: 'https://example.test/public.md' }];

    expect(() => computeEvidenceDigests(input)).toThrow(
      'Invalid evidence manifest'
    );
  });

  it('rejects arbitrary observation hosts, paths, queries, fragments, and userinfo', () => {
    const invalidUrls = [
      'https://example.test/observation',
      'https://chowdeck-api.readme.io/reference/get-merchant-profile.md?value=source',
      'https://chowdeck-api.readme.io/reference/get-merchant-profile.md#fragment',
      'https://user@chowdeck-api.readme.io/reference/get-merchant-profile.md',
    ];

    for (const sourceUrl of invalidUrls) {
      const input = makeManifest();
      const claim = input.claims[0];
      if (claim === undefined) throw new Error('invalid test fixture');
      input.claims = [
        { ...claim, sourceKind: 'independent_observation', sourceUrl },
      ];
      expect(() => computeEvidenceDigests(input)).toThrow(
        'Invalid evidence manifest'
      );
    }
  });

  it.each([
    '2026-09-05T12:34:56Z',
    '2026-09-05T13:34:56.000+01:00',
    '2026-09-05 12:34:56.000Z',
  ])('rejects non-canonical capture timestamp %s', (capturedAt) => {
    expect(() =>
      parseEvidenceManifest({ ...makeManifest(), capturedAt })
    ).toThrow('Invalid evidence manifest');
  });

  it('rejects unknown capability, type, status, and limitation values', () => {
    const baseClaim = makeManifest().claims[0];

    for (const claim of [
      { ...baseClaim, capability: 'orders.delete' },
      {
        ...baseClaim,
        responseFields: [{ name: 'name', type: 'free_text', required: true }],
      },
      { ...baseClaim, status: 'verified' },
      { ...baseClaim, limitations: ['copied source prose'] },
    ]) {
      expect(() =>
        parseEvidenceManifest({ ...makeManifest(), claims: [claim] })
      ).toThrow('Invalid evidence manifest');
    }
  });

  it('rejects duplicate keys in serialized evidence before Zod parsing', () => {
    expect(() =>
      parseEvidenceManifest('{"contractVersion":1,"contractVersion":1}')
    ).toThrow('Invalid evidence manifest');
  });
});
