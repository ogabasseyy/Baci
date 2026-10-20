import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useActivationFocusRestore } from './use-activation-focus-restore';

function Harness({ swapKind }: { swapKind: 'anchor' | 'button' }) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [activated, setActivated] = useState(false);
  const { capture } = useActivationFocusRestore(containerRef, activated);

  return (
    <section ref={containerRef}>
      <button
        onClick={() => {
          // Mirrors the production sequence: capture synchronously, then the
          // activating state update remounts the subtree via the key change.
          capture();
          setActivated(true);
        }}
        type="button"
      >
        Activate
      </button>
      {/* key change = full remount, modelling the static→interactive swap */}
      <div key={activated ? 'interactive' : 'static'}>
        {swapKind === 'anchor' ? (
          <a href="/smartphones/tecno-spark-40-pro">Tecno Spark 40 Pro</a>
        ) : (
          <button type="button">Load More Products</button>
        )}
      </div>
    </section>
  );
}

describe('useActivationFocusRestore', () => {
  it('restores focus to the equivalent link after the subtree remounts', () => {
    render(<Harness swapKind="anchor" />);
    const link = screen.getByRole('link', { name: 'Tecno Spark 40 Pro' });

    link.focus();
    expect(document.activeElement).toBe(link);

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    // Behavioral guarantee: focus survives the remount onto the equivalent
    // link (matched by href), instead of dropping to <body>.
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: 'Tecno Spark 40 Pro' })
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('restores focus to the equivalent button by label after the remount', () => {
    render(<Harness swapKind="button" />);
    const loadMore = screen.getByRole('button', { name: 'Load More Products' });

    loadMore.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Load More Products' })
    );
  });

  it('does nothing when focus is outside the container at capture time', () => {
    render(<Harness swapKind="anchor" />);
    // Focus lives on <body>; capture must be a no-op and not steal focus.
    (document.activeElement as HTMLElement | null)?.blur?.();

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(document.activeElement).toBe(document.body);
  });

  it('skips restoring a stale target when focus moves elsewhere before activation commits', () => {
    function DeferredHarness() {
      const containerRef = useRef<HTMLElement | null>(null);
      const [activated, setActivated] = useState(false);
      const { capture } = useActivationFocusRestore(containerRef, activated);

      return (
        <div>
          <input aria-label="Search store" type="search" />
          <section ref={containerRef}>
            <button onClick={() => capture()} type="button">
              Capture
            </button>
            <button onClick={() => setActivated(true)} type="button">
              Commit
            </button>
            <div key={activated ? 'interactive' : 'static'}>
              <a href="/smartphones/tecno-spark-40-pro">Tecno Spark 40 Pro</a>
            </div>
          </section>
        </div>
      );
    }

    render(<DeferredHarness />);
    const link = screen.getByRole('link', { name: 'Tecno Spark 40 Pro' });
    const searchInput = screen.getByRole('searchbox', { name: 'Search store' });

    link.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    // User moves focus to the search box while the transition is still pending.
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

    expect(document.activeElement).toBe(searchInput);
  });
});

