export function assertCheckoutRecoveryValue(
  value: string,
  label: string
): void {
  if (value.trim().length === 0) {
    throw new Error(
      `Checkout recovery ${label} is invalid. Please contact support.`
    );
  }
}
