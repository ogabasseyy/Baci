import { act, renderHook } from '@testing-library/react-native';
import { useInitialContributionOperation } from './use-initial-contribution-operation';

// With PiggyVest off nothing is recorded until a contribution starts: no key
// and no rail, exactly as before the rail was stored with the key.
describe('server keeps PiggyVest off', () => {
  it('starts with no key and no rail', () => {
    const { result } = renderHook(() => useInitialContributionOperation());
    expect(result.current.initialContributionIdempotencyKey).toBeNull();
    expect(result.current.initialContributionRail).toBeNull();
  });

  it('keeps a legacy id on the legacy rail', () => {
    const { result } = renderHook(() => useInitialContributionOperation());
    act(() => {
      result.current.setInitialContributionIdempotencyKey('op-1');
      result.current.setInitialContributionRail('op-1', 'legacy');
    });
    expect(result.current.initialContributionRail).toBe('legacy');
  });
});
