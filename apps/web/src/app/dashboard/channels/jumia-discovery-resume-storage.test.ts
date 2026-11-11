import { beforeEach, describe, expect, it } from 'vitest';
import { jumiaDiscoveryResumeStorage } from './jumia-discovery-resume-storage';

describe('jumiaDiscoveryResumeStorage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('round-trips only the opaque discovery handle and client id', () => {
    jumiaDiscoveryResumeStorage.write(' client-id ', ' discovery-id ');

    expect(jumiaDiscoveryResumeStorage.read()).toEqual({
      clientId: 'client-id',
      discoveryId: 'discovery-id',
    });
  });

  it('rejects malformed storage and can clear a saved handle', () => {
    window.sessionStorage.setItem(
      'baci:jumia-discovery-resume',
      JSON.stringify({ discoveryId: 'only-id' })
    );
    expect(jumiaDiscoveryResumeStorage.read()).toBeNull();

    jumiaDiscoveryResumeStorage.write('client-id', 'discovery-id');
    jumiaDiscoveryResumeStorage.clear();
    expect(jumiaDiscoveryResumeStorage.read()).toBeNull();
  });
});
