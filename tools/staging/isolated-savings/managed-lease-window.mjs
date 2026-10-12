export function managedLeaseWindow(start, leaseMs, absoluteExpiry) {
  const expires =
    absoluteExpiry === undefined ? start + leaseMs : Date.parse(absoluteExpiry);
  const duration = expires - start;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(duration) ||
    duration < 60000 ||
    duration > 7 * 24 * 60 * 60 * 1000 ||
    (absoluteExpiry !== undefined &&
      new Date(expires).toISOString() !== absoluteExpiry)
  )
    throw new Error('Lease window rejected');
  return { duration, expiresAt: new Date(expires).toISOString() };
}
