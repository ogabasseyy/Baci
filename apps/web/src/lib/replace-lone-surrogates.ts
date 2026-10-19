/**
 * Replace UTF-16 code units that are not part of a valid surrogate pair.
 *
 * JSON.stringify escapes lone surrogates as `\\udxxx`. Google treats those
 * escapes as truncated Unicode characters and rejects the complete JSON-LD
 * block. Keep valid astral characters intact, while making malformed legacy
 * values safe to serialize.
 */
export function replaceLoneSurrogates(value: string): string {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
        continue;
      }

      result += '\ufffd';
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      result += '\ufffd';
      continue;
    }

    result += value[index];
  }

  return result;
}
