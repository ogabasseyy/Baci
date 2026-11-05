import assert from 'node:assert/strict';
import test from 'node:test';
import { publishFollowupAfterPending } from './handback.mjs';

test('does not publish follow-up when Chatwoot leaves handback open', async () => {
  let followupPublished = false;

  await assert.rejects(
    publishFollowupAfterPending({
      readConversation: async () => ({ status: 'open' }),
      publishFollowup: async () => {
        followupPublished = true;
      },
    }),
    /Expected pending handback, received open/
  );

  assert.equal(followupPublished, false);
});

test('publishes follow-up after Chatwoot persists pending handback', async () => {
  let followupPublished = false;

  await publishFollowupAfterPending({
    readConversation: async () => ({ status: 'pending' }),
    publishFollowup: async () => {
      followupPublished = true;
    },
  });

  assert.equal(followupPublished, true);
});
