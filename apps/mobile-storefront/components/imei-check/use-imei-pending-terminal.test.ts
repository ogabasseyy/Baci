import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useImeiPendingTerminal } from './use-imei-pending-terminal';

type Terminal = Parameters<typeof useImeiPendingTerminal>[0];

const failed: Terminal = {
  kind: 'error',
  error: 'Lookup failed',
  tier: 'blacklist',
  scopeKey: 'scope',
};

describe('useImeiPendingTerminal', () => {
  it('hands a final answer to the handler once', () => {
    const onTerminal = jest.fn();
    const { rerender } = renderHook(
      ({ terminal }: { terminal: Terminal }) =>
        useImeiPendingTerminal(terminal, onTerminal),
      { initialProps: { terminal: failed } }
    );
    rerender({ terminal: failed });

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith(failed);
  });

  it('does nothing while no answer has arrived', () => {
    const onTerminal = jest.fn();
    renderHook(() => useImeiPendingTerminal(null, onTerminal));

    expect(onTerminal).not.toHaveBeenCalled();
  });
});
