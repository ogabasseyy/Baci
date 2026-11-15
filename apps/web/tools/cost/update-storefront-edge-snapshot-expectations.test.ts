import { describe, expect, it } from 'vitest';
import { updateStorefrontEdgeSnapshotExpectations } from './update-storefront-edge-snapshot-expectations';

const OLD_SHA = 'a'.repeat(64);
const NEW_SHA = 'b'.repeat(64);
const source = `expect(result).toEqual({
    validationKind: 'repository_snapshot',
    snapshotSha256:
      '${OLD_SHA}',
    validatedSourceSha: expect.stringMatching(/^[a-f0-9]{40}$/),
    rowCount: 641,
  });
`;

describe('updateStorefrontEdgeSnapshotExpectations', () => {
  it('rewrites the expected digest and row count and nothing else', () => {
    const updated = updateStorefrontEdgeSnapshotExpectations(source, {
      snapshotSha256: NEW_SHA,
      rowCount: 643,
    });

    expect(updated).toBe(
      source.replace(OLD_SHA, NEW_SHA).replace('rowCount: 641', 'rowCount: 643')
    );
  });

  it('is a no-op when the expectations already match', () => {
    expect(
      updateStorefrontEdgeSnapshotExpectations(source, {
        snapshotSha256: OLD_SHA,
        rowCount: 641,
      })
    ).toBe(source);
  });

  it('refuses a test file without a digest expectation', () => {
    expect(() =>
      updateStorefrontEdgeSnapshotExpectations('rowCount: 1,', {
        snapshotSha256: NEW_SHA,
        rowCount: 1,
      })
    ).toThrow('exactly one snapshotSha256 expectation (found 0)');
  });

  it('refuses an ambiguous test file with two row count expectations', () => {
    expect(() =>
      updateStorefrontEdgeSnapshotExpectations(`${source}rowCount: 2,\n`, {
        snapshotSha256: NEW_SHA,
        rowCount: 1,
      })
    ).toThrow('exactly one rowCount expectation (found 2)');
  });

  it('rejects a malformed digest or row count', () => {
    expect(() =>
      updateStorefrontEdgeSnapshotExpectations(source, {
        snapshotSha256: 'ABC',
        rowCount: 1,
      })
    ).toThrow('lowercase sha256');
    expect(() =>
      updateStorefrontEdgeSnapshotExpectations(source, {
        snapshotSha256: NEW_SHA,
        rowCount: -1,
      })
    ).toThrow('non-negative integer');
  });
});
