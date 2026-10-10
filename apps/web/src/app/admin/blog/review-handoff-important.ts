// Tailwind important utilities come in two spellings: the v4
// trailing form (`hidden!`, `md:hidden!`) and the v3-compatible
// leading form (`!hidden`, `md:!hidden`). An important declaration
// beats every ordinary declaration, so visibility evaluation
// partitions each channel into important and ordinary tiers: the
// important winner decides at points where it applies, and the
// ordinary winner decides everywhere else.
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

export function splitImportantClasses(classes: readonly string[]): {
  important: string[];
  ordinary: string[];
} {
  const important: string[] = [];
  const ordinary: string[] = [];
  for (const token of classes) {
    const bare = stripImportantModifier(token);
    if (bare === token) ordinary.push(token);
    else important.push(bare);
  }
  return { important, ordinary };
}
