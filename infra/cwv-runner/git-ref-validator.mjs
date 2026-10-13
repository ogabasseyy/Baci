function validRefPart(part) {
  if (Buffer.from(part).toString() !== part) return false;
  for (const character of part) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      '~^:?*[\\'.includes(character)
    )
      return false;
  }
  return true;
}

export function validGitRef(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.endsWith('.')
  )
    return false;
  return value
    .split('/')
    .every(
      (part) =>
        part &&
        part !== '.' &&
        part !== '..' &&
        !part.startsWith('.') &&
        !part.endsWith('.lock') &&
        !part.includes('@{') &&
        validRefPart(part)
    );
}
