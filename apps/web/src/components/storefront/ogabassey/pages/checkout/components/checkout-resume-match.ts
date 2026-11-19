/** True only when the authorized resumed order matches the requested order id. */
export function matchesValidatedResume(
  order: { id: string } | null,
  requestedId: string | null
): boolean {
  return Boolean(order && requestedId && order.id === requestedId);
}
