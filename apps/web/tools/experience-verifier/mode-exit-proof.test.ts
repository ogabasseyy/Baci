import { expect, it } from 'vitest';
import { createPrivateHome } from '@/lib/website-builder/create-private-home';
import { createModeExitProof } from './mode-exit-proof';

const id = '11111111-1111-4111-8111-111111111111';
const effectDigest = 'a'.repeat(64);
function summary(action: string) {
  return {
    namespace: 'baci.full-code.lifecycle.v1',
    action,
    merchant: id,
    payload: {
      expectedDraftVersion: 1,
      expectedPublishedVersion: 2,
      targetLegacyRevision: id,
    },
    website: id,
    draft: 1,
    published: 2,
    template: 'puck',
    legacy: { config: createPrivateHome('Synthetic Store'), published: true },
  };
}

it.each([
  'draft-only',
  'restore-legacy',
  'unpublish-legacy-draft',
])('verifies %s against its own authenticated legacy effect', async (action) => {
  await expect(
    createModeExitProof({
      action,
      merchantId: id,
      effectDigest,
      summary: summary(action),
    })
  ).resolves.toMatchObject({
    effectDigest,
    evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    routes: ['/'],
  });
});

it('rejects a changed legacy revision or an incompatible restore target', async () => {
  const action = 'restore-legacy';
  const target = summary(action);
  const input = { action, merchantId: id, effectDigest };
  await expect(
    createModeExitProof({ ...input, summary: { ...target, draft: 2 } })
  ).rejects.toThrow('APPROVAL_MISMATCH');
  await expect(
    createModeExitProof({
      ...input,
      summary: { ...target, legacy: { ...target.legacy, published: false } },
    })
  ).rejects.toThrow('INCOMPATIBLE_LEGACY');
});
