import { describe, expect, it } from 'vitest';
import { provisioningClientFixture } from './provisioning-client.fixture';

describe('provisioningClientFixture', () => {
  it('stays inside synthetic ranges', () => {
    expect(provisioningClientFixture.command.bvn).toBe('00000000000');
    expect(provisioningClientFixture.command.email).toBe(
      'synthetic@example.test'
    );
    expect(
      provisioningClientFixture.configuration.fingerprintKey.length
    ).toBeGreaterThanOrEqual(32);
  });

  it('models a first-time customer creation', () => {
    expect(provisioningClientFixture.command.kind).toBe('create_customer');
    expect(provisioningClientFixture.accepted.data.new_customer).toBe(true);
  });
});
