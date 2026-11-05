import {
  evidenceClaimSchema,
  evidenceManifestInputSchema,
} from './evidence-schema';

const SOURCE_URL =
  'https://chowdeck-api.readme.io/reference/create-menu-category.md';

function claim() {
  return {
    capability: 'menu.category.create',
    status: 'documented',
    sourceUrl: SOURCE_URL,
    sourceKind: 'official_markdown',
    operation: {
      status: 'documented',
      method: 'post',
      pathTemplate: '/merchant/{merchantReference}/menucategory',
    },
    requestFields: [
      { name: 'name', type: 'string', required: true },
      { name: 'reference', type: 'string', required: true },
    ],
    responseFields: [],
    authScheme: 'unproven',
    pagination: 'not_applicable',
    limitations: ['live_behavior_unproven'],
  } as const;
}

describe('evidence claim schema', () => {
  it('accepts only the closed approved operation metadata shape', () => {
    expect(evidenceClaimSchema.parse(claim())).toEqual(claim());
  });

  it('rejects unreviewed field names and observation references', () => {
    expect(
      evidenceClaimSchema.safeParse({
        ...claim(),
        requestFields: [{ name: 'email', type: 'string', required: true }],
      }).success
    ).toBe(false);
    expect(
      evidenceClaimSchema.safeParse({
        ...claim(),
        sourceKind: 'independent_observation',
        sourceUrl: `${SOURCE_URL}?identity=unreviewed`,
      }).success
    ).toBe(false);
  });
});

describe('evidence manifest timestamp', () => {
  it('rejects the prior fractional-second capture with otherwise valid input', () => {
    const result = evidenceManifestInputSchema.safeParse({
      contractVersion: 1,
      capturedAt: '2026-09-08T12:34:56.987Z',
      captureToolDigest: `sha256:${'a'.repeat(64)}`,
      runMetrics: {
        documentsAttempted: 9,
        documentsCaptured: 9,
        parsedNodes: 1,
        parsedTextBytes: 1,
        transferredBytes: 1,
      },
      claims: [],
      limitations: ['public_documentation_shape_only'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        ['capturedAt'],
      ]);
    }
  });
});
