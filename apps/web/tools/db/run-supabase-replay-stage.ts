const SAFE_FAILURE =
  /^supabase failed: (non-zero-exit|spawn-error|stderr-limit|stdin-limit|stdout-limit|timeout)( \(line=\d+(?:,sqlstate=[0-9A-Z]{5})?\)| \(sqlstate=[0-9A-Z]{5}\)| \(reason=(?:docker-unavailable|port-conflict|image-pull|disk-full|invalid-config|connection-refused)\))?$/;

export async function runSupabaseReplayStage<T>(
  stage: 'init' | 'db start' | 'migration up' | 'status' | 'gen types',
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const safeFailure =
      error instanceof Error ? SAFE_FAILURE.exec(error.message) : undefined;
    const failure = safeFailure ? ` (${safeFailure[0]})` : '';
    throw new Error(`Supabase replay stage ${stage} failed${failure}`);
  }
}
