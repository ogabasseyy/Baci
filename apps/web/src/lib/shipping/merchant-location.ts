const STREET_HINT_PATTERN =
  /\b(street|st\.?|road|rd\.?|avenue|ave\.?|close|crescent|estate|phase|plot|no\.?|house|suite|unit)\b|\d/i;

const KNOWN_STATE_NAMES = new Set([
  'abia',
  'adamawa',
  'akwa ibom',
  'anambra',
  'bauchi',
  'bayelsa',
  'benue',
  'borno',
  'cross river',
  'delta',
  'ebonyi',
  'edo',
  'ekiti',
  'enugu',
  'gombe',
  'imo',
  'jigawa',
  'kaduna',
  'kano',
  'katsina',
  'kebbi',
  'kogi',
  'kwara',
  'lagos',
  'nasarawa',
  'nassarawa',
  'niger',
  'ogun',
  'ondo',
  'osun',
  'oyo',
  'plateau',
  'rivers',
  'sokoto',
  'taraba',
  'yobe',
  'zamfara',
  'abuja',
  'fct',
  'federal capital territory',
]);

function looksLikeStreetSegment(value: string): boolean {
  return STREET_HINT_PATTERN.test(value);
}

function normalizeLocationToken(value: string): string {
  return value.trim().toLowerCase();
}

function isPostalCodeSegment(value: string): boolean {
  return /^\d{5,6}$/.test(value.trim());
}

export function deriveMerchantLocation(
  addressValue: string | null | undefined
): {
  address: string;
  city: string;
  state: string;
} {
  const address = addressValue?.trim() || 'Lagos';
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      address: 'Lagos',
      city: 'Lagos',
      state: 'Lagos',
    };
  }

  if (parts.length === 1) {
    return {
      address,
      city: parts[0],
      state: parts[0],
    };
  }

  const last = parts.at(-1) || 'Lagos';
  const secondLast = parts.at(-2) || last;

  if (KNOWN_STATE_NAMES.has(normalizeLocationToken(last))) {
    return {
      address,
      city: secondLast,
      state: last,
    };
  }

  if (isPostalCodeSegment(last)) {
    if (KNOWN_STATE_NAMES.has(normalizeLocationToken(secondLast))) {
      const cityBeforeState = parts.at(-3) || secondLast;
      return {
        address,
        city: cityBeforeState,
        state: secondLast,
      };
    }

    return {
      address,
      city: secondLast,
      state: '',
    };
  }

  if (parts.length >= 3) {
    return {
      address,
      city: secondLast,
      state: last,
    };
  }

  if (looksLikeStreetSegment(parts[0])) {
    return {
      address,
      city: last,
      state: last,
    };
  }

  return {
    address,
    city: parts[0],
    state: last,
  };
}
