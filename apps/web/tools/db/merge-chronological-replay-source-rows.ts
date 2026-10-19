function replaySourceRowVersion(row: string): string {
  const filename = row.slice(row.indexOf(' ') + 1);
  return filename.slice(0, 14);
}

export function mergeChronologicalReplaySourceRows(
  ...blocks: string[]
): string {
  const rows = blocks.flatMap((block) =>
    block
      .trim()
      .split('\n')
      .filter((row) => row.length > 0)
  );

  rows.sort((left, right) =>
    replaySourceRowVersion(left).localeCompare(replaySourceRowVersion(right))
  );

  return `${rows.join('\n')}\n`;
}
