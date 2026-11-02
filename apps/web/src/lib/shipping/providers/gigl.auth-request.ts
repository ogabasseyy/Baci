import type {
  GiglFetchOptions,
  GiglProviderIo,
  GiglToken,
} from './gigl.constants';

/** Decides whether a response means GIG rejected the access token. */
export type GiglTokenRejectionCheck = (response: Response) => Promise<boolean>;

const isTokenRejectedStatus: GiglTokenRejectionCheck = (response) =>
  Promise.resolve(response.status === 401 || response.status === 403);

type GiglAccessTokenRequestResult = {
  response: Response;
  tokenData: GiglToken;
  requestOptions: GiglFetchOptions;
  deadlineAt?: number;
};

export async function fetchGiglWithAccessToken(
  io: GiglProviderIo,
  getApiToken: (timeout?: number, signal?: AbortSignal) => Promise<GiglToken>,
  invalidateCachedToken: (token?: string) => void,
  url: string,
  tokenData: GiglToken,
  buildRequest: (tokenData: GiglToken) => GiglFetchOptions,
  isTokenRejected: GiglTokenRejectionCheck = isTokenRejectedStatus
): Promise<GiglAccessTokenRequestResult> {
  const withAccessToken = (options: GiglFetchOptions, token: string) => {
    const headers = new Headers(options.headers);
    headers.set('access-token', token);

    return { ...options, headers };
  };

  const initialOptions = buildRequest(tokenData);
  const initialDeadlineAt = initialOptions.timeout
    ? Date.now() + initialOptions.timeout
    : undefined;
  let response = await io.safeFetch(
    url,
    withAccessToken(initialOptions, tokenData.token)
  );

  if (!(await isTokenRejected(response))) {
    return {
      response,
      tokenData,
      requestOptions: initialOptions,
      deadlineAt: initialDeadlineAt,
    };
  }

  io.log('warn', 'GIGL token rejected; refreshing token', {
    code: 'gigl_token_http_rejected',
    status: response.status,
  });
  invalidateCachedToken(tokenData.token);

  const refreshedToken = await getApiToken(
    initialOptions.timeout,
    initialOptions.signal ?? undefined
  );
  const refreshedOptions = buildRequest(refreshedToken);
  response = await io.safeFetch(
    url,
    withAccessToken(refreshedOptions, refreshedToken.token)
  );

  return {
    response,
    tokenData: refreshedToken,
    requestOptions: refreshedOptions,
    deadlineAt: refreshedOptions.timeout
      ? Date.now() + refreshedOptions.timeout
      : undefined,
  };
}
