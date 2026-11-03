/** Parses the callback using public URL APIs, preserving Expo's query/hash precedence. */
export function getOAuthQueryParams(input: string): {
  errorCode: string | null;
  params: Record<string, string>;
} {
  const url = new URL(input, 'https://auth.invalid');
  const params: Record<string, string> = Object.create(null);
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  new URLSearchParams(url.hash.replace(/^#/, '')).forEach((value, key) => {
    params[key] = value;
  });
  const errorCode = params.errorCode ?? null;
  delete params.errorCode;
  if (errorCode) delete params.code;
  return { errorCode, params };
}
