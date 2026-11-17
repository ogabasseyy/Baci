// Reviewed chat-message push import chains.
//
// The chat webhook pushes through the Expo client, whose only credential is
// the Expo access-token accessor in env.ts. The push store reaches the
// database only through the HMAC-guarded wrapper functions on the anonymous
// client, so no chain here touches a service-role or admin client.
const envPath = 'apps/web/src/env.ts';
const expoClient = 'apps/web/src/lib/expo-client.ts';
const pushStore = 'apps/web/src/lib/chatwoot/chat-event-push-store.ts';
const push = 'apps/web/src/lib/chatwoot/chat-event-push.ts';
const route = 'apps/web/src/app/api/webhooks/chatwoot/[webhookKey]/route.ts';

export const eventPipelineChatPushCredentialPaths = [
  [pushStore, expoClient, envPath],
  [push, pushStore, expoClient, envPath],
  [route, push, pushStore, expoClient, envPath],
];
