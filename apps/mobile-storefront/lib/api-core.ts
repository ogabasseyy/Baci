import NetInfo from '@react-native-community/netinfo';
import {
  DEFAULT_TIMEOUT,
  fetchWithTimeout,
  LONG_TIMEOUT,
  NetworkError,
  SHORT_TIMEOUT,
  TimeoutError,
} from './fetch-with-timeout';
import { createLogger } from './logger';
import { getOxygenStagingProfile } from './oxygen-staging-profile';

const log = createLogger('API');

export {
  DEFAULT_TIMEOUT,
  LONG_TIMEOUT,
  NetworkError,
  SHORT_TIMEOUT,
  TimeoutError,
};

export const DEFAULT_MAX_RETRIES = 3;
export const BASE_RETRY_DELAY = 1000;
export const MAX_RETRY_DELAY = 30000;

export class RetryExhaustedError extends Error {
  attempts: number;
  lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(`Request failed after ${attempts} attempts: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export class ApiError extends Error {
  status: number;
  statusText: string;
  body?: unknown;
  isRetryable: boolean;

  constructor(response: Response, body?: unknown) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}: ${response.statusText}`;
    super(message);
    this.name = 'ApiError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
    this.isRetryable = response.status >= 500;
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  timeout?: number;
  checkNetwork?: boolean;
  isRetryable?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export function defaultIsRetryable(error: Error): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof TimeoutError) return true;
  if (error instanceof ApiError) return error.isRetryable;
  const normalizedMessage = error.message.toLowerCase();
  if (normalizedMessage.includes('network')) return true;
  if (normalizedMessage.includes('timeout')) return true;
  return false;
}

export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const exponentialDelay = baseDelay * 2 ** attempt;
  const jitter = Math.random() * exponentialDelay * 0.25;
  return Math.min(maxDelay, exponentialDelay + jitter);
}

export function allowsLocalOxygenNetwork(): boolean {
  const profile =
    typeof __DEV__ !== 'undefined' && __DEV__
      ? getOxygenStagingProfile()
      : null;
  return (
    profile !== null &&
    /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
      profile.apiOrigin
    )
  );
}

export async function checkNetworkConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return (
    state.isConnected === true &&
    (allowsLocalOxygenNetwork() || state.isInternetReachable !== false)
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  fetchOptions: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelay = BASE_RETRY_DELAY,
    maxDelay = MAX_RETRY_DELAY,
    timeout = DEFAULT_TIMEOUT,
    checkNetwork = true,
    isRetryable = defaultIsRetryable,
    onRetry,
  } = retryOptions;

  let lastError: Error = new Error('Request failed');
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      if (checkNetwork) {
        const isOnline = await checkNetworkConnectivity();
        if (!isOnline) {
          throw new NetworkError(
            'No internet connection. Please check your network.'
          );
        }
      }

      const response = await fetchWithTimeout(url, {
        ...fetchOptions,
        timeout,
      });

      if (response.status >= 500) {
        let body: unknown;
        try {
          body = await response.clone().json();
        } catch {
          // Response body might not be JSON.
        }
        throw new ApiError(response, body);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryable(lastError) || attempt >= maxRetries) {
        break;
      }

      const delayMs = calculateBackoffDelay(attempt, baseDelay, maxDelay);
      onRetry?.(attempt + 1, lastError, delayMs);
      log.info(
        `Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms: ${lastError.message}`
      );

      await sleep(delayMs);
      attempt++;
    }
  }

  throw new RetryExhaustedError(attempt, lastError);
}

export async function fetchJsonWithRetry<T>(
  url: string,
  fetchOptions: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(url, fetchOptions, retryOptions);

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Response might not be JSON.
    }
    throw new ApiError(response, body);
  }

  return response.json() as Promise<T>;
}
