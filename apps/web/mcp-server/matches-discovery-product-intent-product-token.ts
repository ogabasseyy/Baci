import { matchesWord } from './matches-discovery-product-intent-word-match';

export function matchesProductToken(textWords: string[], token: string): boolean {
  if (matchesWord(textWords, token)) return true;
  const compactUnit = /^(\d+)([a-z]+)$/.exec(token);
  if (compactUnit && textWords.some((word, index) =>
    word === compactUnit[1] && textWords[index + 1] === compactUnit[2])) return true;
  // Punctuation-split spellings ("WH-1000XM5" vs "WH1000XM5", "USB-C" vs "USBC").
  return textWords.some((word, index) =>
    index + 1 < textWords.length && `${word}${textWords[index + 1]}` === token);
}
