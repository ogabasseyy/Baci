// Split an array into consecutive chunks of at most `size`
// elements. Used to cap Storage remove() calls at the 1,000-object
// limit while keeping long sessions to one request per chunk.
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
