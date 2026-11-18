import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { mockEditor, mockRun, mockSetLink } = vi.hoisted(() => {
  const mockRun = vi.fn();
  const mockSetLink = vi.fn();
  const chain = {
    focus: vi.fn(),
    setLink: mockSetLink,
    unsetLink: vi.fn(),
    run: mockRun,
  };
  chain.focus.mockReturnValue(chain);
  mockSetLink.mockReturnValue(chain);
  const mockEditor = {
    chain: () => chain,
    getAttributes: vi.fn(() => ({})),
    isActive: vi.fn(() => false),
  };
  return { mockEditor, mockRun, mockSetLink };
});

vi.mock('novel', () => ({ useEditor: () => ({ editor: mockEditor }) }));
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { LinkSelector } from './link-selector';

describe('LinkSelector Enter to set link', () => {
  it('does not set the link or close when Enter confirms IME composition', () => {
    const onOpenChange = vi.fn();
    render(<LinkSelector open onOpenChange={onOpenChange} />);
    const input = screen.getByPlaceholderText('Paste a link');
    fireEvent.change(input, { target: { value: 'https://example.com' } });

    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
      false
    );
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(
      false
    );
    expect(mockSetLink).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSetLink).toHaveBeenCalledWith({ href: 'https://example.com' });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
