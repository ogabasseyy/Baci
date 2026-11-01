type ReplaySqlStage = {
  kind: 'migration' | 'sql-check';
  ordinal: number;
  sqlPath: string;
};

export async function applySupabaseReplaySql(
  apply: (sqlPath: string) => Promise<unknown>,
  stage: ReplaySqlStage
): Promise<void> {
  try {
    await apply(stage.sqlPath);
  } catch (error) {
    const label =
      stage.kind === 'migration' ? 'migration application' : 'SQL check';
    const failureMatch =
      error instanceof Error
        ? /^[A-Za-z0-9._-]+ failed: (non-zero-exit|spawn-error|stderr-limit|stdin-limit|stdout-limit|timeout)( \(line=\d+(?:,sqlstate=[0-9A-Z]{5}|,reason=connection-lost)?\))?$/.exec(
            error.message
          )
        : undefined;
    const failure = failureMatch
      ? `${failureMatch[1]}${failureMatch[2] ?? ''}`
      : undefined;
    throw new Error(
      `Replay ${label} failed at ordinal ${stage.ordinal}: ${failure ?? 'unknown'}`
    );
  }
}
