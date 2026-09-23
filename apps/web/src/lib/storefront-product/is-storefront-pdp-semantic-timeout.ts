export const isStorefrontPdpSemanticTimeout = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const name = Reflect.get(error, 'name');
  if (name === 'TimeoutError') return true;
  const message = Reflect.get(error, 'message');
  return (
    typeof message === 'string' &&
    /(?:timed out|timeout|aborted due to timeout)/i.test(message)
  );
};
