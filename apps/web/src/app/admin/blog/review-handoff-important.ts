// Tailwind important utilities come in two spellings: the v4
// trailing form (`hidden!`, `md:hidden!`) and the v3-compatible
// leading form (`!hidden`, `md:!hidden`). Importance never changes
// whether a utility hides, so visibility evaluation strips the
// marker and reads the bare utility underneath.
export function stripImportantModifier(token: string): string {
  if (token.endsWith('!') && token.length > 1) return token.slice(0, -1);
  if (token.startsWith('!')) return token.slice(1);
  // A leading marker after variants (`md:!hidden`): only the
  // position right after the last colon counts, so arbitrary values
  // containing colons (`supports-[a:b]:hidden`) stay intact.
  const lastColon = token.lastIndexOf(':');
  if (lastColon !== -1 && token[lastColon + 1] === '!') {
    return token.slice(0, lastColon + 1) + token.slice(lastColon + 2);
  }
  return token;
}
