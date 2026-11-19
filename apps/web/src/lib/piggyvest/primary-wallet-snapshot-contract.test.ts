import { describe, expect, it } from 'vitest';
import {
  notStartedPrimaryWalletSnapshot,
  PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER,
} from './primary-wallet-snapshot-contract';

const withVersion = (version?: string) =>
  new Headers(
    version === undefined
      ? {}
      : { [PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER]: version }
  );

describe('notStartedPrimaryWalletSnapshot', () => {
  it('reports not started only to a client that advertises snapshot version 2', () => {
    expect(notStartedPrimaryWalletSnapshot(withVersion('2'))).toEqual({
      status: 'not_started',
      account: null,
    });
  });

  it.each([
    ['no version', undefined],
    ['the original version', '1'],
    ['an empty version', ''],
    ['a suffixed version', '2.0'],
    ['a later unknown version', '3'],
    ['a status name instead of a version', 'not_started'],
  ])('keeps the legacy pending reply for %s', (_label, version) => {
    expect(notStartedPrimaryWalletSnapshot(withVersion(version))).toEqual({
      status: 'pending',
      account: null,
    });
  });
});
