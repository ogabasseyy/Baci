import { beforeEach, describe, expect, it } from '@jest/globals';
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
