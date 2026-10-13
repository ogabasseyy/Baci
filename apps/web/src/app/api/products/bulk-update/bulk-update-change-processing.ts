import type { SupabaseClient } from '@supabase/supabase-js';
import { generateProductSlug, generateSlug } from '@/lib/seo-utils';
import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import {
  type BulkUpdateChange,
  groupBulkUpdateChanges,
} from './bulk-update-change-groups';
import {
  BULK_PURGE_ROW_COLUMNS,
  type BulkPurgeProductRow,
  getBulkPurgeEntries,
} from './bulk-update-purge-entries';

type ProductChangeResult = {
  updated: number;
  created: number;
  removed: number;
  errors: string[];
};

const BULK_UPDATE_CONCURRENCY = 10;

const emptyProductChangeResult = (): ProductChangeResult => ({
  updated: 0,
  created: 0,
  removed: 0,
  errors: [],
});

function summarizeChangeFailure(
  change: BulkUpdateChange,
  err: unknown
): string {
  const safeName = String(change.details?.name || 'unknown')
    .replace(/[\r\n]/g, '')
    .substring(0, 100);
  const safeType = String(change.type || 'unknown').replace(/[\r\n]/g, '');
  console.error('Error processing change for:', safeName, err);
  return `Failed to ${safeType} "${safeName}"`;
}

async function processBulkUpdateChange({
  change,
  currency,
  merchantBusinessName,
  merchantId,
  onPurgeEntries,
  onResolvedProductIds,
  supabase,
}: {
  change: BulkUpdateChange;
  currency: string;
  merchantBusinessName: string;
  merchantId: string;
  onPurgeEntries?: (entries: StorefrontProductPurgeEntry[]) => void;
  onResolvedProductIds?: (productIds: string[]) => void;
  supabase: SupabaseClient;
}): Promise<ProductChangeResult> {
  const result = emptyProductChangeResult();

  try {
    if (change.type === 'update') {
      const productId = change.productId?.trim();
      const sku = change.details.sku?.trim();
      const name = change.details.name?.trim() ?? '';

      if (!productId && !sku && !name) {
        result.errors.push(
          'Skipped update without a product id, SKU, or product name.'
        );
        return result;
      }

      const updates: Record<string, unknown> = {
        price: change.newPrice ?? change.details.price,
        category: change.details.category,
      };
      if (name) updates.name = name;
      if (typeof change.details.cost_price === 'number') {
        updates.cost_price = change.details.cost_price;
      } else if (
        change.details.cost_price === null &&
        change.details.cost_price_was_edited === true
      ) {
        updates.cost_price = null;
      }

      let previousQuery = supabase
        .from('products')
        .select(BULK_PURGE_ROW_COLUMNS);
      if (productId) {
        previousQuery = previousQuery
          .eq('id', productId)
          .eq('merchant_id', merchantId);
      } else if (sku) {
        previousQuery = previousQuery
          .eq('sku', sku)
          .eq('merchant_id', merchantId);
      } else {
        previousQuery = previousQuery
          .eq('name', name)
          .eq('merchant_id', merchantId);
      }
      const { data: previousRows, error: previousError } = await previousQuery;
      if (previousError) throw previousError;

      let matchQuery = supabase.from('products').update(updates);
      if (productId) {
        matchQuery = matchQuery
          .eq('id', productId)
          .eq('merchant_id', merchantId);
      } else if (sku) {
        matchQuery = matchQuery.eq('sku', sku).eq('merchant_id', merchantId);
      } else {
        matchQuery = matchQuery.eq('name', name).eq('merchant_id', merchantId);
      }

      const { data: updatedRows, error } = await matchQuery.select(
        BULK_PURGE_ROW_COLUMNS
      );
      if (error) throw error;
      onResolvedProductIds?.(
        (updatedRows as BulkPurgeProductRow[] | null | undefined)
          ?.map((row) => row.id?.trim())
          .filter((id): id is string => Boolean(id)) ?? []
      );
      onPurgeEntries?.(
        getBulkPurgeEntries(
          updatedRows as BulkPurgeProductRow[] | null,
          previousRows as BulkPurgeProductRow[] | null
        )
      );
      result.updated = 1;
      return result;
    }

    if (change.type === 'new') {
      const slug = generateProductSlug(change.details.name, 'new', undefined);
      const sku =
        change.details.sku ||
        generateSlug(change.details.name).toUpperCase().substring(0, 20);

      const { error } = await supabase
        .from('products')
        .insert({
          merchant_id: merchantId,
          name: change.details.name,
          description: change.details.description || '',
          price: change.details.price,
          cost_price: change.details.cost_price,
          stock_quantity: change.details.stock || 0,
          sku,
          slug,
          status: 'draft',
          condition: 'new',
          manage_stock: true,
          brand: change.details.brand || merchantBusinessName,
          category: change.details.category || 'General',
          taxable: true,
          schema_markup: {
            '@context': 'https://schema.org/',
            '@type': 'Product',
            name: change.details.name,
            sku,
            brand: {
              '@type': 'Brand',
              name: change.details.brand || merchantBusinessName,
            },
            offers: {
              '@type': 'Offer',
              priceCurrency: currency,
              price: change.details.price,
              availability: 'https://schema.org/InStock',
            },
          },
        })
        .select('id')
        .maybeSingle();

      if (error) throw error;
      result.created = 1;
      return result;
    }

    if (change.type === 'remove' && change.productId) {
      const { data: previousRows, error: previousError } = await supabase
        .from('products')
        .select(BULK_PURGE_ROW_COLUMNS)
        .eq('id', change.productId)
        .eq('merchant_id', merchantId);
      if (previousError) throw previousError;

      const { data: archivedRows, error } = await supabase
        .from('products')
        .update({ status: 'archived' })
        .eq('id', change.productId)
        .eq('merchant_id', merchantId)
        .select(BULK_PURGE_ROW_COLUMNS);
      if (error) throw error;
      onResolvedProductIds?.(
        (archivedRows as BulkPurgeProductRow[] | null | undefined)
          ?.map((row) => row.id?.trim())
          .filter((id): id is string => Boolean(id)) ?? []
      );
      onPurgeEntries?.(
        getBulkPurgeEntries(
          archivedRows as BulkPurgeProductRow[] | null,
          previousRows as BulkPurgeProductRow[] | null
        )
      );
      result.removed = 1;
    }
  } catch (err) {
    result.errors.push(summarizeChangeFailure(change, err));
  }

  return result;
}

async function processChangeGroup(
  args: Omit<Parameters<typeof processBulkUpdateChange>[0], 'change'> & {
    group: BulkUpdateChange[];
  }
): Promise<ProductChangeResult> {
  const summary = emptyProductChangeResult();

  for (const change of args.group) {
    const result = await processBulkUpdateChange({ ...args, change });
    summary.updated += result.updated;
    summary.created += result.created;
    summary.removed += result.removed;
    summary.errors.push(...result.errors);
  }

  return summary;
}

export async function processBulkUpdateChanges({
  changes,
  currency,
  merchantBusinessName,
  merchantId,
  onPurgeEntries,
  onResolvedProductIds,
  supabase,
}: {
  changes: BulkUpdateChange[];
  currency: string;
  merchantBusinessName: string;
  merchantId: string;
  onPurgeEntries?: (entries: StorefrontProductPurgeEntry[]) => void;
  onResolvedProductIds?: (productIds: string[]) => void;
  supabase: SupabaseClient;
}): Promise<ProductChangeResult> {
  const summary = emptyProductChangeResult();
  const groupedChanges = groupBulkUpdateChanges(changes);

  for (
    let offset = 0;
    offset < groupedChanges.length;
    offset += BULK_UPDATE_CONCURRENCY
  ) {
    const groupResults = await Promise.all(
      groupedChanges
        .slice(offset, offset + BULK_UPDATE_CONCURRENCY)
        .map((group) =>
          processChangeGroup({
            group,
            currency,
            merchantBusinessName,
            merchantId,
            onPurgeEntries,
            onResolvedProductIds,
            supabase,
          })
        )
    );

    for (const groupResult of groupResults) {
      summary.updated += groupResult.updated;
      summary.created += groupResult.created;
      summary.removed += groupResult.removed;
      summary.errors.push(...groupResult.errors);
    }
  }

  return summary;
}
