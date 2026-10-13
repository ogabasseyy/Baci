import { parseGiglProviderRateId } from './providers/gigl.constants';

/** Matches the stable GIGL service selection across legacy and current IDs. */
export function matchesGiglProviderRate(
  currentProviderRateId: string,
  candidateProviderRateId: string | undefined
): boolean {
  if (
    !currentProviderRateId.startsWith('GIGL_') ||
    currentProviderRateId.startsWith('GIGL_INTL_') ||
    !candidateProviderRateId?.startsWith('GIGL_') ||
    candidateProviderRateId.startsWith('GIGL_INTL_')
  ) {
    return false;
  }

  const current = parseGiglProviderRateId(currentProviderRateId);
  const candidate = parseGiglProviderRateId(candidateProviderRateId);
  if (
    current.receiverStationId === undefined ||
    candidate.receiverStationId === undefined
  ) {
    return false;
  }

  return (
    current.receiverStationId === candidate.receiverStationId &&
    current.pickupOption === candidate.pickupOption &&
    current.vehicleType === candidate.vehicleType &&
    current.serviceCentreId === candidate.serviceCentreId &&
    current.deliveryType === candidate.deliveryType
  );
}
