import {
  REPAIR_DEVICE_TYPES,
  type RepairDeviceDetail,
  type RepairDeviceSummary,
  type RepairDeviceType,
  type RepairLinkedProductSummary,
  type RepairProductKeySpec,
  type RepairQuoteSummary,
} from '@baci/shared/repairs';
import { getPublicSupabaseClient } from '@/lib/cached-data';

export { getRepairDevicesForMerchant } from './repairs-device-catalog-data';

const QUOTE_COLUMNS =
  'id, service_type_id, price, is_from_price, part_quality, turnaround, warranty_days, description';
const DEVICE_COLUMNS =
  'id, brand, model, slug, device_type, product_id, image_url, aliases, sort_order';

type Row = Record<string, unknown>;
const REPAIR_DEVICE_TYPE_SET: ReadonlySet<string> = new Set(
  REPAIR_DEVICE_TYPES
);

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

function isRepairDeviceType(value: unknown): value is RepairDeviceType {
  return typeof value === 'string' && REPAIR_DEVICE_TYPE_SET.has(value);
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
    deviceType: isRepairDeviceType(row.device_type) ? row.device_type : null,
    imageUrl: asNullableString(row.image_url),
    productId: asNullableString(row.product_id),
  };
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
