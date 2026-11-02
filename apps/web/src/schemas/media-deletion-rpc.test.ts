import { describe, expect, it } from 'vitest';
import {
  mediaDeletionAdmissionSchema,
  mediaDeletionStatesSchema,
} from './media-deletion-rpc';

const row = {
  path: 'merchant/image.webp',
  state: 'pending',
  object_id: '36690000-0000-4000-8000-000000000002',
};
describe('media deletion RPC response contracts', () => {
  it('accepts bounded admissions and rejects invalid identities, states, and paths', () => {
    expect(mediaDeletionAdmissionSchema.safeParse([row]).success).toBe(true);
    for (const invalid of [
      { ...row, path: '' },
      { ...row, path: 'x'.repeat(1025) },
      { ...row, state: 'active' },
      { ...row, object_id: 'bad' },
    ]) {
      expect(mediaDeletionAdmissionSchema.safeParse([invalid]).success).toBe(
        false
      );
    }
    expect(mediaDeletionAdmissionSchema.safeParse([]).success).toBe(false);
    expect(
      mediaDeletionAdmissionSchema.safeParse(Array(101).fill(row)).success
    ).toBe(false);
  });
  it('accepts empty or valid states and rejects malformed and oversized responses', () => {
    expect(mediaDeletionStatesSchema.safeParse([]).success).toBe(true);
    expect(
      mediaDeletionStatesSchema.safeParse([
        { path: row.path, state: 'deleted' },
      ]).success
    ).toBe(true);
    expect(
      mediaDeletionStatesSchema.safeParse([{ path: row.path, state: 'active' }])
        .success
    ).toBe(false);
    expect(
      mediaDeletionStatesSchema.safeParse([{ path: 3, state: 'pending' }])
        .success
    ).toBe(false);
    expect(
      mediaDeletionStatesSchema.safeParse(Array(101).fill(row)).success
    ).toBe(false);
  });
});
