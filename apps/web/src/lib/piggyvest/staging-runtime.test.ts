import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { createPiggyvestStagingRuntime } from './staging-runtime';

vi.mock('server-only', () => ({}));
vi.mock('./postgres-executor', () => ({
  createPiggyvestPostgresExecutor: vi.fn(),
}));

describe('staging runtime', () => {
  it('fails closed before constructing storage when runtime configuration is absent', () => {
    expect(() => createPiggyvestStagingRuntime(undefined)).toThrow(
      /^PiggyVest staging runtime unavailable$/
    );
    expect(createPiggyvestPostgresExecutor).not.toHaveBeenCalled();
  });
  it('does not expose configuration secrets in errors', () => {
    expect(() =>
      createPiggyvestStagingRuntime({ secret: 'synthetic-private-value' })
    ).toThrow(/^PiggyVest staging runtime unavailable$/);
  });
});
