import { describe, expect, it } from 'vitest';
import { builderInputSchemas, parseBuilderRequest } from './builder-mcp';
import { builderOutputSchemas } from './builder-mcp-results';

const id = '10000000-0000-4000-8000-000000000001';
const key = '20000000-0000-4000-8000-000000000001';
const input = {
  storefrontId: id,
  expectedVersion: 'opaque:0001',
  idempotencyKey: key,
};
const cases = {
  list_storefronts: {},
  get_storefront_status: { storefrontId: id },
  create_storefront_draft: {
    businessName: 'Shop',
    businessType: 'electronics',
    country: 'Nigeria',
    requestedSlug: 'my-store',
    idempotencyKey: key,
  },
  update_storefront_draft: {
    ...input,
    pageSlug: 'home',
    instructions: 'Make the heading blue',
  },
  get_storefront_operation: { storefrontId: id, operationId: key },
  apply_storefront_operation: { ...input, operationId: key },
  preview_storefront: {
    storefrontId: id,
    expectedVersion: input.expectedVersion,
    pageSlug: 'home',
  },
  publish_storefront: input,
};
describe('merchant builder inputs', () => {
  for (const [tool, value] of Object.entries(cases)) {
    it(`${tool} accepts its strict semantic contract`, () =>
      expect(
        builderInputSchemas[tool as keyof typeof cases].safeParse(value).success
      ).toBe(true));
    it(`${tool} rejects raw configuration and identity fields`, () => {
      for (const extra of [
        { config: {} },
        { actorUserId: id },
        { approved: true },
        { token: 'secret' },
      ])
        expect(
          builderInputSchemas[tool as keyof typeof cases].safeParse({
            ...value,
            ...extra,
          }).success
        ).toBe(false);
    });
  }
  it('uses current onboarding country/type/slug rules', () => {
    expect(
      builderInputSchemas.create_storefront_draft.parse(
        cases.create_storefront_draft
      ).country
    ).toBe('NG');
    for (const patch of [
      { country: 'unknown' },
      { businessType: 'invented' },
      { requestedSlug: 'admin' },
      { requestedSlug: 'unsafe/slug' },
      { requestedSlug: 'x'.repeat(64) },
    ])
      expect(
        builderInputSchemas.create_storefront_draft.safeParse({
          ...cases.create_storefront_draft,
          ...patch,
        }).success
      ).toBe(false);
  });
  it('bounds text, revisions, cursors and pagination', () => {
    for (const instructions of ['', 'x'.repeat(4001)])
      expect(
        builderInputSchemas.update_storefront_draft.safeParse({
          ...cases.update_storefront_draft,
          instructions,
        }).success
      ).toBe(false);
    for (const pageSize of [0, 21, 1.5])
      expect(
        builderInputSchemas.list_storefronts.safeParse({ pageSize }).success
      ).toBe(false);
    expect(builderInputSchemas.list_storefronts.parse({}).pageSize).toBe(20);
    expect(
      builderInputSchemas.create_storefront_draft.safeParse({
        ...cases.create_storefront_draft,
        brandBrief: 'x'.repeat(4001),
      }).success
    ).toBe(false);
    expect(
      builderInputSchemas.publish_storefront.safeParse({
        ...input,
        expectedVersion: 123,
      }).success
    ).toBe(false);
  });
  it('rejects unsupported pages and oversized UTF-8 before business work', () => {
    for (const pageSlug of ['about', 'contact', 'checkout'])
      expect(
        parseBuilderRequest(
          'update_storefront_draft',
          JSON.stringify({ ...cases.update_storefront_draft, pageSlug })
        )
      ).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_PAGE' } });
    expect(
      parseBuilderRequest('list_storefronts', ' '.repeat(65537))
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(
      parseBuilderRequest('list_storefronts', '💥'.repeat(17000))
    ).toMatchObject({ ok: false });
    expect(parseBuilderRequest('list_storefronts', '{')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(
      parseBuilderRequest('list_storefronts', `${' '.repeat(65534)}{}`)
    ).toMatchObject({ ok: true });
  });
});
describe('builder result unions', () => {
  it('supports running operations without exposing candidate data', () => {
    const running = {
      storefrontId: id,
      operationId: key,
      sourceVersion: 'opaque',
      status: 'running',
      summary: 'Generating your draft',
    };
    expect(
      builderOutputSchemas.get_storefront_operation.safeParse(running).success
    ).toBe(true);
    expect(
      builderOutputSchemas.get_storefront_operation.safeParse({
        ...running,
        candidate: {},
      }).success
    ).toBe(false);
  });
  it('keeps delivery variants distinct and handles native supersession without a newer receipt', () => {
    const receipt = {
      storefrontId: id,
      version: 'draft',
      receiptId: key,
      publishedVersion: 'public',
    };
    for (const result of [
      {
        ...receipt,
        status: 'verifying',
        deliveryBlockedReason: 'Cache retry pending',
      },
      {
        ...receipt,
        status: 'live',
        publicUrl: 'https://my-store.usebaci.com',
        verifiedAt: '2026-10-21T10:00:00Z',
      },
      { ...receipt, status: 'superseded', currentPublishedVersion: null },
    ])
      expect(
        builderOutputSchemas.publish_storefront.safeParse(result).success
      ).toBe(true);
    expect(
      builderOutputSchemas.publish_storefront.safeParse({
        ...receipt,
        status: 'verifying',
        publicUrl: 'https://example.com',
      }).success
    ).toBe(false);
    expect(
      builderOutputSchemas.publish_storefront.safeParse({
        ...receipt,
        status: 'live',
      }).success
    ).toBe(false);
  });
  it('limits the owned-store list to the current zero-or-one model', () => {
    const store = {
      storefrontId: id,
      name: 'Shop',
      slug: 'shop',
      onboardingComplete: false,
    };
    expect(
      builderOutputSchemas.list_storefronts.safeParse({
        stores: [store, store],
        nextCursor: null,
      }).success
    ).toBe(false);
  });
});
