import { vi } from 'vitest';

export function chainResult(
  result: { data: unknown; error: unknown } | undefined,
  terminal: 'in' | 'limit' | 'maybeSingle' | 'order' | 'range' | undefined
): Record<string, ReturnType<typeof vi.fn>> {
  const resolved = result ?? { data: null, error: null };
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'eq',
    'gte',
    'in',
    'limit',
    'lte',
    'or',
    'order',
    'range',
    'select',
  ]) {
    chain[method] = vi.fn(() =>
      method === terminal ? Promise.resolve(resolved) : chain
    );
  }
  chain.maybeSingle = vi.fn(() =>
    terminal === 'maybeSingle' ? Promise.resolve(resolved) : chain
  );
  return chain;
}
