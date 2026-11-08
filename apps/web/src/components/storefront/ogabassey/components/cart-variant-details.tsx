import { canonicalizeCommerceVariantAxis } from '@baci/shared/lib/commerce-variant-axis';
import { formatCanonicalProductConditionLabel } from '@baci/shared/lib/product-condition';

interface VariantDetailsItem {
  condition?: string;
  selectedColor?: string;
  selectedColorValue?: string;
  selectedStorage?: string;
  secondaryColor?: string;
  variantAttributes?: Record<string, string>;
}

function resolveCartColorHex(name: string, explicitValue?: string): string {
  const trimmed = explicitValue?.trim();
  if (trimmed && (/^#[0-9a-f]{3,8}$/i.test(trimmed) || /^(rgb|hsl)a?\(/i.test(trimmed))) {
    return trimmed;
  }

  const lower = name.toLowerCase();
  if (
    lower.includes('black') ||
    lower.includes('obsidian') ||
    lower.includes('midnight') ||
    lower.includes('graphite')
  ) {
    return '#1f2937';
  }
  if (
    lower.includes('white') ||
    lower.includes('starlight') ||
    lower.includes('porcelain')
  ) {
    return '#f4f4f5';
  }
  if (lower.includes('silver') || lower.includes('platinum')) {
    return '#d4d4d8';
  }
  if (
    lower.includes('natural') ||
    lower.includes('titanium') ||
    lower.includes('grey') ||
    lower.includes('gray')
  ) {
    return '#9ca3af';
  }
  if (
    lower.includes('blue') ||
    lower.includes('pacific') ||
    lower.includes('ultramarine') ||
    lower.includes('navy')
  ) {
    return '#3b82f6';
  }
  if (lower.includes('gold') || lower.includes('desert')) {
    return '#e5c185';
  }
  if (lower.includes('purple') || lower.includes('violet') || lower.includes('lavender')) {
    return '#9333ea';
  }
  if (lower.includes('green') || lower.includes('mint') || lower.includes('teal')) {
    return '#16a34a';
  }
  if (lower.includes('pink') || lower.includes('rose')) {
    return '#f472b6';
  }
  if (lower.includes('red') || lower.includes('coral')) {
    return '#dc2626';
  }
  if (lower.includes('yellow') || lower.includes('orange')) {
    return '#f59e0b';
  }

  return '#cbd5e1';
}

export function resolveCartColorChipStyle(
  name: string,
  explicitValue?: string
): { backgroundColor: string; color: string; borderColor: string } {
  const lower = name.toLowerCase();

  if (
    lower.includes('black') ||
    lower.includes('obsidian') ||
    lower.includes('midnight') ||
    lower.includes('graphite')
  ) {
    return {
      backgroundColor: '#1f2937',
      color: '#ffffff',
      borderColor: '#111827',
    };
  }
  if (
    lower.includes('white') ||
    lower.includes('starlight') ||
    lower.includes('porcelain')
  ) {
    return {
      backgroundColor: '#ffffff',
      color: '#3f3f46',
      borderColor: '#d4d4d8',
    };
  }
  if (lower.includes('silver') || lower.includes('platinum')) {
    return {
      backgroundColor: '#e4e4e7',
      color: '#27272a',
      borderColor: '#cbd5e1',
    };
  }
  if (
    lower.includes('natural') ||
    lower.includes('titanium') ||
    lower.includes('grey') ||
    lower.includes('gray')
  ) {
    return {
      backgroundColor: '#e5e7eb',
      color: '#1f2937',
      borderColor: '#9ca3af',
    };
  }
  if (lower.includes('yellow') || lower.includes('orange')) {
    return {
      backgroundColor: '#fef08a',
      color: '#854d0e',
      borderColor: '#facc15',
    };
  }
  if (lower.includes('gold') || lower.includes('desert')) {
    return {
      backgroundColor: '#fde68a',
      color: '#78350f',
      borderColor: '#f59e0b',
    };
  }
  if (
    lower.includes('blue') ||
    lower.includes('pacific') ||
    lower.includes('ultramarine') ||
    lower.includes('navy')
  ) {
    return {
      backgroundColor: '#dbeafe',
      color: '#1e40af',
      borderColor: '#93c5fd',
    };
  }
  if (
    lower.includes('purple') ||
    lower.includes('violet') ||
    lower.includes('lavender')
  ) {
    return {
      backgroundColor: '#f3e8ff',
      color: '#6b21a8',
      borderColor: '#d8b4fe',
    };
  }
  if (
    lower.includes('green') ||
    lower.includes('mint') ||
    lower.includes('teal')
  ) {
    return {
      backgroundColor: '#dcfce7',
      color: '#166534',
      borderColor: '#86efac',
    };
  }
  if (lower.includes('pink') || lower.includes('rose')) {
    return {
      backgroundColor: '#fce7f3',
      color: '#9d174d',
      borderColor: '#f9a8d4',
    };
  }
  if (lower.includes('red') || lower.includes('coral')) {
    return {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      borderColor: '#fca5a5',
    };
  }

  const trimmed = explicitValue?.trim();
  if (trimmed && /^#[0-9a-f]{6}$/i.test(trimmed)) {
    const r = Number.parseInt(trimmed.slice(1, 3), 16);
    const g = Number.parseInt(trimmed.slice(3, 5), 16);
    const b = Number.parseInt(trimmed.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return {
      backgroundColor: trimmed,
      color: luminance > 0.6 ? '#1f2937' : '#ffffff',
      borderColor: luminance > 0.85 ? '#d4d4d8' : trimmed,
    };
  }

  return {
    backgroundColor: '#e4e4e7',
    color: '#27272a',
    borderColor: '#cbd5e1',
  };
}

export function getCartItemColorSwatch(
  item: VariantDetailsItem
): { label: string; hex: string } | null {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.variantAttributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(key);
    if (axis && typeof value === 'string' && value.trim()) {
      attributes[axis] = value.trim();
    }
  }
  const label =
    attributes.color ||
    (typeof item.selectedColor === 'string' ? item.selectedColor.trim() : '');
  if (!label) return null;

  const explicitValue =
    attributes.color_value ||
    (typeof item.selectedColorValue === 'string'
      ? item.selectedColorValue.trim()
      : undefined);

  return {
    label,
    hex: resolveCartColorHex(label, explicitValue),
  };
}

export function getCartItemConditionBadge(
  item: VariantDetailsItem
): { label: string; badgeClassName: string } | null {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.variantAttributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(key);
    if (axis && typeof value === 'string' && value.trim()) {
      attributes[axis] = value.trim();
    }
  }
  const rawCondition =
    (typeof item.condition === 'string' ? item.condition.trim() : '') ||
    attributes.condition;
  if (!rawCondition) return null;

  const label =
    formatCanonicalProductConditionLabel(rawCondition) || rawCondition;
  const normalized = label.toLowerCase();
  const badgeClassName =
    normalized === 'new'
      ? 'bg-gray-900 text-white'
      : normalized === 'open box'
        ? 'bg-indigo-600 text-white'
        : normalized === 'new & used'
          ? 'bg-purple-600 text-white'
          : 'bg-stone-500 text-white';

  return { label, badgeClassName };
}

/** Render the saved SKU selection consistently in carts and checkout. */
export function CartVariantDetails({
  item,
  className = 'text-store-background-text/70',
  presentation = 'list',
}: {
  item: VariantDetailsItem;
  className?: string;
  presentation?: 'list' | 'chips';
}) {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.variantAttributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(key);
    if (axis && typeof value === 'string' && value.trim())
      attributes[axis] = value.trim();
  }
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const condition = text(item.condition) || attributes.condition;
  const conditionLabel = condition
    ? formatCanonicalProductConditionLabel(condition) || condition
    : '';
  const explicitColorValue =
    attributes.color_value || text(item.selectedColorValue) || undefined;
  const details = [
    ['Storage', attributes.storage || text(item.selectedStorage)],
    ['SIM type', attributes.sim_type],
    ['Colour', attributes.color || text(item.selectedColor)],
    ['Condition', conditionLabel],
    ...Object.entries(attributes)
      .filter(
        ([axis]) =>
          ![
            'storage',
            'sim_type',
            'condition',
            'color',
            'color_value',
            'secondary_color',
            'secondary_color_value',
          ].includes(axis)
      )
      .filter(
        ([axis, value]) =>
          axis !== 'variant' ||
          !conditionLabel ||
          (
            formatCanonicalProductConditionLabel(value) || value
          ).toLowerCase() !== conditionLabel.toLowerCase()
      )
      .map(([axis, value]) => [
        axis === 'ram'
          ? 'RAM'
          : axis
              .replaceAll('_', ' ')
              .replace(/^./, (letter) => letter.toUpperCase()),
        value,
      ]),
    [
      'Second colour preference',
      attributes.secondary_color || text(item.secondaryColor),
    ],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!details.length) return null;

  return (
    <dl
      aria-label="Selected variant"
      className={`${presentation === 'chips' ? 'mt-1 flex flex-wrap gap-1' : 'mt-1 space-y-0.5'} text-xs ${className}`}
    >
      {details.map(([label, value]) => {
        const isColorChip = presentation === 'chips' && label === 'Colour';
        const colorChipStyle = isColorChip
          ? resolveCartColorChipStyle(value, explicitColorValue)
          : undefined;

        return (
          <div
            className={
              presentation === 'chips'
                ? label === 'Condition'
                  ? 'sr-only'
                  : isColorChip
                    ? 'inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-tight'
                    : 'inline-flex max-w-full items-center rounded bg-store-background-text/5 px-1.5 py-0.5 text-[10px] font-medium leading-tight ring-1 ring-inset ring-store-background-text/8'
                : 'flex flex-wrap gap-x-1'
            }
            style={colorChipStyle}
            key={label}
          >
            <dt className={presentation === 'chips' ? 'sr-only' : undefined}>
              {label}:
            </dt>
            {!(presentation === 'chips' && label === 'Condition') && (
              <dd className="break-words">
                {value}
                {presentation === 'chips' && label === 'RAM' ? ' RAM' : ''}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
