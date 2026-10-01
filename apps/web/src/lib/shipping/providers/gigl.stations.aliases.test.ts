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
