import { sanitizeMarkdownText } from '@/lib/llms-markdown-sanitize';

const KEY_SPEC_FIELDS: ReadonlyArray<{
  keys: readonly string[];
  label: string;
  suffix?: string;
}> = [
  { keys: ['chipset', 'processor'], label: 'Processor' },
  { keys: ['ram_gb'], label: 'RAM', suffix: 'GB' },
  { keys: ['storage_gb'], label: 'Storage', suffix: 'GB' },
  {
    keys: ['screen_size_inches', 'display_size_inches'],
    label: 'Display Size',
    suffix: ' inches',
  },
  { keys: ['display_type'], label: 'Display Type' },
  { keys: ['battery_mah'], label: 'Battery', suffix: 'mAh' },
  { keys: ['main_camera_mp'], label: 'Main Camera', suffix: 'MP' },
  { keys: ['front_camera_mp'], label: 'Front Camera', suffix: 'MP' },
  { keys: ['gpu'], label: 'Graphics' },
  { keys: ['android_version', 'os'], label: 'Operating System' },
  { keys: ['network_technology', 'network'], label: 'Network' },
  { keys: ['sim_type'], label: 'SIM' },
  { keys: ['warranty'], label: 'Warranty' },
];

function isNumericSpec(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'string') return /^-?\d+(\.\d+)?$/.test(value.trim());
  return false;
}

export function buildProductKeySpecsSection(specs: unknown): string[] {
  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) {
    return [];
  }

  const record = specs as Record<string, unknown>;
  const specBullets: string[] = [];

  for (const { keys, label, suffix } of KEY_SPEC_FIELDS) {
    const rawVal = keys
      .map((key) => record[key])
      .find(
        (val) => val !== null && val !== undefined && String(val).trim() !== ''
      );
    if (rawVal === null || rawVal === undefined) continue;
    const strVal = String(rawVal).trim();
    if (!strVal) continue;

    const formattedValue =
      suffix && isNumericSpec(rawVal)
        ? `${typeof rawVal === 'number' ? String(rawVal) : strVal}${suffix}`
        : strVal;

    specBullets.push(`- ${label}: ${sanitizeMarkdownText(formattedValue)}`);
  }

  return specBullets.length > 0
    ? ['## Key Specifications', ...specBullets, '']
    : [];
}
