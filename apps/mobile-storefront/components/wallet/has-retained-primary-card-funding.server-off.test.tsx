import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasRetainedPrimaryCardFunding } from './has-retained-primary-card-funding';

// With the server keeping PiggyVest off nothing is ever saved locally, so
// purchase top-ups keep using the regular wallet.
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('hasRetainedPrimaryCardFunding (server off)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is false when no PiggyVest card funding is saved', async () => {
    await expect(hasRetainedPrimaryCardFunding(MERCHANT, USER)).resolves.toBe(
      false
    );
  });

  it('is false without a merchant or a signed-in user', async () => {
    await expect(hasRetainedPrimaryCardFunding(undefined, USER)).resolves.toBe(
      false
    );
    await expect(
      hasRetainedPrimaryCardFunding(MERCHANT, undefined)
    ).resolves.toBe(false);
  });

  it('is false for ids the card client would never save under', async () => {
    await expect(
      hasRetainedPrimaryCardFunding('merchant-1', 'user-1')
    ).resolves.toBe(false);
  });
});

describe('bugfix: corrupt saved card funding treated as nothing saved', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('reports an unreadable record instead of no funding, and keeps it', async () => {
    // Arrange: a saved record the schema can no longer read.
    const key = `@baci_primary_card:${MERCHANT}:${USER}`;
    await AsyncStorage.setItem(key, '{"not":"a funding"}');

    // Act
    const retained = await hasRetainedPrimaryCardFunding(MERCHANT, USER);

    // Assert: flagged, and still saved for the wallet's recovery path.
    expect(retained).toBe('unreadable');
    expect(await AsyncStorage.getItem(key)).not.toBeNull();
  });

  it('peeks at the same key the card client reads', async () => {
    // The card client drops a corrupt record under its own key: if the key
    // here ever drifts, this record would survive.
    const { createPrimaryWalletCardFundingClient } = jest.requireActual<
      typeof import('@/lib/primary-wallet-card')
    >('@/lib/primary-wallet-card');
    const key = `@baci_primary_card:${MERCHANT}:${USER}`;
    await AsyncStorage.setItem(key, 'corrupt');

    await createPrimaryWalletCardFundingClient().readPending({
      merchantId: MERCHANT,
      userId: USER,
    });

    expect(await AsyncStorage.getItem(key)).toBeNull();
  });
});
