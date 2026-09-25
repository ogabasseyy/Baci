import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { getJumiaClientId } from '@/env';
import {
  getJumiaBaseUrl,
  getJumiaEnvironment,
  JumiaApiError,
  type JumiaEnvironment,
  TOKEN_REFRESH_BUFFER_MS,
} from '@/lib/jumia/helpers';
import {
  loadJumiaIntegrationConfig,
  loadSingleJumiaMerchantIntegrationConfig,
} from '@/lib/jumia/jumia-client-config';
import { refreshJumiaClientAccessToken } from '@/lib/jumia/jumia-client-token-persistence';
import { waitForJumiaRequestSlot } from '@/lib/jumia/jumia-rate-limiter';
import type { JumiaCredentialServiceClient } from '@/lib/supabase/service';
import type { JumiaShop } from '@/schemas/jumia';
import { JumiaShopsResponseSchema } from '@/schemas/jumia';

export { JumiaApiError, jumiaErrorResponse } from '@/lib/jumia/helpers';

const REQUEST_TIMEOUT_MS = 30_000;
type JumiaRequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export class JumiaClient {
  readonly integrationId: string;
  readonly merchantId: string;
  readonly shopId: string;
  readonly countryCode: string | null;
  readonly marketplaceKey: string;
  private accessToken: string | null;
  private tokenExpiresAt: Date | null;
  private refreshTokenExpiresAt: Date | null;
  private refreshToken: string;
  private clientId: string;
  private authorizationId: string | undefined;
  private authorizationRotationVersion: number | undefined;
  private environment: JumiaEnvironment;
  private supabase: SupabaseClient | null;
  private credentialClient: JumiaCredentialServiceClient | null;

  constructor(config: {
    integrationId: string;
    merchantId: string;
    shopId: string;
    countryCode?: string | null;
    marketplaceKey: string;
    accessToken: string | null;
    refreshToken: string;
    clientId?: string;
    authorizationId?: string;
    authorizationRotationVersion?: number;
    tokenExpiresAt: Date | null;
    refreshTokenExpiresAt?: Date | null;
    environment?: JumiaEnvironment;
    supabase?: SupabaseClient;
    credentialClient?: JumiaCredentialServiceClient;
  }) {
    this.integrationId = config.integrationId;
    this.merchantId = config.merchantId;
    this.shopId = config.shopId;
    this.countryCode = config.countryCode ?? null;
    this.marketplaceKey = config.marketplaceKey;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId ?? getJumiaClientId() ?? '';
    if (!this.clientId) {
      throw new JumiaApiError(500, 'Jumia client ID is not configured');
    }
    this.authorizationId = config.authorizationId;
    this.authorizationRotationVersion = config.authorizationRotationVersion;
    this.tokenExpiresAt = config.tokenExpiresAt;
    this.refreshTokenExpiresAt = config.refreshTokenExpiresAt ?? null;
    this.environment = config.environment ?? getJumiaEnvironment();
    this.supabase = config.supabase ?? null;
    this.credentialClient = config.credentialClient ?? null;
  }

  static async forIntegration(
    supabase: SupabaseClient,
    merchantId: string,
    integrationId: string,
    options?: { credentialClient?: JumiaCredentialServiceClient }
  ): Promise<JumiaClient> {
    return new JumiaClient(
      await loadJumiaIntegrationConfig(
        supabase,
        merchantId,
        integrationId,
        options
      )
    );
  }

  static async forMerchant(
    supabase: SupabaseClient,
    merchantId: string
  ): Promise<JumiaClient> {
    return new JumiaClient(
      await loadSingleJumiaMerchantIntegrationConfig(supabase, merchantId)
    );
  }

  get apiBase(): string {
    return getJumiaBaseUrl(this.environment);
  }

  private needsRefresh(): boolean {
    if (!this.accessToken || !this.tokenExpiresAt) return true;
    return (
      Date.now() >= this.tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS
    );
  }

  async refreshAccessToken(): Promise<void> {
    const updates = await refreshJumiaClientAccessToken(
      {
        integrationId: this.integrationId,
        merchantId: this.merchantId,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        clientId: this.clientId,
        authorizationId: this.authorizationId,
        authorizationRotationVersion: this.authorizationRotationVersion,
        tokenExpiresAt: this.tokenExpiresAt,
        refreshTokenExpiresAt: this.refreshTokenExpiresAt,
        supabase: this.supabase,
        credentialClient: this.credentialClient,
        apiBase: this.apiBase,
      },
      (url, init) => this.fetchWithThrottle(url, init)
    );

    if (updates.accessToken !== undefined) {
      this.accessToken = updates.accessToken;
    }
    if (updates.refreshToken !== undefined) {
      this.refreshToken = updates.refreshToken;
    }
    if (updates.tokenExpiresAt !== undefined) {
      this.tokenExpiresAt = updates.tokenExpiresAt;
    }
    if (updates.refreshTokenExpiresAt !== undefined) {
      this.refreshTokenExpiresAt = updates.refreshTokenExpiresAt ?? null;
    }
    if (updates.clientId !== undefined) {
      this.clientId = updates.clientId;
    }
    if (updates.authorizationRotationVersion !== undefined) {
      this.authorizationRotationVersion = updates.authorizationRotationVersion;
    }
  }

  async getValidToken(): Promise<string> {
    if (this.needsRefresh()) await this.refreshAccessToken();
    if (!this.accessToken) {
      throw new JumiaApiError(401, 'No access token available');
    }
    return this.accessToken;
  }

  private async fetchWithThrottle(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    await waitForJumiaRequestSlot(this.merchantId);
    return fetch(url, init);
  }

  async request(
    method: JumiaRequestMethod,
    path: string,
    schema?: undefined,
    body?: unknown
  ): Promise<unknown>;
  async request<TSchema extends z.ZodType>(
    method: JumiaRequestMethod,
    path: string,
    schema: TSchema,
    body?: unknown
  ): Promise<z.infer<TSchema>>;
  async request<TSchema extends z.ZodType>(
    method: JumiaRequestMethod,
    path: string,
    schema?: TSchema,
    body?: unknown
  ): Promise<unknown> {
    const token = await this.getValidToken();
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      let response = await this.fetchWithThrottle(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      // Auto-retry on 401 with refreshed token
      if (response.status === 401) {
        await this.refreshAccessToken();
        if (!this.accessToken) {
          throw new JumiaApiError(
            401,
            'Access token is null after refresh — cannot retry request'
          );
        }
        const retryController = new AbortController();
        const retryTimeout = setTimeout(
          () => retryController.abort(),
          REQUEST_TIMEOUT_MS
        );
        try {
          response = await this.fetchWithThrottle(url, {
            method,
            headers: {
              ...headers,
              Authorization: `Bearer ${this.accessToken}`,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: retryController.signal,
          });
        } finally {
          clearTimeout(retryTimeout);
        }
      }

      if (!response.ok) {
        const text = await response.text();
        throw new JumiaApiError(response.status, text, text);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new JumiaApiError(
          response.status,
          'Response body is not valid JSON'
        );
      }
      if (schema) {
        return schema.parse(json);
      }
      return json;
    } catch (error) {
      if (error instanceof JumiaApiError) throw error;
      if (
        (error instanceof Error || error instanceof DOMException) &&
        error.name === 'AbortError'
      ) {
        throw new JumiaApiError(408, 'Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getShops(): Promise<JumiaShop[]> {
    const response = await this.request(
      'GET',
      '/shops',
      JumiaShopsResponseSchema
    );
    return response.shops;
  }
}
