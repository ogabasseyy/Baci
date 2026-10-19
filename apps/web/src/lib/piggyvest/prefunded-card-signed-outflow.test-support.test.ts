import { describe, expect, it, vi } from 'vitest';
import { setupSignedOutflowReplay } from './prefunded-card-signed-outflow.test-support';

vi.mock('server-only', () => ({}));

describe('isolated signed-outflow replay test support', () => {
  it('provides a fresh mock-only context with test-only authentication', async () => {
    const first = setupSignedOutflowReplay();
    const second = setupSignedOutflowReplay();
    first.sample.envelope.eventData.amount = 9999;

    await expect(second.replay(second.receipt())).resolves.toEqual({
      outcome: 'processed',
      projection: 'not_applicable',
    });

    expect(second.sample.envelope.eventData.amount).toBe(10000);
    expect(second.sample.configuration.webhookSecret).toContain('test-only');
    expect(first.fetchImplementation).not.toHaveBeenCalled();
    expect(second.ledgerExecute).not.toHaveBeenCalled();
  });

  it('refuses unreviewed mock provider and database operations', async () => {
    const selected = setupSignedOutflowReplay();

    await expect(
      selected.fetchImplementation('https://example.invalid/unreviewed')
    ).rejects.toThrow('Unexpected test provider GET');
    await expect(
      selected.ingestionExecute('unreviewed SQL', [])
    ).rejects.toThrow('Unexpected test SQL');

    expect(selected.ledgerExecute).not.toHaveBeenCalled();
  });
});
