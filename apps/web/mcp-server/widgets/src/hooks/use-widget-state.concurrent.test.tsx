import { act, render, screen } from '@testing-library/react';
import { startTransition, Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const source = vi.hoisted(() => ({ state: { count: 0 } }));
vi.mock('./use-openai-global', () => ({ useOpenAiGlobal: () => source.state }));
import { resetWidgetHost } from '../widget-host';
import { useWidgetState } from './use-widget-state';
afterEach(() => {
  resetWidgetHost();
  delete window.openai;
});
it('does not expose state from an uncommitted suspended render to actions', async () => {
  source.state = { count: 0 };
  const persist = vi.fn();
  window.openai = { setWidgetState: persist };
  let increment = () => {};
  const pending = new Promise<void>(() => {});
  function Blocker() {
    throw pending;
  }
  function Widget({ suspended }: { suspended: boolean }) {
    const [state, setState] = useWidgetState({ count: 0 });
    if (!suspended)
      increment = () => setState((previous) => ({ count: previous.count + 1 }));
    return (
      <>
        <p>Count {state.count}</p>
        {suspended && <Blocker />}
      </>
    );
  }
  const view = render(
    <Suspense fallback={<p>Loading</p>}>
      <Widget suspended={false} />
    </Suspense>,
  );
  await act(async () => {
    source.state = { count: 10 };
    startTransition(() =>
      view.rerender(
        <Suspense fallback={<p>Loading</p>}>
          <Widget suspended />
        </Suspense>,
      ),
    );
  });
  expect(screen.getByText('Count 0')).toBeInTheDocument();
  act(() => increment());
  expect(persist).toHaveBeenCalledWith({ count: 1 });
});
