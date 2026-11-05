import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyConversationHandoff } from './conversation-handoff.mjs';

const seed = {
  account_id: 7,
  conversation_id: 12,
  human_token: 'synthetic-human-token',
};

function mockHarness({
  handoffStatus = 'open',
  humanSender = 'user',
  botSender = 'agentbot',
} = {}) {
  let conversationReads = 0;
  let status = 'pending';
  let triggerPublished = false;
  let followupPublished = false;

  const api = (path, _token, options = {}) => {
    if (path.endsWith('/toggle_status')) {
      status = options.body.status;
      return {};
    }
    if (path.endsWith('/messages') && options.method === 'POST') {
      return { sender: { type: humanSender } };
    }
    if (path.endsWith('/messages')) {
      return {
        payload: [
          {
            content: 'Synthetic bot: handing this to a human operator.',
            sender: { type: botSender },
          },
          {
            content: 'Synthetic bot: I can help with that.',
            sender: { type: botSender },
          },
        ],
      };
    }
    if (path.endsWith('/conversations/12')) {
      conversationReads += 1;
      if (conversationReads === 1) return { status: 'pending' };
      if (conversationReads === 2)
        return { status: handoffStatus, meta: { assignee: null } };
      return { status, meta: { assignee: null } };
    }
    throw new Error(`Unexpected Chatwoot API request: ${path}`);
  };

  const waitFor = async (predicate, label) => {
    if (!(await predicate())) throw new Error(`Timed out waiting for ${label}`);
  };

  const run = () =>
    verifyConversationHandoff({
      seed,
      api,
      waitFor,
      publishTriggerMarker: () => {
        triggerPublished = true;
      },
      publishFollowupMarker: () => {
        followupPublished = true;
      },
      events: [{ event: 'message_created' }],
    });

  return {
    run,
    wasTriggerPublished: () => triggerPublished,
    wasFollowupPublished: () => followupPublished,
  };
}

test('fails handoff when Chatwoot does not open the conversation', async () => {
  const harness = mockHarness({ handoffStatus: 'pending' });

  await assert.rejects(harness.run(), /AgentBot handoff to the open queue/);

  assert.equal(harness.wasTriggerPublished(), true);
  assert.equal(harness.wasFollowupPublished(), false);
});

test('fails when Chatwoot attributes the human reply to the bot', async () => {
  const harness = mockHarness({ humanSender: 'agentbot' });

  await assert.rejects(harness.run(), /Human reply was not attributed to User/);

  assert.equal(harness.wasFollowupPublished(), false);
});

test('fails when the handoff reply is not attributed to the AgentBot', async () => {
  const harness = mockHarness({ botSender: 'user' });

  await assert.rejects(harness.run(), /AgentBot message:/);

  assert.equal(harness.wasFollowupPublished(), false);
});

test('accepts an open queue handoff, human reply, pending handback and bot follow-up', async () => {
  const harness = mockHarness();

  await harness.run();

  assert.equal(harness.wasTriggerPublished(), true);
  assert.equal(harness.wasFollowupPublished(), true);
});
