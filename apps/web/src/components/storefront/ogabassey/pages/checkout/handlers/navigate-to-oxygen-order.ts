/** A document navigation applies the Oxygen page's response security policy. */
export function navigateToOxygenOrder(
  orderId: string,
  assign: (url: string) => void = (url) => window.location.assign(url)
): void {
  assign(`/payments/oxygen/${encodeURIComponent(orderId)}`);
}
