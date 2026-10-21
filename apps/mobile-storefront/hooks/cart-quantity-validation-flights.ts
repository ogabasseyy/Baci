/**
 * Per-line quantity-validation flight tracker (module size guard split).
 *
 * Overlapping quantity edits share one baseline: the last quantity known
 * to be stock-validated (the pre-flight value, advanced by each success).
 * A failure restores the baseline — never its own unvalidated predecessor
 * — so two overlapping invalid edits cannot settle on a quantity that
 * never passed validation.
 */
const quantityValidationFlights = new Map<
  string,
  { pending: number; baseline: number | undefined }
>();

export function beginQuantityValidationFlight(
  id: string,
  preWriteQuantity: number | undefined
): void {
  const flight = quantityValidationFlights.get(id);
  if (!flight || flight.pending === 0) {
    quantityValidationFlights.set(id, {
      pending: 1,
      baseline: preWriteQuantity,
    });
    return;
  }
  flight.pending += 1;
}

export function advanceQuantityValidationBaseline(
  id: string,
  validatedQuantity: number
): void {
  const flight = quantityValidationFlights.get(id);
  if (flight) {
    flight.baseline = validatedQuantity;
  }
}

export function endQuantityValidationFlight(id: string): void {
  const flight = quantityValidationFlights.get(id);
  if (!flight) {
    return;
  }
  flight.pending -= 1;
  if (flight.pending <= 0) {
    quantityValidationFlights.delete(id);
  }
}

export function readQuantityValidationBaseline(id: string): number | undefined {
  return quantityValidationFlights.get(id)?.baseline;
}

/** Test-only: clears every flight entry so cases never share baselines. */
export function resetQuantityValidationFlightsForTests(): void {
  quantityValidationFlights.clear();
}
