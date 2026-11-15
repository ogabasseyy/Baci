import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createAgent } from '@ui-sdk/react/agent';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OwnershipCompare } from './ownership-compare';
import { OwnershipDialog } from './ownership-dialog';

vi.mock('next/link', () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean;
  }) => <a {...props} />,
}));

beforeAll(() => {
  CSS.supports = () => false;
  document.head.append(
    Object.assign(document.createElement('style'), {
      textContent: '[popover] { display: block !important }',
    })
  );
  HTMLElement.prototype.showPopover = () => {};
  HTMLElement.prototype.hidePopover = () => {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.checkVisibility = () => true;
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const agent = createAgent();

describe('ownership comparison', () => {
  it('does not render SDK dialog content until the customer requests it', async () => {
    render(<OwnershipCompare basePath="/ogabassey" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Compare ways to own' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Find your way to your next device.',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      screen.getByRole('link', { name: 'Browse devices ↗' })
    ).toHaveAttribute('href', '/ogabassey/products');
    expect(
      screen.getByRole('link', { name: 'Ask about payment plans ↗' })
    ).toHaveAttribute('href', '/ogabassey/contact');
    expect(
      screen.getByRole('link', { name: 'See your wallet options ↗' })
    ).toHaveAttribute('href', '/ogabassey/wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Back to exploring' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it('exposes a named SDK dialog that an agent can dismiss', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <OwnershipDialog
          basePath=""
          open={open}
          onOpenChange={setOpen}
          finalFocus={() => null}
        />
      );
    }
    render(<Harness />);
    await screen.findByRole('dialog');
    const entries = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== 'more');
    expect(
      entries.some(
        (entry) => entry.label === 'Find your way to your next device.'
      )
    ).toBe(true);
    for (const entry of entries) expect(entry.label).toBeTruthy();
    await act(async () => {
      const result = await agent.act({
        steps: [
          {
            ref: 'Find your way to your next device.',
            action: 'press',
            args: ['Close comparison'],
          },
        ],
      });
      expect(result.ok).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });
});
