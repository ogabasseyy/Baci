import { readPositiveIntegerEnv } from './gigl.tracking-constants';

function trimmedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isExplicitlyDisabledEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'off';
}

const GIGL_DEV_BASE_URL = 'https://dev-thirdpartynode.theagilitysystems.com';

export const GIGL_BASE_URL =
  trimmedEnv(process.env.GIGL_BASE_URL) ||
  (process.env.NODE_ENV === 'production' ? undefined : GIGL_DEV_BASE_URL);
export const GIGL_EMAIL = trimmedEnv(process.env.GIGL_EMAIL);
export const GIGL_PASSWORD = trimmedEnv(process.env.GIGL_PASSWORD);
export const GIGL_ENABLED = !isExplicitlyDisabledEnv(process.env.GIGL_ENABLED);
export const GIGL_TOKEN_EXPIRY_MS = 20 * 24 * 60 * 60 * 1000;
export const GIGL_QUOTE_TIMEOUT_MS =
  readPositiveIntegerEnv(process.env.GIGL_QUOTE_TIMEOUT_MS) || 5000;
export const GIGL_BOOKING_TIMEOUT_MS =
  readPositiveIntegerEnv(process.env.GIGL_BOOKING_TIMEOUT_MS) || 10000;
export const GIGL_TRACKING_TIMEOUT_MS =
  readPositiveIntegerEnv(process.env.GIGL_TRACKING_TIMEOUT_MS) || 5000;
export * from './gigl.tracking-constants';
export const GIGL_STATIONS_TIMEOUT_MS =
  readPositiveIntegerEnv(process.env.GIGL_STATIONS_TIMEOUT_MS) || 5000;
export const GIGL_STATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT = 500;
export const GIGL_TRACKING_MAX_EVENTS_PER_BATCH = 5_000;
export const GIGL_TRACKING_MAX_NOTIFICATIONS_PER_APPLY = 1_000;
export const GIGL_TRACKING_WAYBILL_MAX_LENGTH = 128;
export const GIGL_TRACKING_EVENT_ID_MAX_LENGTH = 128;
export const GIGL_TRACKING_EVENT_KEY_MAX_LENGTH = 256;
export const GIGL_TRACKING_RAW_STATUS_MAX_LENGTH = 128;
export const GIGL_TRACKING_NORMALIZED_STATUS_MAX_LENGTH = 64;
export const GIGL_TRACKING_DESCRIPTION_MAX_LENGTH = 2_048;
export const GIGL_TRACKING_LOCATION_MAX_LENGTH = 512;
export const GIGL_TRACKING_TIMESTAMP_MAX_LENGTH = 64;
export const GIGL_TRACKING_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const GIGL_TRACKING_RESPONSE_MAX_BYTES = 5 * 1_024 * 1_024;
export const GIGL_LOGIN_RESPONSE_MAX_BYTES = 256 * 1_024;
export const GIGL_TRACKING_RPC_EVENTS_MAX_BYTES = 2 * 1_024 * 1_024;
export const GIGL_TRACKING_RPC_NOTIFICATIONS_MAX_BYTES = 512 * 1_024;

export function isGiglRuntimeConfigured(): boolean {
  return Boolean(GIGL_ENABLED && GIGL_BASE_URL && GIGL_EMAIL && GIGL_PASSWORD);
}

export interface GiglToken {
  token: string;
  userChannelCode: string;
  customerType: number;
  expiresAt: number;
}

export type GiglApiEnvelope = {
  status: number;
  success?: boolean;
  message?: string;
  data?: unknown;
};

export enum VehicleType {
  Car = 0,
  Bike = 1,
  Van = 2,
  Truck = 3,
}

export enum ShipmentType {
  Special = 0,
  Regular = 1,
  Ecommerce = 2,
}

export const GIGL_DEFAULT_SPECIAL_PACKAGE_ID = 1;

export enum PickupOptions {
  HomeDelivery = 0,
  ServiceCentre = 1,
}

export enum GiglDeliveryType {
  GoStandard = 0,
  GoFaster = 1,
}

export const GIGL_PRICING_STRATEGY = 3;

export type GiglFetchOptions = RequestInit & { timeout?: number };

export type GiglLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>
) => void;

export interface GiglProviderIo {
  safeFetch(url: string, options?: GiglFetchOptions): Promise<Response>;
  log: GiglLog;
}

export interface GiglQuoteIo extends GiglProviderIo {
  generateQuoteId(): string;
  getQuoteExpiry(hours?: number): Date;
}

function createTimeoutError(message: string): Error {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function createAbortError(signal: AbortSignal, message: string): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isGiglAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export function withGiglRequestTimeout<T>(
  request: Promise<T>,
  timeout?: number,
  signal?: AbortSignal,
  timeoutMessage = 'GIGL request timed out',
  abortMessage = 'GIGL request aborted'
): Promise<T> {
  if ((!timeout || timeout <= 0) && !signal) {
    return request;
  }

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal, abortMessage));
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const guards: Promise<T>[] = [];

  if (timeout && timeout > 0) {
    guards.push(
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(createTimeoutError(timeoutMessage));
        }, timeout);
      })
    );
  }

  if (signal) {
    guards.push(
      new Promise<T>((_resolve, reject) => {
        abortHandler = () => reject(createAbortError(signal, abortMessage));
        signal.addEventListener('abort', abortHandler, { once: true });
      })
    );
  }

  return Promise.race([request, ...guards]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  });
}

export function withGiglTokenRequestTimeout(
  tokenRequest: Promise<GiglToken>,
  timeout?: number,
  signal?: AbortSignal
): Promise<GiglToken> {
  return withGiglRequestTimeout(
    tokenRequest,
    timeout,
    signal,
    'GIGL API token request timed out',
    'GIGL API token request aborted'
  );
}

export function getConfiguredGiglBaseUrl(): string {
  if (!GIGL_BASE_URL) {
    throw new Error('GIGL base URL not configured');
  }

  return GIGL_BASE_URL;
}

export function getVehicleTypeForWeight(totalWeight: number): VehicleType {
  return totalWeight > 30 ? VehicleType.Van : VehicleType.Bike;
}

export function parseGiglProviderRateId(providerRateId?: string): {
  senderStationId?: number;
  receiverStationId?: number;
  pickupOption: PickupOptions;
  vehicleType?: VehicleType;
  serviceCentreId?: number;
  deliveryType: GiglDeliveryType;
} {
  if (!providerRateId) {
    return {
      pickupOption: PickupOptions.HomeDelivery,
      deliveryType: GiglDeliveryType.GoStandard,
    };
  }

  const [
    providerCode,
    stationIdValue,
    pickupOptionValue,
    vehicleTypeValue,
    serviceCentreIdValue,
    deliveryTypeValue,
    senderStationIdValue,
  ] = providerRateId.split('_');
  if (providerCode !== 'GIGL') {
    return {
      pickupOption: PickupOptions.HomeDelivery,
      deliveryType: GiglDeliveryType.GoStandard,
    };
  }

  const receiverStationId = Number(stationIdValue);
  const pickupOption = Number(pickupOptionValue);
  const vehicleType = Number(vehicleTypeValue);
  const serviceCentreId = Number(serviceCentreIdValue);
  const deliveryType = Number(deliveryTypeValue);
  const senderStationId = Number(senderStationIdValue);

  return {
    ...(Number.isFinite(senderStationId) ? { senderStationId } : {}),
    receiverStationId: Number.isFinite(receiverStationId)
      ? receiverStationId
      : undefined,
    pickupOption:
      pickupOption === PickupOptions.ServiceCentre
        ? PickupOptions.ServiceCentre
        : PickupOptions.HomeDelivery,
    vehicleType: Object.values(VehicleType).includes(vehicleType)
      ? (vehicleType as VehicleType)
      : undefined,
    serviceCentreId:
      Number.isInteger(serviceCentreId) && serviceCentreId > 0
        ? serviceCentreId
        : undefined,
    deliveryType:
      deliveryType === GiglDeliveryType.GoFaster
        ? GiglDeliveryType.GoFaster
        : GiglDeliveryType.GoStandard,
  };
}

export function buildGiglProviderRateId({
  senderStationId,
  receiverStationId,
  pickupOption,
  vehicleType,
  serviceCentreId,
  deliveryType,
}: {
  senderStationId?: number;
  receiverStationId: number;
  pickupOption: PickupOptions;
  vehicleType: VehicleType;
  serviceCentreId?: number;
  deliveryType: GiglDeliveryType;
}): string {
  return [
    'GIGL',
    receiverStationId,
    pickupOption,
    vehicleType,
    serviceCentreId ?? 0,
    deliveryType,
    ...(senderStationId === undefined ? [] : [senderStationId]),
  ].join('_');
}
