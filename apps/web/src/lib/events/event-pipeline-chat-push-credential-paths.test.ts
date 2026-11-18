import { describe, expect, it } from 'vitest';
import { eventPipelineChatPushCredentialPaths } from './event-pipeline-chat-push-credential-paths';

const ENV_PATH = 'apps/web/src/env.ts';
const EXPO_CLIENT = 'apps/web/src/lib/expo-client.ts';
const PUSH_STORE = 'apps/web/src/lib/chatwoot/chat-event-push-store.ts';
const PUSH = 'apps/web/src/lib/chatwoot/chat-event-push.ts';
const ROUTE = 'apps/web/src/app/api/webhooks/chatwoot/[webhookKey]/route.ts';

describe('eventPipelineChatPushCredentialPaths', () => {
  it('pins the reviewed chat push credential graph', () => {
    expect(eventPipelineChatPushCredentialPaths).toEqual([
      [PUSH_STORE, EXPO_CLIENT, ENV_PATH],
      [PUSH, PUSH_STORE, EXPO_CLIENT, ENV_PATH],
      [ROUTE, PUSH, PUSH_STORE, EXPO_CLIENT, ENV_PATH],
    ]);
  });

  it('never reaches a service-role or admin client', () => {
    for (const path of eventPipelineChatPushCredentialPaths) {
      expect(path.join(' ')).not.toMatch(/supabase\/(admin|service)/);
      expect(path[path.length - 1]).toBe(ENV_PATH);
    }
  });
});
