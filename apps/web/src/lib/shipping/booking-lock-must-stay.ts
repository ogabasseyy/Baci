/** Errors whose booking lock must not be released by any outer cleanup. */
const lockMustStayErrors = new WeakSet<object>();

/** Mark an error so shouldReleaseBookingLock keeps the lock (e.g. a refund failed). */
export function markBookingLockMustStay(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    lockMustStayErrors.add(error);
  }
}

export function bookingLockMustStay(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && lockMustStayErrors.has(error)
  );
}
