/** Only explicit door delivery is a candidate residence. Pickup and unknown modes are not. */
export function checkoutResidentialSuggestion(
  method: string | null,
  raw: unknown
): Record<string, string> {
  if (
    method !== 'door' ||
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw)
  )
    return {};
  const address = raw as Record<string, unknown>;
  const text = (key: string) =>
    typeof address[key] === 'string' ? address[key].slice(0, 200) : '';
  return {
    state: text('state'),
    city: text('city'),
    street: text('street') || text('address'),
    lga: text('lga'),
    landmark: text('landmark'),
    house_number: text('house_number'),
  };
}
