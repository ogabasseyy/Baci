import { fireEvent, render, screen } from '@testing-library/react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { describe, expect, it, vi } from 'vitest';

const mockTiptap = vi.hoisted(() => ({
  getAttributes: vi.fn(() => ({})),
  isActive: vi.fn(() => false),
  state: { selection: { from: 7 } },
  view: {},
}));

vi.mock('../utils/tiptap', () => ({ getTiptap: () => mockTiptap }));
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    type = 'button',
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { EditorImageControls } from './editor-image-controls';

describe('EditorImageControls', () => {
  it('sends device images through the supplied wrapped uploader', () => {
    const uploadImage = vi.fn();
    const file = new File(['image'], 'inline.png', { type: 'image/png' });
    render(<EditorImageControls editor={{}} onImageUpload={uploadImage} />);

    fireEvent.change(screen.getByLabelText('Upload image'), {
      target: { files: [file] },
    });

    expect(uploadImage).toHaveBeenCalledWith(file, mockTiptap.view, 7);
  });

  describe('IME composition', () => {
    const setupChain = () => {
      const run = vi.fn();
      const setImage = vi.fn(() => ({ run }));
      const chain = {
        focus: () => ({ setImage }),
      };
      (mockTiptap as unknown as { chain: () => typeof chain }).chain = () =>
        chain;
      return { setImage };
    };

    it('does not insert the image when Enter confirms composition in the URL input', () => {
      const { setImage } = setupChain();
      render(<EditorImageControls editor={{}} />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Insert image from URL' })
      );
      const input = screen.getByLabelText('Image URL');
      fireEvent.change(input, {
        target: { value: 'https://example.com/a.jpg' },
      });

      expect(
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
      ).toBe(false);
      expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(
        false
      );
      expect(setImage).not.toHaveBeenCalled();

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(setImage).toHaveBeenCalledTimes(1);
    });

    it('does not insert the image when Enter confirms composition in the caption input', () => {
      const { setImage } = setupChain();
      render(<EditorImageControls editor={{}} />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Insert image from URL' })
      );
      fireEvent.change(screen.getByLabelText('Image URL'), {
        target: { value: 'https://example.com/a.jpg' },
      });
      const caption = screen.getByLabelText('Caption');

      expect(
        fireEvent.keyDown(caption, { key: 'Enter', isComposing: true })
      ).toBe(false);
      expect(fireEvent.keyDown(caption, { key: 'Enter', keyCode: 229 })).toBe(
        false
      );
      expect(setImage).not.toHaveBeenCalled();

      fireEvent.keyDown(caption, { key: 'Enter' });
      expect(setImage).toHaveBeenCalledTimes(1);
    });
  });
});
