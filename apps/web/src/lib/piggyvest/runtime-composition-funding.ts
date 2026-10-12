import 'server-only';
import type { RuntimeCompositionServices } from './runtime-composition.types';

export function guardRuntimeCompositionFunding(
  source: NonNullable<RuntimeCompositionServices['funding']>,
  signal: AbortSignal
) {
  const current = () => {
    if (signal.aborted) throw new Error('Funding unavailable');
  };
  return {
    fundingConfiguration: source.fundingConfiguration,
    fundingExecute: async (
      ...args: Parameters<typeof source.fundingExecute>
    ) => {
      current();
      const result = await source.fundingExecute(...args);
      current();
      return result;
    },
    mappingExecute: async (
      ...args: Parameters<typeof source.mappingExecute>
    ) => {
      current();
      const result = await source.mappingExecute(...args);
      current();
      return result;
    },
    fetchImplementation: async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ) => {
      current();
      const signals = [signal];
      if (init?.signal) signals.push(init.signal);
      if (input instanceof Request) signals.push(input.signal);
      const combined = AbortSignal.any(signals);
      combined.throwIfAborted();
      const response = await source.fetchImplementation(input, {
        ...init,
        signal: combined,
      });
      if (combined.aborted) {
        if (response.body && !response.body.locked)
          void response.body.cancel().catch(() => undefined);
        throw new Error('Funding unavailable');
      }
      return response;
    },
  };
}
