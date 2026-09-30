/** A short word glued to a model number ("wh" in "WH-1000XM5") is validated
 * by model matching, not as an identity term. */
export function isModelNumberPrefix(words: string[], index: number): boolean {
  const word = words[index] ?? '';
  const next = words[index + 1];
  return word.length <= 3 && Boolean(next && /\d/.test(next));
}
