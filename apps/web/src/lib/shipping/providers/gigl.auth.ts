import type { z } from 'zod';
import { fetchGiglWithAccessToken } from './gigl.auth-request';
import {
  GIGL_EMAIL,
  GIGL_LOGIN_RESPONSE_MAX_BYTES,
  GIGL_PASSWORD,
  GIGL_TOKEN_EXPIRY_MS,
  type GiglApiEnvelope,
  type GiglFetchOptions,
  type GiglProviderIo,
  type GiglToken,
  getConfiguredGiglBaseUrl,
  withGiglTokenRequestTimeout,
} from './gigl.constants';
import {
  type GiglResponseJsonOptions,
  readResponseJson,
  readResponseJsonWithTimeout,
} from './gigl.response-json';
import { giglSchemas } from './gigl.schemas';

function normalizeCustomerType(...values: unknown[]): number {
  for (const value of values)
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

function unwrapApiEnvelope(payload: unknown): GiglApiEnvelope {
  const parsed = giglSchemas.envelopeObject.safeParse(payload);

  if (!parsed.success) {
    return {
      status: 500,
      data: payload,
    };
  }

  const outer = parsed.data;
  const nestedEnvelope = giglSchemas.envelopeObject.safeParse(outer.data);
  if (
    nestedEnvelope.success &&
    (nestedEnvelope.data.data !== undefined ||
      nestedEnvelope.data.status !== undefined ||
      nestedEnvelope.data.success !== undefined ||
      nestedEnvelope.data.message !== undefined)
  ) {
    return {
      status: nestedEnvelope.data.status ?? outer.status ?? 200,
      success: nestedEnvelope.data.success ?? outer.success,
      message: nestedEnvelope.data.message || outer.message,
      data: nestedEnvelope.data.data,
    };
  }

  return {
    status: outer.status ?? 200,
    success: outer.success,
    message: outer.message,
    data: outer.data,
  };
}

function isAuthRejectedEnvelope(envelope: GiglApiEnvelope): boolean {
  if (envelope.status === 401 || envelope.status === 403) return true;

  const message = envelope.message?.toLowerCase() ?? '';
  const hasAuthFailure = [
    'wrong authentication credentials',
    'unauthorized',
    'unauthorised',
    'invalid token',
    'expired token',
    'token expired',
    'authentication failed',
    'authentication required',
    'authorization failed',
    'authorization required',
  ].some((authFailure) => message.includes(authFailure));

  if (envelope.success === false) {
    return hasAuthFailure;
  }

  return !(envelope.status >= 200 && envelope.status < 300) && hasAuthFailure;
}

export class GiglApiClient {
  private cachedToken: GiglToken | null;
  private tokenRequest: Promise<GiglToken> | null = null;

  constructor(
    private readonly io: GiglProviderIo,
    initialToken: GiglToken | null = null
  ) {
    this.cachedToken = initialToken;
  }

  get currentToken(): GiglToken | null {
    return this.cachedToken;
  }

  get baseUrl(): string {
    return getConfiguredGiglBaseUrl();
  }

  parseEnvelopeData<T>(
    envelope: GiglApiEnvelope,
    schema: z.ZodType<T>,
    description: string
  ): T {
    const parsed = schema.safeParse(envelope.data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(({ code, path }) => ({
        code,
        path,
      }));
      this.io.log('warn', `Invalid GIGL ${description} response`, {
        code: 'gigl_invalid_response',
        issueCount: issues.length,
        issues,
        status: envelope.status,
      });
      throw new Error(`Invalid GIGL ${description} response`);
    }

    return parsed.data;
  }

  getApiToken(timeout?: number, signal?: AbortSignal): Promise<GiglToken> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return Promise.resolve(this.cachedToken);
    }

    if (this.tokenRequest) {
      return withGiglTokenRequestTimeout(this.tokenRequest, timeout, signal);
    }

    this.tokenRequest = this.fetchApiToken().finally(() => {
      this.tokenRequest = null;
    });
    void this.tokenRequest.catch(() => undefined);

    return withGiglTokenRequestTimeout(this.tokenRequest, timeout, signal);
  }

  async safeFetchEnvelopeWithAccessToken(
    url: string,
    tokenData: GiglToken,
    buildRequest: (tokenData: GiglToken) => GiglFetchOptions,
    responseOptions?: GiglResponseJsonOptions
  ): Promise<{
    envelope: GiglApiEnvelope | null;
    response: Response;
    tokenData: GiglToken;
  }> {
    let result = await fetchGiglWithAccessToken(
      this.io,
      this.getApiToken.bind(this),
      (token) => this.invalidateCachedToken(token),
      url,
      tokenData,
      buildRequest
    );

    if (!result.response.ok) {
      return {
        envelope: null,
        response: result.response,
        tokenData: result.tokenData,
      };
    }

    let envelope = unwrapApiEnvelope(
      await readResponseJsonWithTimeout(
        result.response,
        result.requestOptions.timeout,
        result.requestOptions.signal ?? undefined,
        result.deadlineAt,
        responseOptions
      )
    );
    if (!isAuthRejectedEnvelope(envelope)) {
      return {
        envelope,
        response: result.response,
        tokenData: result.tokenData,
      };
    }

    this.io.log(
      'warn',
      'GIGL token rejected in API envelope; refreshing token',
      {
        code: 'gigl_token_rejected_envelope',
        status: envelope.status,
      }
    );
    this.invalidateCachedToken(result.tokenData.token);

    const retryOptions = result.requestOptions;
    const refreshedToken = await this.getApiToken(
      retryOptions.timeout,
      retryOptions.signal ?? undefined
    );
    result = await fetchGiglWithAccessToken(
      this.io,
      this.getApiToken.bind(this),
      (token) => this.invalidateCachedToken(token),
      url,
      refreshedToken,
      buildRequest
    );

    if (!result.response.ok) {
      return {
        envelope: null,
        response: result.response,
        tokenData: result.tokenData,
      };
    }

    envelope = unwrapApiEnvelope(
      await readResponseJsonWithTimeout(
        result.response,
        result.requestOptions.timeout,
        result.requestOptions.signal ?? undefined,
        result.deadlineAt,
        responseOptions
      )
    );
    return {
      envelope,
      response: result.response,
      tokenData: result.tokenData,
    };
  }

  private async fetchApiToken(): Promise<GiglToken> {
    this.io.log('info', 'Fetching new GIGL API token');

    if (!GIGL_EMAIL || !GIGL_PASSWORD) {
      throw new Error('GIGL credentials not configured');
    }

    const response = await this.io.safeFetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: GIGL_EMAIL, password: GIGL_PASSWORD }),
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      this.io.log('error', 'GIGL login failed', {
        code: 'gigl_login_http_error',
        status: response.status,
      });
      throw new Error('GIGL API authentication failed');
    }

    const envelope = unwrapApiEnvelope(
      await readResponseJson(response, {
        maxResponseBytes: GIGL_LOGIN_RESPONSE_MAX_BYTES,
      })
    );

    if (envelope.status !== 200) {
      this.io.log('warn', 'Invalid GIGL login response', {
        code: 'gigl_invalid_login_envelope',
        status: envelope.status,
      });
      throw new Error('Invalid GIGL login response');
    }

    const loginData = this.parseEnvelopeData(
      envelope,
      giglSchemas.loginData,
      'login'
    );

    this.cachedToken = {
      token: loginData['access-token'],
      userChannelCode: loginData.UserChannelCode,
      customerType: normalizeCustomerType(
        loginData?.CustomerType,
        loginData?.UserChannelType
      ),
      expiresAt: Date.now() + GIGL_TOKEN_EXPIRY_MS,
    };

    return this.cachedToken;
  }

  private invalidateCachedToken(token?: string): void {
    if (!token || this.cachedToken?.token === token) {
      this.cachedToken = null;
    }
  }
}
