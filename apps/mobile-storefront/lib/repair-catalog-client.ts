import Constants from 'expo-constants';
import { resolveApiBaseUrl } from '@/lib/api-url';
import {
  type RepairBookingRequest,
  RepairBookingResultSchema,
  RepairDeviceDetailSchema,
  RepairDevicesResponseSchema,
} from './repair-catalog-schemas';

/**
 * Fetch client for the repairs services catalogue
 * (`GET /api/storefront/[slug]/repairs/devices[/[deviceSlug]]`,
 * `POST /api/storefront/[slug]/repairs/book`) — the same public/guest-callable
 * web APIs the storefront pages consume, reused for mobile parity. Mirrors
 * `services/discount.ts`'s base-URL + Zod-validated-response pattern.
 *
 * `EXPO_PUBLIC_API_URL` is a bare origin (no `/api` prefix) — every path
 * below appends `/api/...` explicitly.
 */

const API_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
);
const MERCHANT_SLUG =
  (Constants.expoConfig?.extra?.merchantSlug as string | undefined) ||
  'ogabassey';

const REPAIR_CATALOG_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Thrown when the repairs catalogue is not available for this merchant (the
 * read APIs 404 when the `repairs_catalog_enabled` flag is off or the
 * merchant isn't gadgets/electronics). Callers use this to fall back to the
 * pre-catalogue WhatsApp-only experience instead of showing a generic error.
 */
export class RepairCatalogUnavailableError extends Error {
  constructor(message = 'Repairs catalogue not available') {
    super(message);
    this.name = 'RepairCatalogUnavailableError';
  }
}

export class RepairCatalogTimeoutError extends Error {
  constructor() {
    super('Repair catalogue request timed out');
    this.name = 'RepairCatalogTimeoutError';
  }
}

export interface RepairBookingRequestError extends Error {
  fieldErrors?: Record<string, string[]>;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body?.error === 'string' && body.error
      ? body.error
      : `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function fetchRepairCatalog<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  parse: (response: Response) => Promise<T>
): Promise<T> {
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, REPAIR_CATALOG_REQUEST_TIMEOUT_MS);

  const externalSignal = init.signal;
  const abortFromCaller = () => timeoutController.abort();
  if (externalSignal?.aborted) {
    timeoutController.abort();
  } else {
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal: timeoutController.signal,
    });
    return await parse(response);
  } catch (error) {
    if (timedOut) {
      throw new RepairCatalogTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function fetchRepairDevices(query?: string, signal?: AbortSignal) {
  const trimmed = query?.trim();
  const search = trimmed ? `?q=${encodeURIComponent(trimmed)}` : '';
  const response = await fetchRepairCatalog(
    `${API_URL}/api/storefront/${MERCHANT_SLUG}/repairs/devices${search}`,
    { signal },
    async (response) => {
      if (response.status === 404) {
        throw new RepairCatalogUnavailableError();
      }
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const parsed = RepairDevicesResponseSchema.safeParse(
        await response.json()
      );
      if (!parsed.success) {
        throw new Error('Invalid repair devices response from server');
      }
      return parsed.data.groups;
    }
  );
  return response;
}

export async function fetchRepairDeviceDetail(
  deviceSlug: string,
  signal?: AbortSignal
) {
  const response = await fetchRepairCatalog(
    `${API_URL}/api/storefront/${MERCHANT_SLUG}/repairs/devices/${encodeURIComponent(deviceSlug)}`,
    { signal },
    async (response) => {
      if (response.status === 404) {
        throw new RepairCatalogUnavailableError('Device not found');
      }
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const parsed = RepairDeviceDetailSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('Invalid repair device detail response from server');
      }
      return parsed.data;
    }
  );
  return response;
}

export async function submitRepairBooking(
  input: RepairBookingRequest,
  signal?: AbortSignal
) {
  const response = await fetch(
    `${API_URL}/api/storefront/${MERCHANT_SLUG}/repairs/book`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }
  );

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let fieldErrors: Record<string, string[]> | undefined;
    try {
      const body = (await response.json()) as {
        error?: unknown;
        details?: { fieldErrors?: Record<string, string[]> };
      };
      if (typeof body?.error === 'string' && body.error) {
        message = body.error;
      }
      fieldErrors = body?.details?.fieldErrors;
    } catch {
      // Non-JSON error body — the status code + default message are enough.
    }
    const error = new Error(message) as RepairBookingRequestError;
    if (fieldErrors) {
      error.fieldErrors = fieldErrors;
    }
    throw error;
  }

  const parsed = RepairBookingResultSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Invalid booking response from server');
  }
  return parsed.data;
}
