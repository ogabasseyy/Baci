let installed = false;
/** Owned by trusted local composition, not an HTTP/configuration surface. */
export function installLocalExperienceAdmission() {
  if (process.env.NODE_ENV === 'production' || installed)
    throw Error('INVALID_LOCAL_PROFILE');
  installed = true;
  let active = true;
  return () => {
    if (active) {
      installed = false;
      active = false;
    }
  };
}
export function allowsLocalExperienceRequest(request: Request) {
  if (!installed || process.env.NODE_ENV === 'production') return false;
  const url = new URL(request.url);
  return (
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  );
}
