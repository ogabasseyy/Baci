import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GIGL provider constants', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('freezes the tracking input and output bounds', async () => {
    vi.resetModules();
    const constants = await import('./gigl.constants');
    const trackingConstants = await import('./gigl.tracking-constants');

    expect(constants.GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT).toBe(500);
    expect(constants.GIGL_TRACKING_MAX_EVENTS_PER_BATCH).toBe(5_000);
    expect(constants.GIGL_TRACKING_BATCH_LIMIT).toBe(50);
    expect(constants.GIGL_TRACKING_BATCH_TIMEOUT_MAX_MS).toBe(45_000);
    expect(constants.GIGL_TRACKING_BATCH_TIMEOUT_MS).toBe(15_000);
    expect(constants.GIGL_STOREFRONT_TRACKING_TIMEOUT_MS).toBe(5_000);
    expect(constants.GIGL_STOREFRONT_TRACKING_LEASE_MS).toBe(15_000);
    expect(constants.GIGL_TRACKING_WAYBILL_MAX_LENGTH).toBe(128);
    expect(constants.GIGL_TRACKING_EVENT_ID_MAX_LENGTH).toBe(128);
    expect(constants.GIGL_TRACKING_EVENT_KEY_MAX_LENGTH).toBe(256);
    expect(constants.GIGL_TRACKING_RAW_STATUS_MAX_LENGTH).toBe(128);
    expect(constants.GIGL_TRACKING_DESCRIPTION_MAX_LENGTH).toBe(2_048);
    expect(constants.GIGL_TRACKING_LOCATION_MAX_LENGTH).toBe(512);
    expect(constants.GIGL_TRACKING_TIMESTAMP_MAX_LENGTH).toBe(64);
    expect(constants.GIGL_TRACKING_MAX_FUTURE_SKEW_MS).toBe(300_000);
    expect(trackingConstants.GIGL_TRACKING_BATCH_TIMEOUT_MS).toBe(
      constants.GIGL_TRACKING_BATCH_TIMEOUT_MS
    );
    expect(trackingConstants.GIGL_STOREFRONT_TRACKING_LEASE_MS).toBe(
      constants.GIGL_STOREFRONT_TRACKING_LEASE_MS
    );
  });

  it('accepts only positive batch timeout overrides', async () => {
    vi.stubEnv('GIGL_TRACKING_BATCH_TIMEOUT_MS', '12000');
    vi.resetModules();
    const configured = await import('./gigl.constants');
    expect(configured.GIGL_TRACKING_BATCH_TIMEOUT_MS).toBe(12_000);

    vi.stubEnv('GIGL_TRACKING_BATCH_TIMEOUT_MS', '0');
    vi.resetModules();
    const fallback = await import('./gigl.constants');
    expect(fallback.GIGL_TRACKING_BATCH_TIMEOUT_MS).toBe(15_000);

    vi.stubEnv('GIGL_TRACKING_BATCH_TIMEOUT_MS', '2147483648');
    vi.resetModules();
    const oversized = await import('./gigl.constants');
    expect(oversized.GIGL_TRACKING_BATCH_TIMEOUT_MS).toBe(15_000);
  });

  it('parses provider rate ids with station pickup and vehicle type', async () => {
    vi.resetModules();
    const { PickupOptions, VehicleType, parseGiglProviderRateId } =
      await import('./gigl.constants');

    expect(parseGiglProviderRateId('GIGL_30_1_2_575')).toEqual({
      receiverStationId: 30,
      pickupOption: PickupOptions.ServiceCentre,
      vehicleType: VehicleType.Van,
      serviceCentreId: 575,
      deliveryType: 0,
    });
  });

  it('parses legacy rate ids without a service-centre segment', async () => {
    vi.resetModules();
    const { PickupOptions, VehicleType, parseGiglProviderRateId } =
      await import('./gigl.constants');

    expect(parseGiglProviderRateId('GIGL_30_1_2')).toEqual({
      receiverStationId: 30,
      pickupOption: PickupOptions.ServiceCentre,
      vehicleType: VehicleType.Van,
      serviceCentreId: undefined,
      deliveryType: 0,
    });
  });

  it('round-trips priority rate ids without confusing the service centre', async () => {
    vi.resetModules();
    const {
      GiglDeliveryType,
      PickupOptions,
      VehicleType,
      buildGiglProviderRateId,
      parseGiglProviderRateId,
    } = await import('./gigl.constants');

    const providerRateId = buildGiglProviderRateId({
      senderStationId: 4,
      receiverStationId: 30,
      pickupOption: PickupOptions.ServiceCentre,
      vehicleType: VehicleType.Bike,
      serviceCentreId: 575,
      deliveryType: GiglDeliveryType.GoFaster,
    });

    expect(providerRateId).toBe('GIGL_30_1_1_575_1_4');
    expect(parseGiglProviderRateId(providerRateId)).toEqual({
      senderStationId: 4,
      receiverStationId: 30,
      pickupOption: PickupOptions.ServiceCentre,
      vehicleType: VehicleType.Bike,
      serviceCentreId: 575,
      deliveryType: GiglDeliveryType.GoFaster,
    });
  });

  it.each([
    'false',
    'FALSE',
    ' False ',
    '0',
    ' 0 ',
    'off',
    'OFF',
    ' Off ',
  ])('treats %s as an explicit GIGL disable value', async (value) => {
    vi.resetModules();
    const { isExplicitlyDisabledEnv } = await import('./gigl.constants');

    expect(isExplicitlyDisabledEnv(value)).toBe(true);
  });

  it.each([
    undefined,
    '',
    ' ',
    'true',
    '1',
    'on',
    'disabled',
    'no',
  ])('does not treat %s as an explicit GIGL disable value', async (value) => {
    vi.resetModules();
    const { isExplicitlyDisabledEnv } = await import('./gigl.constants');

    expect(isExplicitlyDisabledEnv(value)).toBe(false);
  });

  it('uses the GIGL standard package id for shipment items', async () => {
    vi.resetModules();
    const { GIGL_DEFAULT_SPECIAL_PACKAGE_ID } = await import(
      './gigl.constants'
    );

    expect(GIGL_DEFAULT_SPECIAL_PACKAGE_ID).toBe(1);
  });

  it('requires an explicit base URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GIGL_BASE_URL', '   ');
    vi.resetModules();

    const { getConfiguredGiglBaseUrl } = await import('./gigl.constants');

    expect(() => getConfiguredGiglBaseUrl()).toThrow(
      'GIGL base URL not configured'
    );
  });
});
