import { getPostHog } from './analytics-core';

// One draw per analytics session, even when the customer leaves and re-enters.
let sampledSession: { id: string; eligible: boolean } | undefined;
let transition = Promise.resolve();
let currentOwner: symbol | undefined;

export function startCheckoutReplay(): (() => void) | undefined {
  const client = getPostHog();
  if (!client) return;

  const id = client.getSessionId();
  if (sampledSession?.id !== id) {
    sampledSession = { id, eligible: Math.random() < 0.01 };
  }
  if (!sampledSession.eligible) return;

  const owner = Symbol();
  currentOwner = owner;
  transition = transition
    .then(async () => {
      if (currentOwner === owner) await client.startSessionRecording();
    })
    .catch(() => undefined);

  return () => {
    if (currentOwner !== owner) return;
    currentOwner = undefined;
    const stopping = client.stopSessionRecording().catch(() => undefined);
    // A pending native start can finish after the first stop request.
    // Serialize the final stop before a later checkout can start.
    transition = transition
      .then(async () => {
        await stopping;
        await client.stopSessionRecording();
      })
      .catch(() => undefined);
  };
}
