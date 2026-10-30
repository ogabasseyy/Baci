import { performance } from 'node:perf_hooks';

const reasons = new Map([
  ['Managed Linux service required', 'mode-rejected'],
  ['Managed inventory stale', 'inventory-stale'],
  ['Managed binding withdrawn', 'binding-withdrawn'],
  ['Managed routing withdrawn', 'routing-withdrawn'],
  ['Managed routing changed', 'routing-changed'],
  ['Managed child exited', 'child-exited'],
  ['Managed listener failed', 'listener-failed'],
  ['Managed lease rejected', 'lease-rejected'],
  ['Managed gateway stopped', 'stop-requested'],
  ['Binding replaced', 'binding-replaced'],
  ['Socket replaced', 'socket-replaced'],
]);

export async function withManagedDiagnostics(
  stage,
  operation,
  write = (entry) => process.stderr.write(entry)
) {
  const started = performance.now();
  try {
    return await operation();
  } catch (error) {
    const reason =
      error?.killed === true && error?.signal === 'SIGKILL'
        ? 'subprocess-timeout'
        : (reasons.get(error?.message) ?? 'check-rejected');
    const safeStage = ['gateway', 'inventory', 'docker-inspect'].includes(stage)
      ? stage
      : 'unknown';
    write(
      `${JSON.stringify({ event: 'managed-check-failed', stage: safeStage, reason, elapsedMs: Math.round(performance.now() - started) })}\n`
    );
    throw error;
  }
}
