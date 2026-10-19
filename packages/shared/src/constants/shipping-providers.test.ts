import { describe, expect, it } from 'vitest';
import {
  CARRIER_PROVIDER_CODE_BY_ID,
  CARRIER_PROVIDER_IDS,
  isCarrierProviderId,
  normalizeCarrierProviderIds,
} from './shipping-providers';

describe('CARRIER_PROVIDER_IDS', () => {
  it('keeps the live merchant carrier catalog and API codes stable', () => {
    // Arrange
    const expectedProviderIds = ['gigl', 'topship'];
    const expectedProviderCodes = {
      gigl: 'GIGL',
      topship: 'TOPSHIP',
    };

    // Act
    const providerIds = CARRIER_PROVIDER_IDS;
    const providerCodes = CARRIER_PROVIDER_CODE_BY_ID;

    // Assert
    expect(providerIds).toEqual(expectedProviderIds);
    expect(providerCodes).toEqual(expectedProviderCodes);
  });

  it('normalizes legacy provider settings into unique supported ids', () => {
    // Arrange
    const legacySettings = [
      ' GIGL ',
      'shiip',
      'TopShip',
      'gigl',
      'future-carrier',
      42,
    ];

    // Act
    const normalizedProviderIds = normalizeCarrierProviderIds(legacySettings);

    // Assert
    expect(normalizedProviderIds).toEqual(['gigl', 'topship']);
  });

  it('treats malformed non-array settings as no carrier opt-in', () => {
    // Arrange
    const malformedSettings = 'gigl';

    // Act
    const normalizedProviderIds =
      normalizeCarrierProviderIds(malformedSettings);

    // Assert
    expect(normalizedProviderIds).toEqual([]);
  });

  it('recognizes supported carrier provider ids and rejects retired ids', () => {
    // Arrange
    const providerIds = ['gigl', 'topship', 'shiip'];

    // Act
    const providerIdValidity = providerIds.map((providerId) =>
      isCarrierProviderId(providerId)
    );

    // Assert
    expect(providerIdValidity).toEqual([true, true, false]);
  });
});
