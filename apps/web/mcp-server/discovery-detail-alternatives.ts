/** Split feature alternatives, carrying a shared trailing capacity context. */
export function discoveryDetailAlternatives(detailWords: string[]): string[][] | undefined {
  const orIndex = detailWords.indexOf('or');
  const capacityContext = ['ram', 'memory', 'storage', 'ssd', 'hdd'];
  if (orIndex > 0 && orIndex < detailWords.length - 1) {
    const leftSpec = detailWords.slice(0, orIndex);
    const rightSpec = detailWords.slice(orIndex + 1);
    const rightContextIndex = rightSpec.findIndex((word) => capacityContext.includes(word));
    const nextAlternativeIndex = rightSpec.indexOf('or', rightContextIndex);
    const rightContext = rightContextIndex >= 0
      ? rightSpec.slice(rightContextIndex, nextAlternativeIndex < 0 ? undefined : nextAlternativeIndex) : [];
    const hasNumericSpec = (phrase: string[]) => phrase.some((word) => /\d/.test(word));
    if (hasNumericSpec(leftSpec) && hasNumericSpec(rightSpec) && rightContext.length > 0) {
      const leftHasContext = leftSpec.some((word) => capacityContext.includes(word));
      return [leftHasContext ? leftSpec : [...leftSpec, ...rightContext], rightSpec];
    }
  }
  const branches: string[][] = [[]];
  for (const word of detailWords) {
    if (word === 'or') branches.push([]);
    else branches.at(-1)?.push(word);
  }
  return branches.length > 1 && branches.every((branch) => branch.length > 0) &&
    branches.every((branch) => !branch.some((word) => /\d/.test(word))) ? branches : undefined;
}
