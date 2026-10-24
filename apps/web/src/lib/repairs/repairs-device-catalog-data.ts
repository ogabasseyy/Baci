import { formatSupabaseErrorLog } from '@baci/shared/lib';
import {
  REPAIR_DEVICE_TYPES,
  type RepairDeviceBrandGroup,
  type RepairDeviceSummary,
  type RepairDeviceType,
} from '@baci/shared/repairs';
import { getPublicSupabaseClient } from '@/lib/cached-data';
import { getPrimaryProductImage } from '@/lib/product-image';

const DEVICE_COLUMNS =
  'id, brand, model, slug, device_type, product_id, image_url, aliases, sort_order';
const PRODUCT_IMAGE_LOOKUP_CHUNK_SIZE = 100;
const REPAIR_DEVICE_TYPE_SET: ReadonlySet<string> = new Set(
  REPAIR_DEVICE_TYPES
);

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRepairDeviceType(value: unknown): value is RepairDeviceType {
  return typeof value === 'string' && REPAIR_DEVICE_TYPE_SET.has(value);
}

function extractPrimaryImage(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) {
    return null;
  }
  const productImages = images.filter(
    (image): image is string | { url?: string | null } =>
      typeof image === 'string' ||
      (image !== null &&
        typeof image === 'object' &&
        'url' in image &&
        (typeof image.url === 'string' || image.url === null))
  );
  return getPrimaryProductImage(productImages);
}

function mapDevice(row: Row): RepairDeviceSummary {
  return {
    id: asString(row.id),
    brand: asString(row.brand),
    model: asString(row.model),
    slug: asString(row.slug),
    deviceType: isRepairDeviceType(row.device_type) ? row.device_type : null,
    imageUrl: asNullableString(row.image_url),
    productId: asNullableString(row.product_id),
  };
}

function groupByBrand(rows: Row[]): RepairDeviceBrandGroup[] {
  const groups = new Map<string, RepairDeviceSummary[]>();
  for (const row of rows) {
    const summary = mapDevice(row);
    const existing = groups.get(summary.brand);
    if (existing) {
      existing.push(summary);
    } else {
      groups.set(summary.brand, [summary]);
    }
  }
  return Array.from(groups.entries()).map(([brand, devices]) => ({
    brand,
    devices,
  }));
}

export async function getRepairDevicesForMerchant(
  merchantId: string,
  query?: string
): Promise<RepairDeviceBrandGroup[]> {
  const supabase = getPublicSupabaseClient();
  const normalizedQuery = query?.trim();
  const { data, error } = normalizedQuery
    ? await supabase.rpc('search_repair_devices', {
        p_merchant_id: merchantId,
        p_query: normalizedQuery,
      })
    : await supabase
        .from('repair_devices')
        .select(DEVICE_COLUMNS)
        .eq('merchant_id', merchantId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('brand', { ascending: true })
        .order('model', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Row[];
  const linkedProductIds = Array.from(
    new Set(
      rows
        .filter((row) => !asNullableString(row.image_url))
        .map((row) => asNullableString(row.product_id))
        .filter((id): id is string => id !== null)
    )
  );
  const productImages = new Map<string, string>();

  for (
    let offset = 0;
    offset < linkedProductIds.length;
    offset += PRODUCT_IMAGE_LOOKUP_CHUNK_SIZE
  ) {
    const productIdChunk = linkedProductIds.slice(
      offset,
      offset + PRODUCT_IMAGE_LOOKUP_CHUNK_SIZE
    );
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, images')
      .eq('merchant_id', merchantId)
      .in('id', productIdChunk);

    if (productsError) {
      console.warn(
        'Optional repair device image lookup failed',
        formatSupabaseErrorLog(productsError)
      );
      continue;
    }

    for (const product of (products ?? []) as Row[]) {
      const id = asString(product.id);
      const imageUrl = extractPrimaryImage(product.images);
      if (id && imageUrl) {
        productImages.set(id, imageUrl);
      }
    }
  }

  const rowsWithProductImages = rows.map((row) => ({
    ...row,
    image_url:
      asNullableString(row.image_url) ??
      productImages.get(asString(row.product_id)) ??
      null,
  }));
  return groupByBrand(rowsWithProductImages);
}
