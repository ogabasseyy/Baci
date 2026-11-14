// Match Unicode simple case folds without interpreting secret text as a pattern.
function foldCharacter(character: string): string {
  if (character === 'ı') return character;
  return character.toLowerCase().toUpperCase();
}
function replaceLiteral(message: string, value: string): string {
  const input = Array.from(message);
  const needle = Array.from(value, foldCharacter);
  const folded = input.map(foldCharacter);
  const short = value.length < 3;
  const letter = (character: string | undefined) =>
    character !== undefined && /\p{L}/u.test(character);
  const prefix = Array<number>(needle.length).fill(0);
  for (let i = 1, length = 0; i < needle.length; i++) {
    while (length > 0 && needle[i] !== needle[length])
      length = prefix[length - 1];
    if (needle[i] === needle[length]) length++;
    prefix[i] = length;
  }
  const output: string[] = [];
  let start = 0;
  let length = 0;
  for (let i = 0; i < folded.length; i++) {
    while (length > 0 && folded[i] !== needle[length])
      length = prefix[length - 1];
    if (folded[i] === needle[length]) length++;
    if (length !== needle.length) continue;
    const match = i + 1 - length;
    if (!short || (!letter(input[match - 1]) && !letter(input[i + 1]))) {
      output.push(input.slice(start, match).join(''), '[redacted]');
      start = i + 1;
      length = 0;
    } else {
      length = prefix[length - 1];
    }
  }
  output.push(input.slice(start).join(''));
  return output.join('');
}

/** Retain only sanitized text, never raw provider/request objects. */
export function redactOxygenDiagnosticText(
  text: string,
  payload: unknown,
  secrets: string[] = [],
  redactNumbers = true
): string {
  let message = text;
  const values = [...secrets];
  function collect(value: unknown, depth = 0, key = '') {
    const sensitive =
      /name|address|street|city|email|phone|account|bvn|nin|otp|token|secret|password/i.test(
        key
      );
    if (depth > 5) return;
    if (
      typeof value === 'string' &&
      value.length >= (sensitive ? 1 : 3) &&
      value.length <= 4096
    ) {
      values.push(value);
      values.push(
        ...value
          .split(/\s+/)
          .filter((part) => part.length >= (sensitive ? 1 : 3))
      );
    } else if (value && typeof value === 'object')
      for (const [childKey, child] of Object.entries(value))
        collect(child, depth + 1, childKey);
  }
  collect(payload);
  for (const value of values
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    message = replaceLiteral(message, value);
  }
  return message
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /\b(?:token|secret|api[_ -]?key|password|authorization)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      'credential [redacted]'
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/https?:\/\/[^\s<>]+/gi, '[redacted URL]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      '[redacted]'
    )
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[redacted]')
    .replace(/[A-Za-z0-9+/_-]{80,}={0,2}/g, '[redacted]')
    .replace(/\d+/g, (digits) => (redactNumbers ? '[redacted]' : digits))
    .split('')
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? ' '
        : character
    )
    .join('')
    .slice(0, 1000);
}
