import { describe, expect, it } from 'vitest';
import {
  client,
  floors,
  refused,
} from './primary-wallet-capability.test-support';

describe('primary wallet capability test support', () => {
  it('sets both platform floors', () => {
    expect(floors.PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS).toBe('120');
    expect(floors.PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID).toBe('700');
  });

  it('sets client headers only when given', () => {
    const none = client();
    expect(none.get('X-Baci-Client-Platform')).toBeNull();
    expect(none.get('X-Baci-Client-Build')).toBeNull();
    const both = client('ios', '130');
    expect(both.get('X-Baci-Client-Platform')).toBe('ios');
    expect(both.get('X-Baci-Client-Build')).toBe('130');
    expect(client('ios').get('X-Baci-Client-Build')).toBeNull();
  });

  it('builds a refusal with the default code', () => {
    expect(refused('client_build')).toEqual({
      enabled: false,
      status: 'not_ready',
      code: 'PRIMARY_CARD_NOT_READY',
      reason: 'client_build',
    });
  });
});
