/** Detects a catalog source explicitly classified as a console product. */
export function hasConsoleProductDescriptor(
  sources: string[],
  tokenize: (value: string) => string[]
) {
  return sources.flatMap(tokenize).includes('console');
}
