/** Explicit local authoring host. Worker execution remains on a distinct fixed origin. */
export function localPreviewHost(value: string) {
  const url = new URL(value);
  const port = Number(url.port);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    port < 1024 ||
    port > 65535 ||
    port === 4101
  )
    throw Error('Invalid local preview host');
  return url.origin;
}
