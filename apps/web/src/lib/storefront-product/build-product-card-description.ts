import { formatCurrencyCompact } from '@/lib/currency';
import type { ProductSemanticCandidate } from './product-semantic-types';

export interface BuildProductCardDescriptionInput {
  candidate: ProductSemanticCandidate;
  currentProduct?: ProductSemanticCandidate;
  countryCode?: string | null;
}

interface SpecHighlightDef {
  key: string;
  format: (val: string | number) => string;
}

const SPEC_HIGHLIGHTS: SpecHighlightDef[] = [
  { key: 'ram_gb', format: (val) => `${val}GB RAM` },
  { key: 'storage_gb', format: (val) => `${val}GB storage` },
  { key: 'battery_mah', format: (val) => `${val}mAh battery` },
  { key: 'main_camera_mp', format: (val) => `${val}MP camera` },
  { key: 'screen_size_inches', format: (val) => `${val}" display` },
];

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function getPositiveNumericValue(raw: unknown): string | number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed && /^\d+(\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      return Number.isFinite(num) && num > 0 ? trimmed : null;
    }
  }
  return null;
}

export function buildProductCardDescription(
  input: BuildProductCardDescriptionInput
): string {
  const segments: string[] = [];
  const condition = input.candidate.condition?.trim();
  if (condition) {
    segments.push(toTitleCase(condition));
  }

  const country = input.countryCode || 'NG';
  let priceSegment = formatCurrencyCompact(input.candidate.price, country);

  if (
    input.currentProduct &&
    input.currentProduct.price > 0 &&
    input.candidate.price > 0
  ) {
    if (input.candidate.price < input.currentProduct.price) {
      const savings = formatCurrencyCompact(
        input.currentProduct.price - input.candidate.price,
        country
      );
      priceSegment += ` (Save ${savings})`;
    } else if (input.candidate.price > input.currentProduct.price) {
      const delta = formatCurrencyCompact(
        input.candidate.price - input.currentProduct.price,
        country
      );
      priceSegment += ` (+${delta})`;
    }
  }

  segments.push(priceSegment);

  const keySpecs = input.candidate.product_key_specs;
  if (keySpecs && typeof keySpecs === 'object') {
    const highlights: string[] = [];
    for (const def of SPEC_HIGHLIGHTS) {
      const val = getPositiveNumericValue(keySpecs[def.key]);
      if (val !== null) {
        highlights.push(def.format(val));
        if (highlights.length === 2) {
          break;
        }
      }
    }
    if (highlights.length > 0) {
      segments.push(highlights.join(', '));
    }
  }

  return segments.join(' • ');
}
