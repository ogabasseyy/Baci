import { getJumiaBaseUrl, JumiaApiError } from '@/lib/jumia/helpers';
import {
  JumiaSelfAuthorizationTokenResponseSchema,
  JumiaShopsResponseSchema,
} from '@/schemas/jumia';
import type { JumiaSelfAuthorizationCredentials } from '@/schemas/jumia/self-authorization';

const REQUEST_TIMEOUT_MS = 10_000;

export type SafeJumiaShop = {
  id: string;
  selectionKey?: string;
  businessClientCode?: string;
  name: string;
  countryCode: string;
  marketplace: string;
};

export type ValidatedSelfAuthorization = {
  credentials: JumiaSelfAuthorizationCredentials & { accessToken: string };
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  shops: SafeJumiaShop[];
};

type ValidationDependencies = {
  fetch?: typeof fetch;
  baseUrl?: string;
  onCredentialsRotated?: (value: {
    credentials: JumiaSelfAuthorizationCredentials & { accessToken: string };
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
  }) => Promise<void>;
};

async function requestWithTimeout<T>(
  fetchImplementation: typeof fetch,
  input: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const scheduleDeadline = <R>(promise: Promise<R>): Promise<R> =>
    new Promise((resolve, reject) => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        reject(
          new JumiaApiError(408, 'Jumia authorization validation timed out')
        );
        return;
      }
      const timeout = setTimeout(() => {
        controller.abort();
        reject(
          new JumiaApiError(408, 'Jumia authorization validation timed out')
        );
      }, remainingMs);
      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });

  try {
    const response = await scheduleDeadline(
      fetchImplementation(input, {
        ...init,
        signal: controller.signal,
      })
    );
    return await scheduleDeadline(consume(response));
  } catch (error) {
    if (error instanceof JumiaApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new JumiaApiError(408, 'Jumia authorization validation timed out');
    }
    throw new JumiaApiError(502, 'Jumia authorization validation failed');
  }
}

async function parseJumiaJson<T>(
  response: Response,
  schema: { parse: (value: unknown) => T },
  invalidResponseMessage: string
): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch (error) {
    if (error instanceof JumiaApiError) {
      throw error;
    }
    throw new JumiaApiError(502, invalidResponseMessage);
  }
}

export async function validateJumiaSelfAuthorization(
  submitted: JumiaSelfAuthorizationCredentials,
  dependencies: ValidationDependencies = {}
): Promise<ValidatedSelfAuthorization> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const baseUrl = dependencies.baseUrl ?? getJumiaBaseUrl();

  const tokens = await requestWithTimeout(
    fetchImplementation,
    `${baseUrl}/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: submitted.clientId,
        refresh_token: submitted.refreshToken,
      }),
    },
    async (tokenResponse) => {
      if (!tokenResponse.ok) {
        throw new JumiaApiError(
          tokenResponse.status,
          'Jumia rejected the client ID or refresh token'
        );
      }
      return await parseJumiaJson(
        tokenResponse,
        JumiaSelfAuthorizationTokenResponseSchema,
        'Jumia returned an invalid token response'
      );
    }
  );

  const credentials = {
    clientId: submitted.clientId,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
  };
  const accessTokenExpiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();
  const refreshTokenExpiresAt = new Date(
    Date.now() + tokens.refresh_expires_in * 1000
  ).toISOString();

  // Self-authorization refreshes rotate the refresh token. Persist the
  // replacement before discovering shops so a transient provider failure
  // cannot strand the merchant with an already-invalid submitted token.
  await dependencies.onCredentialsRotated?.({
    credentials,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
  });

  const shopsResponseData = await requestWithTimeout(
    fetchImplementation,
    `${baseUrl}/shops`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
      },
    },
    async (shopsResponse) => {
      if (!shopsResponse.ok) {
        throw new JumiaApiError(
          shopsResponse.status,
          'Jumia shop discovery failed'
        );
      }
      return await parseJumiaJson(
        shopsResponse,
        JumiaShopsResponseSchema,
        'Jumia returned an invalid shop response'
      );
    }
  );

  const shops = shopsResponseData.shops.flatMap((shop) => {
    const marketplaces = shop.businessClients.filter(
      (bc) => bc.status === 'active'
    );
    return marketplaces.map((marketplace) => ({
      id: shop.id,
      businessClientCode: marketplace.code,
      ...(marketplaces.length > 1
        ? {
            selectionKey: `${shop.id}:${marketplace.code}`,
          }
        : {}),
      name: shop.name,
      countryCode: marketplace.countryCode,
      marketplace: marketplace.name,
    }));
  });

  if (shops.length === 0) {
    throw new JumiaApiError(
      422,
      'No Jumia shops were returned for this authorization'
    );
  }

  return {
    credentials,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    shops,
  };
}
