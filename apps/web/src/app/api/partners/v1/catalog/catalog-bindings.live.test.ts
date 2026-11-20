import { toGoogleListingCondition } from '@baci/shared/lib';
import { XMLParser } from 'fast-xml-parser';
import { expect, it } from 'vitest';
import { crossRemCatalogConfig } from './catalog-bindings';

type GoogleListing = {
  'g:id': string;
  'g:item_group_id'?: string;
  'g:condition': string;
  'g:link': string;
};

it.runIf(process.env.VERIFY_CROSSREM_LIVE_FEED === '1')(
  'checks all pinned active IDs and sellable identities against live expanded Google listings',
  async () => {
    const response = await fetch(
      'https://ogabassey.com/feeds/google-merchant.xml',
      {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      }
    );
    expect(
      response.status,
      'The pinned Google feed URL did not return 200. Check the canonical URL and upstream feed health.'
    ).toBe(200);
    const parser = new XMLParser({
      parseTagValue: false,
      isArray: (_tag, path) => path === 'rss.channel.item',
    });
    const items: GoogleListing[] = parser.parse(await response.text()).rss
      .channel.item;
    const byId = new Map(items.map((item) => [item['g:id'], item]));
    expect(byId.size).toBe(items.length);

    const mismatches: string[] = [];
    for (const binding of crossRemCatalogConfig.bindings) {
      if (binding.retired) continue;
      const item = byId.get(binding.listingId);
      const variantId =
        item && new URL(item['g:link']).searchParams.get('variantId');
      if (
        !item ||
        (item['g:item_group_id'] ?? item['g:id']) !== binding.productId ||
        (variantId ?? undefined) !== binding.variantId ||
        (binding.offerId && item['g:id'] !== binding.offerId) ||
        item['g:condition'] !== toGoogleListingCondition(binding.condition)
      ) {
        mismatches.push(binding.listingId);
      }
    }
    expect(
      mismatches.slice(0, 20),
      `${mismatches.length} pinned Google listing mismatches`
    ).toEqual([]);
  },
  25_000
);
