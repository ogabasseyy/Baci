import { getRandomBytesAsync } from 'expo-crypto';
import { createNativePreviewController } from './native-preview-controller';

export interface NativePreviewInput {
  identityKey: string;
  draftRevision: number;
  config: unknown;
  merchant: {
    id: string;
    slug: string;
    basePath?: string;
    storefrontOrigin?: string;
  };
  isIdentityCurrent: () => boolean;
}
export interface NativePreviewSession {
  nonce: string;
  previousNonce?: string;
  instanceId: number;
  epoch: number;
  identityKey: string;
  controller: ReturnType<typeof createNativePreviewController>;
}
export function sessionIsCurrent(
  active: NativePreviewSession | null,
  input: NativePreviewInput,
  instanceId: number,
  nonce: string
): boolean {
  return Boolean(
    active &&
      active.instanceId === instanceId &&
      active.nonce === nonce &&
      active.identityKey === input.identityKey &&
      input.isIdentityCurrent()
  );
}
export async function createNativePreviewSession(
  identityKey: string,
  epoch: number,
  instanceId: number
): Promise<NativePreviewSession> {
  const bytes = await getRandomBytesAsync(16);
  if (bytes.length !== 16) throw new Error('Invalid random session bytes');
  const nonce = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return {
    nonce,
    instanceId,
    epoch,
    identityKey,
    controller: createNativePreviewController(nonce),
  };
}

export async function rotateNativePreviewSession(
  previous: NativePreviewSession,
  isCurrent: () => boolean
): Promise<NativePreviewSession | null> {
  const next = await createNativePreviewSession(
    previous.identityKey,
    previous.epoch,
    previous.instanceId
  );
  if (!isCurrent()) return null;
  if (next.nonce === previous.nonce) throw new Error('Repeated session nonce');
  next.previousNonce = previous.nonce;
  return next;
}

export function bindNativePreviewSession(
  active: { current: NativePreviewSession | null },
  input: { current: NativePreviewInput }
) {
  return (instanceId: number, nonce: string) =>
    sessionIsCurrent(active.current, input.current, instanceId, nonce);
}
