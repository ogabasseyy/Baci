import { beforeEach, describe, expect, it } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { savingsNotificationCapability } from './savings-notification-capability';

const scope = {
  apiOrigin: 'https://api.baci.test',
  merchantId: 'merchant-a',
  userId: 'user-a',
};

describe('savingsNotificationCapability', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('remains unavailable until an authenticated inbox response establishes it', async () => {
    await expect(
      savingsNotificationCapability.isAvailable(scope)
    ).resolves.toBe(false);

    await savingsNotificationCapability.markAvailable(scope);

    await expect(
      savingsNotificationCapability.isAvailable(scope)
    ).resolves.toBe(true);
  });

  it('does not share capability between API origins or customer accounts', async () => {
    await savingsNotificationCapability.markAvailable(scope);

    await expect(
      savingsNotificationCapability.isAvailable({
        ...scope,
        apiOrigin: 'https://staging-api.baci.test',
      })
    ).resolves.toBe(false);
    await expect(
      savingsNotificationCapability.isAvailable({ ...scope, userId: 'user-b' })
    ).resolves.toBe(false);
  });

  it('clears only the current scoped capability for a delivery rollback', async () => {
    const otherScope = { ...scope, userId: 'user-b' };
    await savingsNotificationCapability.markAvailable(scope);
    await savingsNotificationCapability.markAvailable(otherScope);

    await savingsNotificationCapability.clearAvailable(scope);

    await expect(
      savingsNotificationCapability.isAvailable(scope)
    ).resolves.toBe(false);
    await expect(
      savingsNotificationCapability.isAvailable(otherScope)
    ).resolves.toBe(true);
  });
});
