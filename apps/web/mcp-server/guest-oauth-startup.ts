/** Bound the entire OAuth readiness chain, including merchant resolution. */
export async function withOAuthReadinessTimeout<T>(ready: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ready(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OAuth readiness timeout')), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
