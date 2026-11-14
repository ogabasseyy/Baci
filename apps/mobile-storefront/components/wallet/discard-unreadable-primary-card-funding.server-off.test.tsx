import { afterEach, describe, expect, it } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { discardUnreadablePrimaryCardFunding } from './discard-unreadable-primary-card-funding';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const KEY = `@baci_primary_card:${MERCHANT}:${USER}`;

afterEach(async () => {
  await AsyncStorage.clear();
});

describe('discardUnreadablePrimaryCardFunding (server off)', () => {
  it('clears an unreadable saved funding', async () => {
    await AsyncStorage.setItem(KEY, 'corrupt');
    await discardUnreadablePrimaryCardFunding(MERCHANT, USER);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('does nothing without a merchant or a signed-in user', async () => {
    await AsyncStorage.setItem(KEY, 'corrupt');
    await discardUnreadablePrimaryCardFunding(undefined, USER);
    await discardUnreadablePrimaryCardFunding(MERCHANT, undefined);
    expect(await AsyncStorage.getItem(KEY)).toBe('corrupt');
  });
});
