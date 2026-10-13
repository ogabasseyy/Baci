import { stripHtmlTags } from '@/lib/sanitize-core';

const HTML_ENTITY_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decodeHtmlEntities(value: string) {
  const decodeNumericEntity = (match: string, code: string, radix: number) => {
    const codePoint = Number.parseInt(code, radix);
    if (
      !Number.isFinite(codePoint) ||
      !Number.isInteger(codePoint) ||
      codePoint < 0 ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint > 0x10ffff
    ) {
      return match;
    }

    return String.fromCodePoint(codePoint);
  };

  return value
    .replace(/&#(\d+);/g, (match, code) => decodeNumericEntity(match, code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) =>
      decodeNumericEntity(match, code, 16)
    )
    .replace(
      /&(amp|lt|gt|quot|nbsp|#39);/g,
      (match) => HTML_ENTITY_REPLACEMENTS[match] || match
    );
}

export function normalizeSpecValueText(value: unknown) {
  if (typeof value === 'string') {
    return decodeHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, ' ').trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return '';
}
