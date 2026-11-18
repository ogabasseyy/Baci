/** Exact loopback-only test origins; production proxy configuration is untouched. */
export function isLocalFixtureFetch(input) {
  const url = new URL(input);
  return (
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password
  );
}
export function composeLocalCsp(value, dataOrigin) {
  const data = new URL(dataOrigin);
  if (data.origin !== dataOrigin || !isLocalFixtureFetch(dataOrigin))
    throw Error('LOCAL_PROFILE_ONLY');
  const frame = 'http://127.0.0.1:43175';
  const withFrame = /frame-src [^;]*/.test(value)
    ? value.replace(/frame-src ([^;]*)/, (_, v) => `frame-src ${v} ${frame}`)
    : `${value}; frame-src 'self' ${frame}`;
  return /connect-src [^;]*/.test(withFrame)
    ? withFrame.replace(
        /connect-src ([^;]*)/,
        (_, v) => `connect-src ${v} ${data.origin}`
      )
    : `${withFrame}; connect-src 'self' ${data.origin}`;
}
export function localHeaderSetter(original, dataOrigin) {
  return function (name, value) {
    const next =
      name.toLowerCase() === 'content-security-policy' &&
      typeof value === 'string'
        ? composeLocalCsp(value, dataOrigin)
        : value;
    return original.call(this, name, next);
  };
}
