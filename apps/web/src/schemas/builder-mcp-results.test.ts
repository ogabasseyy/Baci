import { expect, it } from 'vitest';
import { getBuilderCapabilities } from '@/lib/builder-connector/tool-policy';
import {
  builderCapabilitiesSchema,
  builderOutputSchemas,
} from './builder-mcp-results';

const store = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000001';
const capabilities = getBuilderCapabilities('puck', 'baci-home-six-v1');
const status = {
  storefrontId: store,
  draftVersion: 'draft',
  publishedVersion: null,
  isPublished: false,
  latestReceipt: null,
  missingItems: [],
  pendingOperationIds: [],
  supportedPageSlugs: ['home'],
  capabilities,
};
it('validates supported capability/explicit page results', () => {
  expect(
    builderOutputSchemas.get_storefront_status.safeParse(status).success
  ).toBe(true);
  expect(
    builderOutputSchemas.get_storefront_status.safeParse({
      ...status,
      supportedPageSlugs: ['about'],
    }).success
  ).toBe(false);
  expect(
    builderCapabilitiesSchema.safeParse({
      ...getBuilderCapabilities('custom', null),
      canEdit: true,
    }).success
  ).toBe(false);
});
it('rejects a nested receipt for a different storefront', () => {
  expect(
    builderOutputSchemas.get_storefront_status.safeParse({
      ...status,
      latestReceipt: {
        storefrontId: other,
        version: 'draft',
        receiptId: store,
        publishedVersion: 'public',
        status: 'verifying',
      },
    }).success
  ).toBe(false);
});
it('does not represent an uncommitted approval intent as a publication receipt', () => {
  expect(
    builderOutputSchemas.get_storefront_status.safeParse({
      ...status,
      latestReceipt: {
        storefrontId: store,
        version: 'draft',
        status: 'approval_required',
        intentId: other,
        approvalUrl: 'https://usebaci.com/builder/approve',
      },
    }).success
  ).toBe(false);
});
it('rejects an untrusted approval destination', () => {
  for (const approvalUrl of [
    'http://usebaci.com/builder/approve',
    'https://attacker.invalid/builder/approve',
    'https://usebaci.com/redirect',
  ])
    expect(
      builderOutputSchemas.publish_storefront.safeParse({
        storefrontId: store,
        version: 'draft',
        status: 'approval_required',
        intentId: other,
        approvalUrl,
      }).success
    ).toBe(false);
});
it('uses a bounded inert projection and rejects cross-store catalog data', () => {
  const preview = {
    storefrontId: store,
    version: 'draft',
    pageSlug: 'home',
    projection: {
      config: {
        root: { props: { rendererVersion: 'baci-home-six-v1', title: 'Shop' } },
        content: [{ type: 'Text', props: { id: 'text', content: 'Welcome' } }],
      },
      identity: {
        id: store,
        template_id: 'puck',
        slug: 'shop',
        business_name: 'Shop',
      },
      catalog: {
        merchantId: store,
        capturedAt: '2026-10-22T10:00:00Z',
        products: [],
      },
      inert: true,
    },
    readiness: { ready: true, missingItems: [] },
  };
  expect(
    builderOutputSchemas.preview_storefront.safeParse(preview).success
  ).toBe(true);
  expect(
    builderOutputSchemas.preview_storefront.safeParse({
      ...preview,
      projection: {
        ...preview.projection,
        catalog: { ...preview.projection.catalog, merchantId: other },
      },
    }).success
  ).toBe(false);
  expect(
    builderOutputSchemas.preview_storefront.safeParse({
      ...preview,
      projection: {
        ...preview.projection,
        identity: { ...preview.projection.identity, id: other },
      },
    }).success
  ).toBe(false);
  expect(
    builderOutputSchemas.preview_storefront.safeParse({
      ...preview,
      projection: { ...preview.projection, inert: false },
    }).success
  ).toBe(false);
});

it('accepts canonical existing short slugs without weakening slug syntax', () => {
  const list = (slug: string) => ({
    stores: [
      { storefrontId: store, name: 'Shop', slug, onboardingComplete: true },
    ],
    nextCursor: null,
  });
  for (const slug of ['a', 'ab', 'a-b'])
    expect(
      builderOutputSchemas.list_storefronts.safeParse(list(slug)).success
    ).toBe(true);
  for (const slug of ['', '-a', 'a-', 'a/b', 'A'])
    expect(
      builderOutputSchemas.list_storefronts.safeParse(list(slug)).success
    ).toBe(false);
});
