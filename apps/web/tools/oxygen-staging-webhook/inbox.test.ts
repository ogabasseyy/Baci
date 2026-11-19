// @vitest-environment node
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import samples from '../../src/lib/payments/oxygen/__fixtures__/webhook-samples.json';
import { parseOxygenWebhook } from '../../src/lib/payments/oxygen/webhook';
import { openStagingInbox } from './inbox';

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function path() {
  const dir = await mkdtemp(join(tmpdir(), 'oxygen-inbox-'));
  directories.push(dir);
  return join(dir, 'inbox.sqlite');
}
function event() {
  const value = parseOxygenWebhook(
    samples['Direct partner settlement callback']
  );
  if (!value) throw new Error('fixture invalid');
  return value;
}

describe('durable staging webhook inbox', () => {
  it('persists once across database reopen and acknowledges a duplicate', async () => {
    const filename = await path();
    const first = openStagingInbox(filename, 'partner-example');
    expect(await first.accept(event())).toBe('accepted');
    first.close();
    const reopened = openStagingInbox(filename, 'partner-example');
    expect(await reopened.accept(event())).toBe('duplicate');
    expect(reopened.summary()).toEqual([{ kind: 'settlement', count: 1 }]);
    reopened.close();
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
  });
  it('keeps partner namespaces distinct within the same local database', async () => {
    const filename = await path();
    const first = openStagingInbox(filename, 'partner-example');
    const second = openStagingInbox(filename, 'another-partner');
    expect(await first.accept(event())).toBe('accepted');
    expect(await second.accept(event())).toBe('accepted');
    expect(first.summary()).toEqual([{ kind: 'settlement', count: 1 }]);
    first.close();
    second.close();
  });
  it('rejects reuse of an event ID with a changed payload rather than silently losing it', async () => {
    const inbox = openStagingInbox(await path(), 'partner-example');
    const original = event();
    await inbox.accept(original);
    await expect(
      inbox.accept({
        ...original,
        action: 'record_submitted_settlement',
        kind: 'settlement',
        amountMinor: 123,
      })
    ).rejects.toThrow('Event conflict');
    inbox.close();
  });
});
