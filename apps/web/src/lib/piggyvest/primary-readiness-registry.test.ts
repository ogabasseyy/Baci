import { describe, expect, it, type Mock, vi } from 'vitest';
import {
  PRIMARY_READINESS_IDS,
  type PrimaryReadinessId,
  type PrimaryReadinessReader,
  type PrimaryReadinessRegistry,
  primaryReadinessRegistry,
  readPrimaryOnboardingReadiness,
} from './primary-readiness-registry';

vi.mock('server-only', () => ({}));

type ReaderMocks = Record<PrimaryReadinessId, Mock<PrimaryReadinessReader>>;

function registryWhere(
  outcome: (id: PrimaryReadinessId) => PrimaryReadinessReader
): ReaderMocks {
  const registry = {} as ReaderMocks;
  for (const id of PRIMARY_READINESS_IDS) registry[id] = vi.fn(outcome(id));
  return registry;
}

const ready: PrimaryReadinessReader = async () => true;
const notReady: PrimaryReadinessReader = async () => false;

describe('primary onboarding readiness registry', () => {
  it('requires every subsystem a backed wallet depends on', () => {
    expect(PRIMARY_READINESS_IDS).toEqual([
      'interest_marker',
      'ledger_fences',
      'settlement_worker',
      'spend_core',
      'vtu',
      'imei',
      'checkout',
      'webhook_capture',
      'legacy_migration',
    ]);
  });

  it('ships with every reader reporting not ready', async () => {
    expect(Object.keys(primaryReadinessRegistry).sort()).toEqual(
      [...PRIMARY_READINESS_IDS].sort()
    );
    for (const id of PRIMARY_READINESS_IDS)
      await expect(primaryReadinessRegistry[id]()).resolves.toBe(false);
    await expect(readPrimaryOnboardingReadiness()).resolves.toEqual({
      status: 'not_ready',
      missing: 'interest_marker',
    });
  });

  it('is ready only when every reader confirms', async () => {
    const registry = registryWhere(() => ready);
    await expect(readPrimaryOnboardingReadiness(registry)).resolves.toEqual({
      status: 'ready',
    });
    for (const id of PRIMARY_READINESS_IDS)
      expect(registry[id]).toHaveBeenCalledOnce();
  });

  it.each(
    PRIMARY_READINESS_IDS
  )('stays closed when only %s is not ready', async (blocked) => {
    const registry = registryWhere((id) => (id === blocked ? notReady : ready));
    await expect(readPrimaryOnboardingReadiness(registry)).resolves.toEqual({
      status: 'not_ready',
      missing: blocked,
    });
  });

  it('stops at the first unready subsystem without reading the rest', async () => {
    const registry = registryWhere((id) =>
      id === 'ledger_fences' ? notReady : ready
    );
    await readPrimaryOnboardingReadiness(registry);
    expect(registry.interest_marker).toHaveBeenCalledOnce();
    expect(registry.ledger_fences).toHaveBeenCalledOnce();
    expect(registry.settlement_worker).not.toHaveBeenCalled();
    expect(registry.legacy_migration).not.toHaveBeenCalled();
  });

  it.each([
    ['a truthy string', 'true'],
    ['a truthy number', 1],
    ['an object', { ready: true }],
    ['undefined', undefined],
  ])('treats %s as not ready', async (_label, value) => {
    const registry = registryWhere((id) =>
      id === 'webhook_capture'
        ? ((async () => value) as unknown as PrimaryReadinessReader)
        : ready
    );
    await expect(readPrimaryOnboardingReadiness(registry)).resolves.toEqual({
      status: 'not_ready',
      missing: 'webhook_capture',
    });
  });

  it('treats an unregistered subsystem as not ready', async () => {
    const { legacy_migration: _omitted, ...rest } = registryWhere(() => ready);
    await expect(
      readPrimaryOnboardingReadiness(rest as PrimaryReadinessRegistry)
    ).resolves.toEqual({ status: 'not_ready', missing: 'legacy_migration' });
  });

  it('ignores an inherited reader that was never registered', async () => {
    const registry = Object.create(
      registryWhere(() => ready)
    ) as PrimaryReadinessRegistry;
    await expect(readPrimaryOnboardingReadiness(registry)).resolves.toEqual({
      status: 'not_ready',
      missing: 'interest_marker',
    });
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('readiness db down'))],
    [
      'throws synchronously',
      () => {
        throw new Error('readiness reader crashed');
      },
    ],
  ])('reports unavailable when a reader %s', async (_label, failure) => {
    const registry = registryWhere((id) =>
      id === 'checkout' ? (failure as PrimaryReadinessReader) : ready
    );
    await expect(readPrimaryOnboardingReadiness(registry)).resolves.toEqual({
      status: 'unavailable',
      missing: 'checkout',
    });
  });
});
