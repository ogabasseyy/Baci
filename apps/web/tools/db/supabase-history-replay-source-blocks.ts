/** Combine frozen rows without discarding duplicates or malformed parser input. */
export function combineReplaySourceBlocks(blocks: readonly string[]): string {
  return blocks
    .flatMap((sourceBlock) => sourceBlock.trim().split('\n'))
    .sort((left, right) => {
      const leftFilename = left.split(' ')[1] ?? '';
      const rightFilename = right.split(' ')[1] ?? '';
      if (leftFilename < rightFilename) return -1;
      if (leftFilename > rightFilename) return 1;
      return 0;
    })
    .join('\n');
}
