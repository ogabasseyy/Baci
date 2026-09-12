import { describe, expect, it, vi } from 'vitest';

describe('GIGL coordinate-first station lookup', () => {
  it('uses coordinate directory station before a conflicting city match', async () => {
    const { GiglStationsService } = await import('./gigl.stations');
    const nearestLookup = vi.fn().mockResolvedValue({
      stationId: 4,
      serviceCentres: [],
    });
    const service = new GiglStationsService({} as never, nearestLookup);
    vi.spyOn(service, 'getStations').mockResolvedValue([
      {
        StationId: 2,
        StationName: 'PORT HARCOURT',
        StateName: 'RIVERS',
        StationCode: undefined,
        State: undefined,
        City: 'Port Harcourt',
        Address: undefined,
        Latitude: 4.8156,
        Longitude: 7.0498,
      },
      {
        StationId: 4,
        StationName: 'LAGOS',
        StateName: 'LAGOS',
        StationCode: undefined,
        State: undefined,
        City: 'Lagos',
        Address: undefined,
        Latitude: 6.5244,
        Longitude: 3.3792,
      },
    ]);

    await expect(
      service.resolveStationForLocation({
        city: 'Port Harcourt',
        state: 'Rivers',
        latitude: 6.5244,
        longitude: 3.3792,
      })
    ).resolves.toEqual({
      station: expect.objectContaining({ StationId: 4 }),
      serviceCentres: [],
    });
    expect(nearestLookup).toHaveBeenCalledWith(6.5244, 3.3792, {
      signal: undefined,
      timeout: undefined,
    });
  });

  it('falls back to the city station when coordinate lookup fails', async () => {
    const { GiglStationsService } = await import('./gigl.stations');
    const service = new GiglStationsService(
      {} as never,
      vi.fn().mockRejectedValue(new Error('directory unavailable'))
    );
    const cityStation = {
      StationId: 2,
      StationName: 'PORT HARCOURT',
      StateName: 'RIVERS',
      StationCode: undefined,
      State: undefined,
      City: 'Port Harcourt',
      Address: undefined,
      Latitude: 4.8156,
      Longitude: 7.0498,
    };
    vi.spyOn(service, 'getStations').mockResolvedValue([cityStation]);

    await expect(
      service.resolveStationForLocation({
        city: 'Port Harcourt',
        state: 'Rivers',
        latitude: 6.5244,
        longitude: 3.3792,
      })
    ).resolves.toEqual({ station: cityStation });
  });
});
