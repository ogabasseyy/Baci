/**
 * @template T
 * @param {{
 *   driver: {
 *     setEcho: (enabled: boolean) => Promise<unknown>;
 *     readSecrets: () => Promise<{apiKey: Buffer; merchantReference: Buffer}>;
 *     installSignalHandler: (handler: () => void) => () => void;
 *   };
 *   action: (secrets: {apiKey: Buffer; merchantReference: Buffer}, signal: AbortSignal) => Promise<T>;
 * }} options
 * @returns {Promise<T>}
 */
export async function runHiddenInputSession(options) {
  let secrets;
  const controller = new AbortController();
  const interrupted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
  });
  /** @type {() => void} */
  let removeSignalHandler = () => undefined;
  let cleanupFailed = false;
  try {
    await options.driver.setEcho(false);
    removeSignalHandler = options.driver.installSignalHandler(() => controller.abort());
    const input = options.driver.readSecrets().then((value) => {
      if (controller.signal.aborted) {
        value.apiKey.fill(0);
        value.merchantReference.fill(0);
      } else {
        secrets = value;
      }
      return value;
    });
    secrets = /** @type {{apiKey: Buffer; merchantReference: Buffer}} */ (await Promise.race([input, interrupted]));
    if (controller.signal.aborted) throw new Error('interrupted');
    return /** @type {T} */ (await Promise.race([options.action(secrets, controller.signal), interrupted]));
  } catch {
    throw new Error('Observation failed');
  } finally {
    try { removeSignalHandler(); } catch { cleanupFailed = true; }
    secrets?.apiKey.fill(0);
    secrets?.merchantReference.fill(0);
    try { await options.driver.setEcho(true); } catch { cleanupFailed = true; }
    if (cleanupFailed) throw new Error('Observation failed');
  }
}

