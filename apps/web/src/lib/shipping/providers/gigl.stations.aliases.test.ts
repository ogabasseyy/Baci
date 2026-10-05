import { describe, expect, it, vi } from 'vitest';

describe('GIGL station state aliases', () => {
  async function createServiceWithStations() {
    const { GiglApiClient } = await import('./gigl.auth');
    const { GiglStationsService } = await import('./gigl.stations');
    const safeFetch = (
      url: string,
      options?: RequestInit & { timeout?: number }
    ) => fetch(url, options);
    const service = new GiglStationsService(
      new GiglApiClient({ safeFetch, log: vi.fn() })
    );
    vi.spyOn(service, 'getStations').mockResolvedValue([
      {
        StationId: 4,
        StationName: 'ABUJA',
        StateName: 'FCT - Abuja',
        StationCode: undefined,
        State: undefined,
        City: undefined,
        Address: undefined,
        Latitude: undefined,
        Longitude: undefined,
      },
    ]);
    return service;
  }

  it('matches Abuja requests with GIGL FCT station state names', async () => {
    const service = await createServiceWithStations();

    await expect(
      service.resolveStationForLocation({
        city: 'Kubwa',
        state: 'Abuja',
      })
    ).resolves.toEqual({
      station: expect.objectContaining({ StationId: 4 }),
    });

    await expect(service.findStationForCity('Kubwa', 'Abuja')).resolves.toEqual(
      expect.objectContaining({
        StationId: 4,
        StateName: 'FCT - Abuja',
      })
    );
  });

  it('returns null for non-Abuja locations that do not match the station list', async () => {
    const service = await createServiceWithStations();

    await expect(
      service.resolveStationForLocation({
        city: 'Ikeja',
        state: 'Lagos',
      })
    ).resolves.toBeNull();

    await expect(
      service.findStationForCity('Ikeja', 'Lagos')
    ).resolves.toBeNull();
  });
});

describe('GIGL city/state consistency without coordinates', () => {
  async function service() {
    const { GiglStationsService } = await import('./gigl.stations');
    const service = new GiglStationsService({} as never);
    vi.spyOn(service, 'getStations').mockResolvedValue([
      {
        StationId: 4,
        StationName: 'IKEJA',
        City: 'Ikeja',
        StateName: 'Lagos',
        StationCode: undefined,
        State: undefined,
        Address: undefined,
        Latitude: undefined,
        Longitude: undefined,
      },
      {
        StationId: 8,
        StationName: 'PORT HARCOURT',
        City: 'Port Harcourt',
        StateName: 'Rivers',
        StationCode: undefined,
        State: undefined,
        Address: undefined,
        Latitude: undefined,
        Longitude: undefined,
      },
    ]);
    return service;
  }
  it.each([
    undefined,
    '  ',
  ])('preserves an exact city with absent state metadata %s', async (state) => {
    const lookup = await service();
    vi.mocked(lookup.getStations).mockResolvedValue([
      {
        StationId: 4,
        StationName: 'IKEJA',
        City: 'Ikeja',
        StateName: state,
        State: undefined,
        StationCode: undefined,
        Address: undefined,
        Latitude: undefined,
        Longitude: undefined,
      },
    ]);
    await expect(
      lookup.resolveStationForLocation({ city: 'Ikeja', state: 'Lagos' })
    ).resolves.toMatchObject({ station: { StationId: 4 } });
    await expect(
      lookup.findStationForCity('Ikeja', 'Lagos')
    ).resolves.toMatchObject({ StationId: 4 });
  });
  it('rejects contradictory sender city/state through the same resolver', async () => {
    await expect(
      (await service()).findStationForCity('Ikeja', 'Rivers')
    ).resolves.toBeNull();
  });
  it('preserves normalized sender matches and unknown-city state fallback', async () => {
    const lookup = await service();
    await expect(
      lookup.findStationForCity(' IKEJA ', 'Lagos State')
    ).resolves.toMatchObject({ StationId: 4 });
    await expect(
      lookup.findStationForCity('Unknown locality', 'Rivers')
    ).resolves.toMatchObject({ StationId: 8 });
  });
  it('rejects an exact city in a contradictory state instead of falling back', async () => {
    await expect(
      (await service()).resolveStationForLocation({
        city: 'Ikeja',
        state: 'Rivers',
      })
    ).resolves.toBeNull();
  });
  it('preserves normalized matching pairs and state fallback for unknown cities', async () => {
    const lookup = await service();
    await expect(
      lookup.resolveStationForLocation({
        city: ' IKEJA ',
        state: 'Lagos State',
      })
    ).resolves.toMatchObject({ station: { StationId: 4 } });
    await expect(
      lookup.resolveStationForLocation({
        city: 'Unknown locality',
        state: 'Rivers',
      })
    ).resolves.toMatchObject({ station: { StationId: 8 } });
  });
});
