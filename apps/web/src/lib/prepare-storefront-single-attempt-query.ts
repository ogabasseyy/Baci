export type StorefrontSingleAttemptQuery<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => StorefrontSingleAttemptQuery<T>;
  retry?: (enabled: boolean) => PromiseLike<T>;
};

export function prepareStorefrontSingleAttemptQuery<T>(
  query: StorefrontSingleAttemptQuery<T>,
  signal: AbortSignal
): PromiseLike<T> {
  const abortable =
    typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query;
  return typeof abortable.retry === 'function'
    ? abortable.retry(false)
    : abortable;
}
