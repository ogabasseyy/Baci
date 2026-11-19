export type PetrockModelScope =
  | { family?: string; kind: 'generic' }
  | { family?: string; kind: 'range'; max: number; min: number }
  | { family?: string; kind: 'set'; models: readonly string[] };

export interface NormalizedPetrockDeviceModel {
  canonical: string;
  family: string;
  series: number | null;
}

function modelScopeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function modelScopeFamily(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const family = value.trim().toLowerCase();
  return family && family.length <= 64 ? family : null;
}

export function parsePetrockModelScope(
  value: unknown
): PetrockModelScope | null {
  const record = modelScopeRecord(value);
  if (!record) return null;
  const family = modelScopeFamily(record.family);
  if (family === null) return null;

  if (record.kind === 'generic') {
    return family ? { family, kind: 'generic' } : { kind: 'generic' };
  }

  if (record.kind === 'range') {
    const { max, min } = record;
    if (
      typeof min !== 'number' ||
      typeof max !== 'number' ||
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      min < 0 ||
      max < min
    ) {
      return null;
    }
    return family
      ? { family, kind: 'range', max, min }
      : { kind: 'range', max, min };
  }

  if (record.kind !== 'set' || !Array.isArray(record.models)) return null;
  const models = record.models.map((model) =>
    typeof model === 'string' ? model.trim().toLowerCase() : ''
  );
  if (
    models.length === 0 ||
    models.length > 200 ||
    models.some((model) => !model || model.length > 100)
  ) {
    return null;
  }
  const uniqueModels = [...new Set(models)];
  return family
    ? { family, kind: 'set', models: uniqueModels }
    : { kind: 'set', models: uniqueModels };
}

export function normalizePetrockDeviceModel(
  model: string,
  _generation = ''
): NormalizedPetrockDeviceModel {
  if (
    !model.trim() ||
    /^(?:unknown(?: device)?|n\/a|not available|null|none|undefined|(?:apple\s+)?iphone\s*\d{1,2},\d+)$/i.test(
      model.trim()
    )
  ) {
    return { canonical: '', family: 'unknown', series: null };
  }
  // Match the same trusted device description used by the database guard.
  const normalized = model.trim().toLowerCase();
  const iphone = normalized.match(/iphone\s*(\d{1,2})(?!\d)/i);
  const ipad = normalized.match(/ipad(?:\s+pro|\s+air)?\s*(\d{1,2})?/i);
  const samsung = normalized.match(/(?:samsung\s+)?galaxy\s+([a-z]\d{1,3})/i);

  if (iphone) {
    // Exact sets need an unambiguous variant; ranges remain series-wide.
    const exact = model
      .trim()
      .match(
        /^(?:apple\s+)?iphone\s*(\d{1,2})(?:\s+(pro\s+max|pro|plus|mini))?(?:\s*\([a-z0-9-]+\))?$/i
      );
    const variant = exact?.[2]?.toLowerCase().replace(/\s+/g, '-');
    return {
      canonical: exact
        ? `iphone-${exact[1]}${variant ? `-${variant}` : ''}`
        : '',
      family: 'iphone',
      series: Number(iphone[1]),
    };
  }
  if (ipad) {
    return {
      canonical: ipad[1] ? `ipad-${ipad[1]}` : 'ipad',
      family: 'ipad',
      series: ipad[1] ? Number(ipad[1]) : null,
    };
  }
  if (samsung) {
    return {
      canonical: `samsung-${samsung[1].toLowerCase()}`,
      family: 'samsung',
      series: null,
    };
  }

  return {
    canonical: normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    family: normalized ? 'other' : 'unknown',
    series: null,
  };
}

export function matchesPetrockModelScope(
  model: NormalizedPetrockDeviceModel,
  scope: PetrockModelScope
): boolean {
  if (model.family === 'unknown') return false;
  if (scope.family && scope.family !== model.family) return false;

  if (scope.kind === 'generic') return true;
  if (scope.kind === 'range') {
    return (
      model.family === 'iphone' &&
      model.series !== null &&
      model.series >= scope.min &&
      model.series <= scope.max
    );
  }
  // These families lack a verified exact-variant canonical contract.
  if (!model.canonical || model.family === 'ipad' || model.family === 'samsung')
    return false;
  return scope.models.some(
    (candidate) => candidate.toLowerCase() === model.canonical
  );
}
