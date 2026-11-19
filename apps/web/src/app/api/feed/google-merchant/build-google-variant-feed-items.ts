import {
  buildVariantFeedItems,
  type VariantFeedInput,
} from './build-variant-feed-items';
import type { GoogleMerchantListing } from './feed-types';
import { selectFeedFamilyVariant } from './select-feed-family-variant';

/** Google family rows keep the family ID and describe one renderable SKU. */
export function buildGoogleVariantFeedItems(
  input: Omit<VariantFeedInput, 'platform'>
): string {
  const googleInput = { ...input, platform: 'google' as const };
  if (!input.familyRow) return buildVariantFeedItems(googleInput);

  const rows = new Map(
    input.variants.map((variant) => {
      let listing: GoogleMerchantListing | undefined;
      const xml = buildVariantFeedItems({
        ...googleInput,
        variants: [variant],
        collectListing: input.collectListing
          ? (row) => {
              listing = row;
            }
          : undefined,
      });
      return [variant.id, { xml, listing }] as const;
    })
  );
  // Rank only renderable SKUs to preserve verified colour-image matching.
  const selection = selectFeedFamilyVariant(
    input.product,
    input.variants.filter((variant) => Boolean(rows.get(variant.id)?.xml))
  );
  const row = selection && rows.get(selection.id);
  if (!row) return '';
  if (row.listing) input.collectListing?.(row.listing);
  return row.xml;
}
