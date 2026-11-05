import { coreEvidenceChapterSchema } from './core-evidence-chapters';

const common = {
  version: 1,
  capturedAt: '2026-09-08T12:00:00.000Z',
  publicContractDigest: `sha256:${'a'.repeat(64)}`,
};
const accountRead = {
  ...common,
  chapter: '0A-core/account-read',
  claims: {
    authenticationScheme: 'documented',
    endpoint: 'documented',
    responseEnvelope: 'unproven',
    domainField: 'unproven',
    vendorIdField: 'unproven',
    currencyField: 'unproven',
    multipleProfileSelection: 'unproven',
  },
  activation: 'disabled',
  blockerCode: 'provider_response_schema_unproven',
};
const menuGroupsItems = {
  ...common,
  chapter: '0A-core/menu-groups-items',
  claims: {
    categoryListEndpoint: 'documented',
    menuListEndpoint: 'documented',
    exactItemEndpoint: 'documented',
    menuGroupReadEndpoint: 'unproven',
    responseEnvelopes: 'unproven',
    categoryFields: 'unproven',
    itemFields: 'unproven',
    groupFields: 'unproven',
    listCompleteness: 'unproven',
    missingItemSemantics: 'unproven',
  },
  catalogRead: 'disabled',
  catalogWrite: 'disabled',
};
const errorPaginationLimits = {
  ...common,
  chapter: '0A-core/error-pagination-limits',
  claims: {
    stableProviderErrorCodes: 'unproven',
    absenceSemantics: 'unproven',
    pagination: 'unproven',
    cursorSemantics: 'unproven',
    listOrdering: 'unproven',
    requestLimit: 'unproven',
    responseLimit: 'unproven',
    rateLimit: 'unproven',
    retryGuidance: 'unproven',
  },
  runtimeErrorProjection: 'local_stable_codes_only',
  activation: 'disabled',
};

describe('core evidence chapter schema', () => {
  it.each([
    '2026-02-30T00:00:00.000Z',
    '2026-01-01T25:00:00.000Z',
  ])('rejects impossible capturedAt %s', (capturedAt) => {
    expect(
      coreEvidenceChapterSchema.safeParse({ ...accountRead, capturedAt })
        .success
    ).toBe(false);
  });
  it.each([
    accountRead,
    menuGroupsItems,
    errorPaginationLimits,
  ])('parses each closed provisional chapter', (chapter) => {
    expect(coreEvidenceChapterSchema.parse(chapter)).toEqual(chapter);
  });

  it('rejects identity-bearing extension fields', () => {
    expect(
      coreEvidenceChapterSchema.safeParse({
        ...accountRead,
        merchantReference: 'merchant-123',
      }).success
    ).toBe(false);
  });
  it('does not permit a provisional chapter to claim activation or proven response fields', () => {
    expect(
      coreEvidenceChapterSchema.safeParse({
        ...accountRead,
        activation: 'enabled',
      }).success
    ).toBe(false);
    expect(
      coreEvidenceChapterSchema.safeParse({
        ...accountRead,
        claims: { ...accountRead.claims, responseEnvelope: 'documented' },
      }).success
    ).toBe(false);
    expect(
      coreEvidenceChapterSchema.safeParse({
        ...menuGroupsItems,
        catalogWrite: 'enabled',
      }).success
    ).toBe(false);
  });
});
