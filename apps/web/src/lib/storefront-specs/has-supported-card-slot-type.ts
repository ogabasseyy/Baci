import type { ComparableProductKeySpecs } from './spec-taxonomy';

const UNSUPPORTED_CARD_SLOT_VALUES = new Set([
  '',
  '0',
  'false',
  'n/a',
  'na',
  'none',
  'not applicable',
  'not available',
  'not listed',
  'not published',
  'not supported',
  'no',
  'unsupported',
  'unavailable',
]);

function isUnsupportedCardSlotValue(value: unknown) {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return !Number.isFinite(value) || value === 0;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return (
    UNSUPPORTED_CARD_SLOT_VALUES.has(normalized) ||
    normalized.startsWith('confirm exact')
  );
}

export function hasSupportedCardSlotType(specs: ComparableProductKeySpecs) {
  const cardSlotType = specs.card_slot_type;
  return (
    specs.has_card_slot === true &&
    typeof cardSlotType === 'string' &&
    !isUnsupportedCardSlotValue(cardSlotType)
  );
}
