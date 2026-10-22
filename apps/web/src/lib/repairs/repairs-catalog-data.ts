import { formatSupabaseErrorLog } from '@baci/shared/lib';
import {
  REPAIR_DEVICE_TYPES,
  type RepairDeviceBrandGroup,
  type RepairDeviceDetail,
  type RepairDeviceSummary,
  type RepairDeviceType,
  type RepairLinkedProductSummary,
  type RepairProductKeySpec,
  type RepairQuoteSummary,
} from '@baci/shared/repairs';
import { getPublicSupabaseClient } from '@/lib/cached-data';

const DEVICE_COLUMNS =
  'id, brand, model, slug, device_type, product_id, image_url, aliases, sort_order';
const QUOTE_COLUMNS =
  'id, service_type_id, price, is_from_price, part_quality, turnaround, warranty_days, description';
const PRODUCT_IMAGE_LOOKUP_CHUNK_SIZE = 100;

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== null && value !== ''
    ? parsed
    : null;
}

function asDeviceType(value: unknown): RepairDeviceType | null {
  return typeof value === 'string' &&
    (REPAIR_DEVICE_TYPES as readonly string[]).includes(value)
    ? (value as RepairDeviceType)
    : null;
}

function extractPrimaryImage(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) {
    return null;
  }
  const first = images[0];
  if (typeof first === 'string') {
    return first || null;
  }
  if (first && typeof first === 'object' && 'url' in first) {
    return asNullableString((first as { url: unknown }).url);
  }
  return null;
}

function mapDevice(row: Row): RepairDeviceSummary {
  return {
    id: asString(row.id),
    brand: asString(row.brand),
    model: asString(row.model),
    slug: asString(row.slug),
    deviceType: asDeviceType(row.device_type),
    imageUrl: asNullableString(row.image_url),
    productId: asNullableString(row.product_id),
  };
}

function deviceAliases(row: Row): string[] {
  return Array.isArray(row.aliases)
    ? row.aliases.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function matchesQuery(row: Row, query: string): boolean {
  const haystack = [
    asString(row.brand),
    asString(row.model),
    ...deviceAliases(row),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
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
  const { data, error } = await supabase
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
  const normalizedQuery = query?.trim().toLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((row) => matchesQuery(row, normalizedQuery))
    : rows;
  const linkedProductIds = Array.from(
    new Set(
      filteredRows
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

  const rowsWithProductImages = filteredRows.map((row) => ({
    ...row,
    image_url:
      asNullableString(row.image_url) ??
      productImages.get(asString(row.product_id)) ??
      null,
  }));
  return groupByBrand(rowsWithProductImages);
}

function mapQuote(row: Row, serviceTypeName: string): RepairQuoteSummary {
  return {
    id: asString(row.id),
    serviceTypeId: asString(row.service_type_id),
    serviceTypeName,
    price: asNumber(row.price),
    isFromPrice: row.is_from_price !== false,
    partQuality: asNullableString(row.part_quality),
    turnaround: asNullableString(row.turnaround),
    warrantyDays: asNullableNumber(row.warranty_days),
    description: asNullableString(row.description),
  };
}

const KEY_SPEC_FIELDS: ReadonlyArray<{
  column: string;
  label: string;
  suffix?: string;
}> = [
  { column: 'screen_size_inches', label: 'Display', suffix: '"' },
  { column: 'chipset', label: 'Chipset' },
  { column: 'ram_gb', label: 'RAM', suffix: 'GB' },
  { column: 'storage_gb', label: 'Storage', suffix: 'GB' },
  { column: 'main_camera_mp', label: 'Main camera', suffix: 'MP' },
  { column: 'battery_mah', label: 'Battery', suffix: 'mAh' },
];

function buildKeySpecs(specs: Row | null): RepairProductKeySpec[] {
  if (!specs) {
    return [];
  }
  const result: RepairProductKeySpec[] = [];
  for (const field of KEY_SPEC_FIELDS) {
    const raw = specs[field.column];
    if (raw === null || raw === undefined || raw === '') {
      continue;
    }
    result.push({
      label: field.label,
      value: `${raw}${field.suffix ?? ''}`,
    });
  }
  return result;
}

async function loadLinkedProduct(
  productId: string,
  merchantId: string
): Promise<RepairLinkedProductSummary | null> {
  const supabase = getPublicSupabaseClient();
  const { data: product, error } = await supabase
    .from('products')
    .select('id, slug, name, images')
    .eq('id', productId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!product) {
    return null;
  }

  const { data: specs, error: specsError } = await supabase
    .from('product_key_specs')
    .select(
      'screen_size_inches, chipset, ram_gb, storage_gb, main_camera_mp, battery_mah'
    )
    .eq('product_id', productId)
    .maybeSingle();

  if (specsError) {
    throw specsError;
  }

  const productRow = product as Row;
  return {
    id: asString(productRow.id),
    slug: asNullableString(productRow.slug),
    name: asNullableString(productRow.name),
    imageUrl: extractPrimaryImage(productRow.images),
    keySpecs: buildKeySpecs((specs as Row | null) ?? null),
  };
}

export async function getRepairDeviceDetailBySlug(
  merchantId: string,
  deviceSlug: string
): Promise<RepairDeviceDetail | null> {
  const supabase = getPublicSupabaseClient();

  const { data: deviceRow, error: deviceError } = await supabase
    .from('repair_devices')
    .select(DEVICE_COLUMNS)
    .eq('merchant_id', merchantId)
    .eq('slug', deviceSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (deviceError) {
    throw deviceError;
  }
  if (!deviceRow) {
    return null;
  }

  const device = mapDevice(deviceRow as Row);

  const [
    { data: quoteRows, error: quotesError },
    { data: typeRows, error: typesError },
  ] = await Promise.all([
    supabase
      .from('repair_quotes')
      .select(QUOTE_COLUMNS)
      .eq('merchant_id', merchantId)
      .eq('device_id', device.id)
      .eq('is_active', true)
      .order('price', { ascending: true }),
    supabase
      .from('repair_service_types')
      .select('id, name')
      .eq('merchant_id', merchantId)
      .eq('is_active', true),
  ]);

  if (quotesError) {
    throw quotesError;
  }
  if (typesError) {
    throw typesError;
  }

  const serviceTypeNames = new Map<string, string>();
  for (const typeRow of (typeRows ?? []) as Row[]) {
    serviceTypeNames.set(asString(typeRow.id), asString(typeRow.name));
  }

  const quotes = ((quoteRows ?? []) as Row[])
    .filter((row) => serviceTypeNames.has(asString(row.service_type_id)))
    .map((row) =>
      mapQuote(row, serviceTypeNames.get(asString(row.service_type_id)) ?? '')
    );

  const product = device.productId
    ? await loadLinkedProduct(device.productId, merchantId)
    : null;

  return { device, quotes, product };
}
