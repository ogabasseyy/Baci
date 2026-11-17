import { canonicalizeCommerceVariantAxis } from '@baci/shared/lib/commerce-variant-axis';
import { formatCanonicalProductConditionLabel } from '@baci/shared/lib/product-condition';

export interface VariantDetailsItem {
  condition?: string;
  selectedColor?: string;
  selectedColorValue?: string;
  selectedStorage?: string;
  secondaryColor?: string;
  variantAttributes?: Record<string, string>;
}

export function resolveCartColorChipStyle(
  name: string,
  explicitValue?: string
): { backgroundColor: string; color: string; borderColor: string } {
  const trimmed = explicitValue?.trim();
  if (trimmed && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    const hex =
      trimmed.length === 4
        ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
        : trimmed;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return {
      backgroundColor: hex,
      color: luminance > 0.6 ? '#1f2937' : '#ffffff',
      borderColor: luminance > 0.85 ? '#d4d4d8' : hex,
    };
  }

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

  return {
    backgroundColor: '#e4e4e7',
    color: '#27272a',
    borderColor: '#cbd5e1',
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
      ? 'bg-store-background-text text-store-background'
      : normalized === 'open box'
        ? 'bg-store-primary text-store-primary-text'
        : 'bg-store-background-text/80 text-store-background';

  return { label, badgeClassName };
}
