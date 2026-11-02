const MAX_REMEMBERED_EVENTS = 500;
const alerted = new Set<string>();

/**
 * An unmapped deposit stays retryable, so PiggyVest redelivers it. Page an
 * operator once per key (per server instance) instead of on every attempt.
 * The key is remembered only after the alert went out, so a failed alert is
 * tried again on the next delivery. Memory is bounded; the oldest are dropped.
 */
export function alertOncePerEvent(key: string, emit: () => void): void {
  if (alerted.has(key)) return;
  emit();
  alerted.add(key);
  if (alerted.size > MAX_REMEMBERED_EVENTS) {
    const oldest = alerted.values().next().value;
    if (oldest !== undefined) alerted.delete(oldest);
  }
}

export function resetUnmappedAlertMemoryForTests(): void {
  alerted.clear();
}
