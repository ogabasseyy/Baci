import { formatCanonicalProductConditionLabel } from './product-condition';

export interface OrderItemOptionInput {
  condition?: string | null;
  variantName?: string | null;
}

export interface OrderItemDisplayNameInput extends OrderItemOptionInput {
  baseName?: string | null;
}

function normalizeOptionToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseOption(value: string) {
  return normalizeOptionToken(value).replace(/\b[a-z]/g, (letter) =>
    letter.toUpperCase()
  );
}

function getConditionDisplayLabel(condition: string | null | undefined) {
  const canonicalLabel = formatCanonicalProductConditionLabel(condition);
  if (canonicalLabel) {
    return canonicalLabel;
  }

  if (typeof condition !== 'string') {
    return null;
  }

  const fallbackLabel = titleCaseOption(condition);
  return fallbackLabel ? fallbackLabel : null;
}

function normalizedTextContainsOption(value: string, optionKey: string) {
  if (!optionKey) {
    return false;
  }

  return ` ${normalizeOptionToken(value)} `.includes(` ${optionKey} `);
}

function hasExplicitConditionSegment(value: string, optionKey: string) {
  if (normalizeOptionToken(value) === optionKey) {
    return true;
  }

  const bracketSegments = value.matchAll(/[[(]([^\])]+)[\])]/g);
  for (const segment of bracketSegments) {
    if (segment[1] && normalizedTextContainsOption(segment[1], optionKey)) {
      return true;
    }
  }

  const splitSegments = value
    .split(/\s+-\s+|[/|,]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (splitSegments.length < 2) {
    return false;
  }

  return splitSegments.some((segment) =>
    normalizedTextContainsOption(segment, optionKey)
  );
}

function stripConditionCommaSegments(
  value: string,
  conditionKey: string | null
) {
  if (!conditionKey) {
    return value.trim();
  }

  const commaParts = value.split(',');
  if (commaParts.length < 2) {
    return value.trim();
  }

  const trimmedParts = commaParts.map((part) => part.trim());
  const filteredParts = trimmedParts.filter(
    (part) => part.length > 0 && normalizeOptionToken(part) !== conditionKey
  );

  if (filteredParts.length < trimmedParts.filter(Boolean).length) {
    return filteredParts.join(', ');
  }

  return value.trim();
}

function stripTrailingConditionWordsFromVariantPart(
  value: string,
  conditionKey: string | null
) {
  const trimmedValue = value.trim();
  if (!conditionKey) {
    return trimmedValue;
  }

  const conditionWords = conditionKey.trim().split(/\s+/).filter(Boolean);
  if (conditionWords.length === 0) {
    return trimmedValue;
  }

  const sourceWords = trimmedValue.split(/\s+/).filter(Boolean);
  if (sourceWords.length === 0) {
    return '';
  }

  const trailingWords = sourceWords.slice(-conditionWords.length);
  const hasTrailingCondition =
    trailingWords.length === conditionWords.length &&
    trailingWords.every(
      (word, wordIndex) =>
        normalizeOptionToken(word) === conditionWords[wordIndex]
    );

  return (
    hasTrailingCondition
      ? sourceWords.slice(0, -conditionWords.length)
      : sourceWords
  )
    .join(' ')
    .trim();
}

function splitVariantName(
  variantName: string | null | undefined,
  conditionKey: string | null
) {
  if (typeof variantName !== 'string') {
    return [];
  }

  return variantName
    .split('/')
    .map((part) =>
      stripTrailingConditionWordsFromVariantPart(
        stripConditionCommaSegments(part, conditionKey),
        conditionKey
      )
    )
    .filter((part) => part.length > 0);
}

function buildOrderItemOptionLabel(
  { condition, variantName }: OrderItemOptionInput,
  includeConditionLabel: boolean
) {
  const conditionLabel = getConditionDisplayLabel(condition);
  const conditionKey = conditionLabel
    ? normalizeOptionToken(conditionLabel)
    : null;
  const variantParts = splitVariantName(variantName, conditionKey).filter(
    (part) => {
      if (!conditionKey) {
        return true;
      }

      return normalizeOptionToken(part) !== conditionKey;
    }
  );

  return [includeConditionLabel ? conditionLabel : null, ...variantParts]
    .filter(Boolean)
    .join(' / ');
}

export function formatOrderItemOptionLabel(input: OrderItemOptionInput) {
  return buildOrderItemOptionLabel(input, true);
}

export function formatOrderItemDisplayName({
  baseName,
  condition,
  variantName,
}: OrderItemDisplayNameInput) {
  const displayName =
    typeof baseName === 'string' && baseName.trim().length > 0
      ? baseName.trim()
      : 'Product';
  const conditionLabel = getConditionDisplayLabel(condition);
  const conditionKey = conditionLabel
    ? normalizeOptionToken(conditionLabel)
    : null;
  const includeConditionLabel = conditionKey
    ? !hasExplicitConditionSegment(displayName, conditionKey)
    : true;
  const optionLabel = buildOrderItemOptionLabel(
    { condition, variantName },
    includeConditionLabel
  );

  return optionLabel ? `${displayName} (${optionLabel})` : displayName;
}
