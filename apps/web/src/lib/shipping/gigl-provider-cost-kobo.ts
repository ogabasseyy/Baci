export function toProviderCostKobo(providerCost: number): number {
  if (!Number.isFinite(providerCost)) {
    throw new Error('GIGL provider cost must be finite');
  }
  if (providerCost <= 0) {
    throw new Error('GIGL provider cost must be positive');
  }
  const providerCostKobo = Math.round(providerCost * 100);
  if (providerCostKobo <= 0) {
    throw new Error('GIGL provider cost must be positive');
  }
  if (!Number.isSafeInteger(providerCostKobo)) {
    throw new Error('GIGL provider cost is too large');
  }
  return providerCostKobo;
}
