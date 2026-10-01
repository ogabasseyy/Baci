import type { UnifiedLocation } from '../types';
import type { GiglApiClient } from './gigl.auth';
import {
  GIGL_STATIONS_CACHE_TTL_MS,
  GIGL_STATIONS_TIMEOUT_MS,
  withGiglRequestTimeout,
} from './gigl.constants';
import type {
  GiglLocation,
  GiglResolutionOptions,
  GiglStationResolution,
  NearestGiglDirectoryLookup,
} from './gigl.directory';
import { normalizeGiglLocation } from './gigl.location-normalizer';
import type { GiglServiceCentre, GiglStation } from './gigl.schemas';
import { giglSchemas } from './gigl.schemas';

export class GiglStationsService {
  private stationsCache: GiglStation[] | null = null;
  private stationsCacheExpiry = 0;
  private stationsRequest: Promise<GiglStation[]> | null = null;
  private stationsRequestTimeout = 0;
  private readonly serviceCentresCache = new Map<
    number,
    { expiresAt: number; serviceCentres: GiglServiceCentre[] }
  >();
  private readonly serviceCentresRequests = new Map<
    number,
    { promise: Promise<GiglServiceCentre[]>; timeout: number }
  >();

  constructor(
    private readonly apiClient: GiglApiClient,
    private readonly nearestDirectoryLookup?: NearestGiglDirectoryLookup
  ) {}

  async getLocations(_countryCode = 'NG'): Promise<UnifiedLocation[]> {
    const stations = await this.getStations();
    return stations.map((station) => ({
      state: station.StateName || station.State || station.StationName,
      city: station.City || station.StationName,
      stationId: station.StationId,
      stationName: station.StationName,
      latitude: station.Latitude,
      longitude: station.Longitude,
    }));
  }

  getStations(
    timeout = GIGL_STATIONS_TIMEOUT_MS,
    signal?: AbortSignal
  ): Promise<GiglStation[]> {
    if (this.stationsCache && Date.now() < this.stationsCacheExpiry) {
      return Promise.resolve(this.stationsCache);
    }

    if (!this.stationsRequest || this.stationsRequestTimeout < timeout) {
      const stationsRequest = this.fetchStations(timeout).finally(() => {
        if (this.stationsRequest === stationsRequest) {
          this.stationsRequest = null;
          this.stationsRequestTimeout = 0;
        }
      });
      this.stationsRequest = stationsRequest;
      this.stationsRequestTimeout = timeout;
      void this.stationsRequest.catch(() => undefined);
    }

    return withGiglRequestTimeout(
      this.stationsRequest,
      timeout,
      signal,
      'GIGL stations request timed out',
      'GIGL stations request aborted'
    );
  }

  private async fetchStations(
    timeout: number,
    signal?: AbortSignal
  ): Promise<GiglStation[]> {
    const tokenData = await this.apiClient.getApiToken(timeout, signal);
    const { envelope, response } =
      await this.apiClient.safeFetchEnvelopeWithAccessToken(
        `${this.apiClient.baseUrl}/localstations/get`,
        tokenData,
        () => ({
          method: 'GET',
          timeout,
          signal,
        })
      );

    if (!response.ok) {
      throw new Error('Failed to fetch GIGL stations');
    }

    if (envelope?.status !== 200) {
      throw new Error('Invalid GIGL stations response');
    }

    const stations = this.apiClient.parseEnvelopeData(
      envelope,
      giglSchemas.stationsData,
      'stations'
    );
    if (stations.length === 0) {
      throw new Error('GIGL returned empty station list');
    }

    this.stationsCache = stations;
    this.stationsCacheExpiry = Date.now() + GIGL_STATIONS_CACHE_TTL_MS;

    return this.stationsCache;
  }

  getServiceCentres(
    stationId: number,
    timeout = GIGL_STATIONS_TIMEOUT_MS,
    signal?: AbortSignal
  ): Promise<GiglServiceCentre[]> {
    const cached = this.serviceCentresCache.get(stationId);
    if (cached && Date.now() < cached.expiresAt) {
      return Promise.resolve(cached.serviceCentres);
    }

    let request = this.serviceCentresRequests.get(stationId);
    if (!request || request.timeout < timeout) {
      const promise = this.fetchServiceCentres(stationId, timeout).finally(
        () => {
          if (this.serviceCentresRequests.get(stationId)?.promise === promise) {
            this.serviceCentresRequests.delete(stationId);
          }
        }
      );
      request = { promise, timeout };
      this.serviceCentresRequests.set(stationId, request);
      void promise.catch(() => undefined);
    }

    return withGiglRequestTimeout(
      request.promise,
      timeout,
      signal,
      'GIGL service centres request timed out',
      'GIGL service centres request aborted'
    );
  }

  private async fetchServiceCentres(
    stationId: number,
    timeout: number
  ): Promise<GiglServiceCentre[]> {
    const tokenData = await this.apiClient.getApiToken(timeout);
    const { envelope, response } =
      await this.apiClient.safeFetchEnvelopeWithAccessToken(
        `${this.apiClient.baseUrl}/serviceCentresByStation?StationId=${stationId}`,
        tokenData,
        () => ({ method: 'GET', timeout })
      );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch GIGL service centres for station ${stationId}`
      );
    }
    if (envelope?.status !== 200) {
      throw new Error(
        `Invalid GIGL service centres response for station ${stationId}`
      );
    }

    const serviceCentres = this.apiClient.parseEnvelopeData(
      envelope,
      giglSchemas.serviceCentresData,
      'service centres'
    );
    this.serviceCentresCache.set(stationId, {
      expiresAt: Date.now() + GIGL_STATIONS_CACHE_TTL_MS,
      serviceCentres,
    });
    return serviceCentres;
  }

  async findServiceCentreById(
    stationId: number,
    serviceCentreId: number,
    timeout?: number,
    signal?: AbortSignal
  ): Promise<GiglServiceCentre | null> {
    const serviceCentres = await this.getServiceCentres(
      stationId,
      timeout,
      signal
    );
    return (
      serviceCentres.find(
        (serviceCentre) => serviceCentre.ServiceCentreId === serviceCentreId
      ) ?? null
    );
  }

  async findStationById(
    stationId: number,
    timeout?: number,
    signal?: AbortSignal
  ): Promise<GiglStation | null> {
    const stations = await this.getStations(timeout, signal);
    return stations.find((station) => station.StationId === stationId) || null;
  }

  async findStationForCity(
    city: string,
    state: string,
    timeout?: number,
    signal?: AbortSignal
  ): Promise<GiglStation | null> {
    const stations = await this.getStations(timeout, signal);
    const normalizedCity = normalizeGiglLocation(city);
    const normalizedState = normalizeGiglLocation(state);

    let station = stations.find((s) => {
      const cityName = normalizeGiglLocation(s.City || '');
      const stationName = normalizeGiglLocation(s.StationName || '');
      return cityName === normalizedCity || stationName === normalizedCity;
    });

    if (!station) {
      station = stations.find((s) => {
        const stateName = normalizeGiglLocation(s.StateName || s.State || '');
        return stateName === normalizedState;
      });
    }

    return station || null;
  }

  async resolveStationForLocation(
    location: GiglLocation,
    options?: GiglResolutionOptions
  ): Promise<GiglStationResolution | null> {
    const stations = await this.getStations(options?.timeout, options?.signal);
    const normalizedCity = normalizeGiglLocation(location.city);
    const cityStation = stations.find((station) =>
      [station.City, station.StationName]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizeGiglLocation(value) === normalizedCity)
    );

    const hasCoordinates =
      Number.isFinite(location.latitude) && Number.isFinite(location.longitude);

    if (hasCoordinates && this.nearestDirectoryLookup) {
      try {
        const nearest = await this.nearestDirectoryLookup(
          location.latitude as number,
          location.longitude as number,
          { signal: options?.signal, timeout: options?.timeout }
        );
        if (nearest) {
          const station = stations.find(
            (candidate) => candidate.StationId === nearest.stationId
          );
          if (station) {
            return { station, serviceCentres: nearest.serviceCentres };
          }
        }
      } catch {
        // The periodically synced directory is an optimization. Live regional
        // station matching remains available when Supabase is transiently down.
      }
    }

    if (cityStation) return { station: cityStation };
    const normalizedState = normalizeGiglLocation(location.state);
    const stateStation = stations.find((station) =>
      [station.StateName, station.State]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizeGiglLocation(value) === normalizedState)
    );
    return stateStation ? { station: stateStation } : null;
  }
}
