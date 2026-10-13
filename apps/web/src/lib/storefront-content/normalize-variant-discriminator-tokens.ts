import { isBareCapacityMetadataToken } from './is-bare-capacity-metadata-token';

const SPLIT_VARIANT_UNIT_TOKENS = new Set([
  'gb',
  'tb',
  'mb',
  'mm',
  'inch',
  'mah',
  'w',
  'v',
  'hz',
]);

function canonicalizeCapacityToken(token: string) {
  const match = token.match(/^(\d+)(gb|tb)$/u);
  if (!match) {
    return token;
  }
  const capacityGb = Number(match[1]) * (match[2] === 'tb' ? 1024 : 1);
  return capacityGb >= 1024 && capacityGb % 1024 === 0
    ? `${capacityGb / 1024}tb`
    : `${capacityGb}gb`;
}

/** Normalizes tokenized capacity and connectivity variants for guide matching. */
export function normalizeVariantDiscriminatorTokens(tokens: string[]) {
  const normalizedTokens: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const nextToken = tokens[index + 1] ?? '';
    const unitToken = tokens[index + 2] ?? '';
    if (token === 'core' && nextToken === 'ultra' && /^\d+$/u.test(unitToken)) {
      normalizedTokens.push(`coreultra${unitToken}`);
      index += 2;
      continue;
    }
    if (
      token === 'active' &&
      nextToken === 'noise' &&
      unitToken === 'cancellation'
    ) {
      normalizedTokens.push('anc');
      index += 2;
      continue;
    }
    if (token === 'rtx' && /^\d+$/u.test(nextToken)) {
      normalizedTokens.push(`rtx${nextToken}`);
      index += 1;
      continue;
    }
    if (token === 'core' && /^i[3579]$/u.test(nextToken)) {
      normalizedTokens.push(`core${nextToken}`);
      index += 1;
      continue;
    }
    if (isBareCapacityMetadataToken(tokens, index)) {
      normalizedTokens.push(canonicalizeCapacityToken(`${token}gb`));
      continue;
    }
    if (
      /^\d+$/u.test(token) &&
      /^\d+$/u.test(nextToken) &&
      ['inch', 'mm'].includes(unitToken)
    ) {
      normalizedTokens.push(`${token}.${nextToken}${unitToken}`);
      index += 2;
      continue;
    }
    if (/^\d+$/u.test(token) && SPLIT_VARIANT_UNIT_TOKENS.has(nextToken)) {
      normalizedTokens.push(canonicalizeCapacityToken(`${token}${nextToken}`));
      index += 1;
      continue;
    }
    if (token === 'wi' && nextToken === 'fi') {
      normalizedTokens.push('wifi');
      index += 1;
      continue;
    }
    if (token === 'e' && nextToken === 'sim') {
      normalizedTokens.push('esim');
      index += 1;
      continue;
    }
    if (token === 'bt') {
      normalizedTokens.push('bluetooth');
      continue;
    }
    if (/^\d{2,}g$/u.test(token)) {
      normalizedTokens.push(
        canonicalizeCapacityToken(`${token.slice(0, -1)}gb`)
      );
      continue;
    }
    normalizedTokens.push(canonicalizeCapacityToken(token));
  }
  return normalizedTokens;
}
