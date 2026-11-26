import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LogoDropzoneChip } from './LogoDropzoneChip';

describe('LogoDropzoneChip', () => {
  it('invokes onFileSelected when a file is chosen via input', () => {
    const onFileSelected = vi.fn();
    const ref = createRef<HTMLInputElement>();

    render(
      <LogoDropzoneChip
        disabled={false}
        fileInputRef={ref}
        onFileSelected={onFileSelected}
      />
    );

    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    const input = screen.getByLabelText('Upload store logo file');
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });
});
