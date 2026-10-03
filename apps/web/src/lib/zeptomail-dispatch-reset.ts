/**
 * Best-effort transport-dispatch reset before the platform-sender
 * fallback. A transient marker-clear failure must not convert the
 * primary's definite rejection into an unknown outcome: on failure the
 * caller skips the fallback and reports the primary failure so the
 * sender stays on its bounded retry path.
 */
export async function resetTransportDispatchForFallback(
  resetTransportDispatch?: () => Promise<void>
): Promise<boolean> {
  try {
    await resetTransportDispatch?.();
    return true;
  } catch {
    return false;
  }
}
