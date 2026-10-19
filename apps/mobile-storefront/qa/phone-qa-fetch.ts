export function createPhoneQaFetch(
  origin: string,
  token: string,
  transport: typeof fetch
): typeof fetch {
  if (
    !/^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):4191$/.test(
      origin
    ) ||
    !/^[a-f0-9]{48}$/.test(token)
  )
    throw new Error('Local test configuration unavailable');
  return async (input, init) => {
    const url = String(input);
    if (
      !/^http:\/\/127\.0\.0\.1:4183\/(qa-config\.json|scenario\/(701|702)\/(screen|csrf|qa-capability|policy|cancel|recovery)(\?goalId=[a-f0-9-]{36})?)$/.test(
        url
      )
    )
      throw new Error('Test route denied');
    const headers = new Headers(init?.headers);
    headers.delete('cookie');
    headers.delete('origin');
    headers.delete('authorization');
    headers.set('x-baci-qa-token', token);
    const response = await transport(
      url.replace('http://127.0.0.1:4183', origin),
      { ...init, headers, credentials: 'omit', redirect: 'error' }
    );
    if (response.redirected) throw new Error('Test redirect denied');
    return new Proxy(response, {
      get(target, property) {
        if (property === 'url') return url;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
}
