import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { OxygenWorkflowController } from '@/services/oxygen/workflow';
import { useOxygenWorkflow } from './use-oxygen-workflow';

it('disposes old scope and refreshes once on foreground with no timers', async () => {
  let onChange: (state: string) => void = () => {};
  const remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      onChange = listener as typeof onChange;
      return { remove };
    });
  const instances: ReturnType<typeof make>[] = [];
  function make() {
    return {
      initialize: jest.fn(),
      dispose: jest.fn(),
      refresh: jest.fn(),
      subscribe: jest.fn(() => jest.fn()),
      getState: () => ({ snapshot: null, busy: false, error: null }),
      execute: jest.fn(),
      recover: jest.fn(),
    };
  }
  const factory = () => {
    const instance = make();
    instances.push(instance);
    return instance as unknown as OxygenWorkflowController;
  };
  const hostedHandlesForeground = { current: false };
  const hook = renderHook(
    ({ id }: { id: string }) =>
      useOxygenWorkflow(id, factory, hostedHandlesForeground),
    {
      initialProps: { id: 'one' },
    }
  );
  await act(async () => {
    onChange('background');
    onChange('active');
    onChange('active');
  });
  expect(instances[0].refresh).toHaveBeenCalledTimes(1);
  hostedHandlesForeground.current = true;
  await act(async () => {
    onChange('background');
    onChange('active');
  });
  expect(instances[0].refresh).toHaveBeenCalledTimes(1);
  hostedHandlesForeground.current = false;
  await act(async () => {
    onChange('background');
    onChange('active');
  });
  expect(instances[0].refresh).toHaveBeenCalledTimes(2);
  hook.rerender({ id: 'two' });
  expect(instances[0].dispose).toHaveBeenCalledTimes(1);
  hook.unmount();
  expect(instances[1].dispose).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(2);
  jest.restoreAllMocks();
});
