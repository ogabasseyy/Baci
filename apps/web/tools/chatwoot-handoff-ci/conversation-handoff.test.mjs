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
  takeoverReply = false,
  takeoverWebhookDelayMs = 0,
  takeoverWebhook = true,
  unrelatedTakeoverWebhook = false,
  takeoverWebhookConversationId = seed.conversation_id,
  statusDuringTakeover = 'open',
  lateBotReplyDelayMs = 0,
  silenceWindowMs = 30,
  silencePollIntervalMs = 5,
} = {}) {
  let currentTime = 0;
  const scheduled = [];
  let conversationReads = 0;
  let messageReads = 0;
  let status = 'pending';
  let triggerPublished = false;
  let followupPublished = false;
  let takeoverActive = false;
  const messages = [
    {
      id: 1,
      content: 'Synthetic bot: handing this to a human operator.',
      sender: { type: botSender },
    },
    {
      id: 2,
      content: 'Synthetic bot: I can help with that.',
      sender: { type: botSender },
    },
  ];
  const events = [{ event: 'message_created' }];
  const takeoverEvent = {
    event: 'message_created',
    id: 3,
    message_type: 'incoming',
    content:
      'Synthetic customer: I have another question for the human operator.',
    conversation: { id: takeoverWebhookConversationId },
  };

  const api = (path, _token, options = {}) => {
    if (path.endsWith('/toggle_status')) {
      status = options.body.status;
      return {};
    }
    if (path.endsWith('/messages') && options.method === 'POST') {
      takeoverActive = false;
      return { sender: { type: humanSender } };
    }
    if (path.endsWith('/messages')) {
      messageReads += 1;
      return { payload: [...messages] };
    }
    if (path.endsWith('/conversations/12')) {
      conversationReads += 1;
      if (conversationReads === 1) return { status: 'pending' };
      if (conversationReads === 2) {
        status = handoffStatus;
        return { status: handoffStatus, meta: { assignee: null } };
      }
      if (takeoverActive) status = statusDuringTakeover;
      return { status, meta: { assignee: null } };
    }
    throw new Error(`Unexpected Chatwoot API request: ${path}`);
  };

  const schedule = (callback, delayMs) => {
    scheduled.push({ at: currentTime + delayMs, callback });
  };
  const sleep = (durationMs) => {
    currentTime += durationMs;
    const due = scheduled.filter((task) => task.at <= currentTime);
    for (const task of due) {
      scheduled.splice(scheduled.indexOf(task), 1);
      task.callback();
    }
  };
  const waitFor = async (predicate, label) => {
    const end = currentTime + 40;
    do {
      if (await predicate()) return;
      if (currentTime >= end) break;
      await sleep(5);
    } while (currentTime <= end);
    throw new Error(`Timed out waiting for ${label}`);
  };

  const run = () =>
    verifyConversationHandoff({
      seed,
      api,
      waitFor,
      publishTriggerMarker: () => {
        triggerPublished = true;
      },
      publishTakeoverMarker: () => {
        takeoverActive = true;
        messages.push({
          id: 3,
          content: takeoverEvent.content,
          sender: { type: 'contact' },
        });
        if (takeoverReply) {
          messages.push({
            id: 4,
            content: 'Unexpected AgentBot reply during takeover.',
            sender: { type: 'agentbot' },
          });
        }
        if (lateBotReplyDelayMs > 0) {
          schedule(() => {
            messages.push({
              id: 5,
              content: 'Late AgentBot reply during takeover.',
              sender: { type: 'agentbot' },
            });
          }, lateBotReplyDelayMs);
        }
        if (!takeoverWebhook) return;
        const event = unrelatedTakeoverWebhook
          ? { ...takeoverEvent, content: 'Different synthetic message.' }
          : takeoverEvent;
        if (takeoverWebhookDelayMs > 0) {
          schedule(() => events.push(event), takeoverWebhookDelayMs);
        } else {
          events.push(event);
        }
      },
      publishFollowupMarker: () => {
        followupPublished = true;
      },
      events,
      silenceWindowMs,
      silencePollIntervalMs,
      now: () => currentTime,
      sleep,
    });

  return {
    run,
    wasTriggerPublished: () => triggerPublished,
    wasFollowupPublished: () => followupPublished,
    messageReadCount: () => messageReads,
    elapsedMs: () => currentTime,
    hasTakeoverMessage: () =>
      messages.some(
        (message) =>
          message.content ===
          'Synthetic customer: I have another question for the human operator.'
      ),
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

test('fails when the AgentBot replies during human takeover after polling messages', async () => {
  const harness = mockHarness({ takeoverReply: true });

  await assert.rejects(
    harness.run(),
    /AgentBot replied while a human had taken over/
  );

  assert.ok(
    harness.messageReadCount() >= 3,
    'negative check should query message history'
  );
  assert.equal(harness.wasFollowupPublished(), false);
});

test('fails if the takeover message is in history but its webhook is delayed', async () => {
  const harness = mockHarness({ takeoverWebhookDelayMs: 100 });

  await assert.rejects(harness.run(), /takeover customer message webhook/);

  assert.equal(harness.hasTakeoverMessage(), true);
  assert.equal(harness.wasFollowupPublished(), false);
});

test('fails if no matching takeover webhook reaches the responder', async () => {
  const harness = mockHarness({ takeoverWebhook: false });

  await assert.rejects(harness.run(), /takeover customer message webhook/);
  assert.equal(harness.wasFollowupPublished(), false);
});

test('does not accept an unrelated incoming webhook as the takeover event', async () => {
  const harness = mockHarness({ unrelatedTakeoverWebhook: true });

  await assert.rejects(harness.run(), /takeover customer message webhook/);
  assert.equal(harness.wasFollowupPublished(), false);
});

test('does not accept matching takeover content for a different conversation', async () => {
  const harness = mockHarness({ takeoverWebhookConversationId: 999 });

  await assert.rejects(harness.run(), /takeover customer message webhook/);
  assert.equal(harness.wasFollowupPublished(), false);
});

test('fails if the conversation leaves open status during the silence window', async () => {
  const harness = mockHarness({ statusDuringTakeover: 'pending' });

  await assert.rejects(
    harness.run(),
    /Expected conversation to remain open during human takeover, received pending/
  );
  assert.equal(harness.wasFollowupPublished(), false);
});

test('checks message history after the final polling sleep crosses the deadline', async () => {
  const harness = mockHarness({
    lateBotReplyDelayMs: 15,
    silenceWindowMs: 10,
    silencePollIntervalMs: 30,
  });

  await assert.rejects(
    harness.run(),
    /AgentBot replied while a human had taken over/
  );
  assert.equal(harness.wasFollowupPublished(), false);
});

test('accepts an open queue handoff, human reply, pending handback and bot follow-up', async () => {
  const harness = mockHarness();

  await harness.run();

  assert.equal(harness.wasTriggerPublished(), true);
  assert.equal(harness.wasFollowupPublished(), true);
  assert.ok(
    harness.messageReadCount() >= 4,
    'silence check should poll message history'
  );
  assert.ok(
    harness.elapsedMs() >= 30,
    'silence check should wait for its bounded window'
  );
});
