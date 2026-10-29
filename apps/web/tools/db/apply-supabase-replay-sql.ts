type ReplaySqlStage = {
  kind: 'migration' | 'sql-check';
  ordinal: number;
  sqlPath: string;
};

const SAFE_PERMISSION_CATEGORIES =
  'owner_required|schema_access_denied|relation_access_denied|routine_access_denied|column_access_denied|sequence_access_denied|role_membership_denied|permission_denied';

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
        ? /^[A-Za-z0-9._-]+ failed: (non-zero-exit|spawn-error|stderr-limit|stdin-limit|stdout-limit|timeout)( \(line=(\d+)(?:,sqlstate=([0-9A-Z]{5}))?(?:,permission=([A-Za-z0-9_-]+))?\))?$/.exec(
            error.message
          )
        : undefined;
    const permission = failureMatch?.[5];
    const safePermission =
      permission && SAFE_PERMISSION_CATEGORIES.split('|').includes(permission)
        ? permission
        : undefined;
    const diagnostic = failureMatch?.[3]
      ? ` (line=${failureMatch[3]}${failureMatch[4] ? `,sqlstate=${failureMatch[4]}` : ''}${safePermission ? `,permission=${safePermission}` : ''})`
      : '';
    const failure = failureMatch
      ? `${failureMatch[1]}${diagnostic}`
      : undefined;
    throw new Error(
      `Replay ${label} failed at ordinal ${stage.ordinal}: ${failure ?? 'unknown'}`
    );
  }
}
