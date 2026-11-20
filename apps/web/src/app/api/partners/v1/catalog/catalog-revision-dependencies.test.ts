import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEED_PRODUCTS_SELECT } from '@/app/api/feed/google-merchant/feed-query';

const repo = new URL('../../../../../../../../', import.meta.url);
const feed = new URL('apps/web/src/app/api/feed/google-merchant/', repo);
const migrations = new URL('supabase/migrations/', repo);

function read(base: URL, fileName: string) {
  return readFileSync(new URL(fileName, base), 'utf8');
}

function columns(value: string) {
  return value
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

const triggerSource = read(
  migrations,
  '20261119170500_crossrem_projection_revisions.sql'
);
const watched = Object.fromEntries(
  Array.from(
    triggerSource.matchAll(
      /\('([a-z_]+)', '(?:merchant_id|product)',\s*'([a-z_,]+)'\)/g
    ),
    ([, relation, fields]) => [relation, columns(fields)]
  )
);

function expectWatched(relation: string, fields: string[]) {
  expect(watched[relation], relation).toEqual(expect.arrayContaining(fields));
}

function selectColumns(fileName: string) {
  const match = read(feed, fileName).match(/\.select\(\s*'([^']+)'\s*\)/);
  expect(match?.[1], fileName).toBeTruthy();
  return columns(match?.[1] ?? '');
}

describe('CrossRem revision dependencies', () => {
  it('covers product selections, ordering and nested joins', () => {
    const keys = FEED_PRODUCTS_SELECT.match(/product_key_specs\(([^()]+)\)/);
    const direct = FEED_PRODUCTS_SELECT.match(
      /categories:category_id\(([^()]+)\)/
    );
    const membership = FEED_PRODUCTS_SELECT.match(
      /product_categories\(categories\(([^()]+)\)\)/
    );
    expect(keys?.[1]).toBeTruthy();
    expect(direct?.[1]).toBeTruthy();
    expect(membership?.[1]).toBeTruthy();
    const rootColumns = columns(
      [keys, direct, membership].reduce(
        (remaining, match) => remaining.replace(match?.[0] ?? '', ''),
        FEED_PRODUCTS_SELECT
      )
    ).filter((field) => field !== 'updated_at');
    expectWatched('products', [
      ...rootColumns,
      'merchant_id',
      'status',
      'created_at',
      'id',
      'category_id',
    ]);
    expectWatched('product_key_specs', [
      ...columns(keys?.[1] ?? ''),
      'product_id',
    ]);
    expectWatched('categories', [
      ...columns(direct?.[1] ?? ''),
      ...columns(membership?.[1] ?? ''),
      'id',
      'merchant_id',
      'is_active',
    ]);
    expectWatched('product_categories', ['id', 'product_id', 'category_id']);
  });

  it('covers offer, variant and delivery-domain inputs and excludes only unselected image audit columns', () => {
    expectWatched('product_offers', [
      ...selectColumns('fetch-active-feed-offers.ts'),
      'status',
      'merchant_id',
    ]);
    const variants = read(feed, 'fetch-feed-variants.ts').match(
      /export interface FeedVariantRow \{([^}]+)\}/
    );
    expect(variants?.[1]).toBeTruthy();
    const variantFields = Array.from(
      (variants?.[1] ?? '').matchAll(/^\s*([a-z_]+)\??:/gm),
      ([, field]) => field
    );
    expectWatched('product_variants', [
      ...variantFields,
      'merchant_id',
      'is_inventory_anchor',
      'created_at',
    ]);
    expectWatched('domains', [
      ...selectColumns('feed-data.ts'),
      'merchant_id',
      'status',
      'is_primary',
    ]);

    const imageUpdate = read(
      migrations,
      '20261119165000_crossrem_image_audit_fields.sql'
    );
    const audit = imageUpdate.match(
      /audit_columns constant text\[\] := ARRAY\[([^\]]+)\]/
    );
    expect(audit?.[1]).toBeTruthy();
    const ignored = Array.from(
      (audit?.[1] ?? '').matchAll(/'([a-z_]+)'/g),
      ([, field]) => field
    );
    for (const field of [
      ...selectColumns('fetch-verified-image-manifest.ts'),
      'id',
      'merchant_id',
    ]) {
      expect(ignored, field).not.toContain(field);
    }
  });
});
