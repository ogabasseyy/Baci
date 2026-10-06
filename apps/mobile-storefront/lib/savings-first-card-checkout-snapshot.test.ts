import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearRetiredSavingsFirstCardCheckoutSnapshot,
  readSavingsFirstCardCheckoutSnapshot,
  recordSavingsFirstCardCheckoutState,
  saveSavingsFirstCardCheckoutSnapshot,
} from './savings-first-card-checkout-snapshot';

jest.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-4000-8000-000000000099',
}));

jest.mock('@/lib/storefront-storage-prefix', () => ({
  getStorefrontStoragePrefix: () => 'test:',
}));

const goalId = '00000000-0000-4000-8000-000000000003';
const scope = { userId: 'user-a', merchantId: 'merchant-a', goalId };
const input = {
  goalId,
  amountKobo: 12500,
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
};
const state = {
  intentId: '00000000-0000-4000-8000-000000000001',
  goalId,
  amountKobo: 12500,
  currency: 'NGN' as const,
  status: 'ready' as const,
  authorizationUrl: 'https://checkout.paystack.com/access123',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('persists the immutable request under user, merchant, and goal scope before intent assignment', async () => {
  const saved = await saveSavingsFirstCardCheckoutSnapshot(scope, input);
  expect(saved).toMatchObject({ ...input, intentId: null });
  expect(await readSavingsFirstCardCheckoutSnapshot(scope)).toEqual(saved);
  expect(
    await readSavingsFirstCardCheckoutSnapshot({
      ...scope,
      userId: 'user-b',
    })
  ).toBeNull();
  expect(
    await readSavingsFirstCardCheckoutSnapshot({
      ...scope,
      merchantId: 'merchant-b',
    })
  ).toBeNull();
  expect(
    await readSavingsFirstCardCheckoutSnapshot({
      ...scope,
      goalId: 'goal-b',
    })
  ).toBeNull();
});

it('records the server intent before the authorization URL can be used', async () => {
  const saved = await saveSavingsFirstCardCheckoutSnapshot(scope, input);
  const updated = await recordSavingsFirstCardCheckoutState(
    scope,
    saved.idempotencyKey,
    state
  );
  expect(updated).toMatchObject({
    intentId: state.intentId,
    status: 'ready',
    authorizationUrl: state.authorizationUrl,
  });
  expect(await readSavingsFirstCardCheckoutSnapshot(scope)).toEqual(updated);
});

it('refuses to replace an unresolved request with a different amount', async () => {
  await saveSavingsFirstCardCheckoutSnapshot(scope, input);
  await expect(
    saveSavingsFirstCardCheckoutSnapshot(scope, {
      ...input,
      amountKobo: 12501,
    })
  ).rejects.toThrow(/unresolved/);
});

it('keeps a failed storage write latched against a new idempotency key', async () => {
  const uncertainScope = { ...scope, userId: 'user-uncertain' };
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockRejectedValueOnce(new Error('write outcome unknown'));
  await expect(
    saveSavingsFirstCardCheckoutSnapshot(uncertainScope, input)
  ).rejects.toThrow('write outcome unknown');
  await expect(
    saveSavingsFirstCardCheckoutSnapshot(uncertainScope, {
      ...input,
      amountKobo: 20000,
    })
  ).rejects.toThrow(/uncertain/);
});

it('keeps a failed readback latched against a new idempotency key', async () => {
  const uncertainScope = { ...scope, userId: 'user-readback-uncertain' };
  jest
    .spyOn(AsyncStorage, 'getItem')
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('readback outcome unknown'));
  await expect(
    saveSavingsFirstCardCheckoutSnapshot(uncertainScope, input)
  ).rejects.toThrow('readback outcome unknown');
  await expect(
    saveSavingsFirstCardCheckoutSnapshot(uncertainScope, {
      ...input,
      amountKobo: 20000,
    })
  ).rejects.toThrow(/uncertain/);
});

it('removes a stale authorization URL when canonical state no longer includes it', async () => {
  const saved = await saveSavingsFirstCardCheckoutSnapshot(scope, input);
  const ready = await recordSavingsFirstCardCheckoutState(
    scope,
    saved.idempotencyKey,
    state
  );
  const pending = await recordSavingsFirstCardCheckoutState(
    scope,
    saved.idempotencyKey,
    {
      ...state,
      status: 'pending',
      authorizationUrl: undefined,
    }
  );
  expect(ready.authorizationUrl).toBe(state.authorizationUrl);
  expect(pending.authorizationUrl).toBeUndefined();
});

it('clears a retired snapshot only when both its saved key and intent match', async () => {
  const saved = await saveSavingsFirstCardCheckoutSnapshot(scope, input);
  const recorded = await recordSavingsFirstCardCheckoutState(
    scope,
    saved.idempotencyKey,
    state
  );

  await expect(
    clearRetiredSavingsFirstCardCheckoutSnapshot(
      scope,
      recorded.idempotencyKey,
      '00000000-0000-4000-8000-000000000099'
    )
  ).rejects.toThrow(/matching retired checkout/);
  expect(await readSavingsFirstCardCheckoutSnapshot(scope)).toEqual(recorded);

  await clearRetiredSavingsFirstCardCheckoutSnapshot(
    scope,
    recorded.idempotencyKey,
    state.intentId
  );
  expect(await readSavingsFirstCardCheckoutSnapshot(scope)).toBeNull();
});

it('blocks new requests when retired snapshot removal has an uncertain outcome', async () => {
  const saved = await saveSavingsFirstCardCheckoutSnapshot(scope, input);
  const recorded = await recordSavingsFirstCardCheckoutState(
    scope,
    saved.idempotencyKey,
    state
  );
  jest
    .spyOn(AsyncStorage, 'removeItem')
    .mockRejectedValueOnce(new Error('remove outcome unknown'));

  await expect(
    clearRetiredSavingsFirstCardCheckoutSnapshot(
      scope,
      recorded.idempotencyKey,
      state.intentId
    )
  ).rejects.toThrow('remove outcome unknown');
  await expect(
    saveSavingsFirstCardCheckoutSnapshot(scope, input)
  ).rejects.toThrow(/uncertain/);
  await expect(readSavingsFirstCardCheckoutSnapshot(scope)).rejects.toThrow(
    /uncertain/
  );
});
