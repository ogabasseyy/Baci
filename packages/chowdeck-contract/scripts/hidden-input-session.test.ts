import { runHiddenInputSession } from './hidden-input-session.mjs';

describe('hidden TTY input lifecycle', () => {
  it.each(['success', 'error'] as const)(
    'restores echo and zeros owned buffers on %s',
    async (mode) => {
      const echoStates: boolean[] = [];
      const apiKey = Buffer.from('secret-api-key');
      const merchantReference = Buffer.from('merchant-ref');

      const operation = runHiddenInputSession({
        driver: {
          setEcho: async (enabled: boolean) => {
            echoStates.push(enabled);
          },
          readSecrets: async () => ({ apiKey, merchantReference }),
          installSignalHandler: () => () => undefined,
        },
        action: async () => {
          if (mode !== 'success') throw new Error('unsafe bait secret-api-key');
          return 'ok';
        },
      });

      if (mode === 'success') await expect(operation).resolves.toBe('ok');
      else await expect(operation).rejects.toThrow('Observation failed');
      expect(echoStates).toEqual([false, true]);
      expect(apiKey.every((byte) => byte === 0)).toBe(true);
      expect(merchantReference.every((byte) => byte === 0)).toBe(true);
    }
  );

  it('cancels pending input promptly and never starts the action after a signal', async () => {
    const echoStates: boolean[] = [];
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');
    let signalHandler: (() => void) | undefined;
    let resolveInput:
      | ((value: { apiKey: Buffer; merchantReference: Buffer }) => void)
      | undefined;
    let actionCalls = 0;

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => echoStates.push(enabled),
        readSecrets: async () =>
          new Promise((resolve) => {
            resolveInput = resolve;
          }),
        installSignalHandler: (handler: () => void) => {
          signalHandler = handler;
          return () => undefined;
        },
      },
      action: async () => {
        actionCalls += 1;
        return 'unsafe';
      },
    });
    await Promise.resolve();

    signalHandler?.();
    await expect(operation).rejects.toThrow('Observation failed');
    expect(actionCalls).toBe(0);
    expect(echoStates).toEqual([false, true]);

    resolveInput?.({ apiKey, merchantReference });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
  });

  it('cancels a pending action promptly and supplies its abort signal', async () => {
    const echoStates: boolean[] = [];
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');
    let signalHandler: (() => void) | undefined;
    let actionSignal: AbortSignal | undefined;
    let actionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      actionStarted = resolve;
    });

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => echoStates.push(enabled),
        readSecrets: async () => ({ apiKey, merchantReference }),
        installSignalHandler: (handler: () => void) => {
          signalHandler = handler;
          return () => undefined;
        },
      },
      action: async (_secrets, signal) => {
        actionSignal = signal;
        actionStarted?.();
        return new Promise<string>(() => undefined);
      },
    });
    await started;

    signalHandler?.();
    await expect(operation).rejects.toThrow('Observation failed');
    expect(actionSignal?.aborted).toBe(true);
    expect(echoStates).toEqual([false, true]);
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
  });

  it('attempts buffer clearing and echo restoration when signal disposal throws', async () => {
    const echoStates: boolean[] = [];
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => echoStates.push(enabled),
        readSecrets: async () => ({ apiKey, merchantReference }),
        installSignalHandler: () => () => {
          throw new Error('unsafe disposer detail');
        },
      },
      action: async () => 'ok',
    });

    await expect(operation).rejects.toThrow('Observation failed');
    expect(echoStates).toEqual([false, true]);
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
  });

  it('sanitizes echo restoration failure after clearing owned buffers', async () => {
    const apiKey = Buffer.from('secret-api-key');
    const merchantReference = Buffer.from('merchant-ref');

    const operation = runHiddenInputSession({
      driver: {
        setEcho: async (enabled: boolean) => {
          if (enabled) throw new Error('unsafe restore detail secret-api-key');
        },
        readSecrets: async () => ({ apiKey, merchantReference }),
        installSignalHandler: () => () => undefined,
      },
      action: async () => 'ok',
    });

    await expect(operation).rejects.toThrow(/^Observation failed$/);
    expect(apiKey.every((byte) => byte === 0)).toBe(true);
    expect(merchantReference.every((byte) => byte === 0)).toBe(true);
  });
});
