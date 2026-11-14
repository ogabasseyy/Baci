import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { TagInput } from './tag-input';

/** Stateful wrapper so the controlled component re-renders after onChange. */
function TagInputHarness({
  initial = [],
  onChangeSpy,
  maxTags,
}: {
  initial?: string[];
  onChangeSpy: (tags: string[]) => void;
  maxTags?: number;
}) {
  const [tags, setTags] = useState(initial);
  return (
    <TagInput
      value={tags}
      onChange={(next) => {
        setTags(next);
        onChangeSpy(next);
      }}
      maxTags={maxTags}
    />
  );
}

describe('TagInput', () => {
  const mockOnChange = vi.fn();
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockOnChange.mockClear();
    // Flush requestAnimationFrame synchronously so flashAnnouncement updates are testable
    rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('renders initial tags', () => {
    render(
      <TagInputHarness initial={['tag1', 'tag2']} onChangeSpy={mockOnChange} />
    );
    expect(screen.getByText('tag1')).toBeInTheDocument();
    expect(screen.getByText('tag2')).toBeInTheDocument();
  });

  it('has an accessible add button', () => {
    render(<TagInputHarness onChangeSpy={mockOnChange} />);
    expect(
      screen.getByRole('button', { name: /add tag/i })
    ).toBeInTheDocument();
  });

  it('has accessible remove buttons', () => {
    render(<TagInputHarness initial={['tag1']} onChangeSpy={mockOnChange} />);
    expect(
      screen.getByRole('button', { name: /remove tag1/i })
    ).toBeInTheDocument();
  });

  it('adds a tag via Enter and announces it', async () => {
    render(<TagInputHarness onChangeSpy={mockOnChange} />);
    const input = screen.getByRole('textbox', { name: /tag input/i });

    fireEvent.change(input, { target: { value: 'new tag' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnChange).toHaveBeenCalledWith(['new tag']);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Tag "new tag" added'
      );
    });
  });

  it('removes a tag via button click and announces it', async () => {
    render(<TagInputHarness initial={['tag1']} onChangeSpy={mockOnChange} />);

    fireEvent.click(screen.getByRole('button', { name: /remove tag1/i }));

    expect(mockOnChange).toHaveBeenCalledWith([]);
    // Controlled harness re-renders, so the tag should be gone from the DOM
    expect(screen.queryByText('tag1')).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Tag "tag1" removed'
      );
    });
  });

  it('removes last tag via Backspace on empty input', async () => {
    render(
      <TagInputHarness
        initial={['first', 'second']}
        onChangeSpy={mockOnChange}
      />
    );
    const input = screen.getByRole('textbox', { name: /tag input/i });

    // Backspace with empty input removes the last tag
    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(mockOnChange).toHaveBeenCalledWith(['first']);
    expect(screen.queryByText('second')).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Tag "second" removed'
      );
    });
  });

  it('announces duplicate tag attempt via flashAnnouncement', async () => {
    render(
      <TagInputHarness initial={['existing']} onChangeSpy={mockOnChange} />
    );
    const input = screen.getByRole('textbox', { name: /tag input/i });

    act(() => {
      fireEvent.change(input, { target: { value: 'existing' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // onChange should NOT have been called (duplicate rejected)
    expect(mockOnChange).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Tag "existing" has already been added'
      );
    });
  });

  it('announces maxTags reached via flashAnnouncement', async () => {
    render(
      <TagInputHarness
        initial={['a', 'b']}
        onChangeSpy={mockOnChange}
        maxTags={2}
      />
    );
    const input = screen.getByRole('textbox', { name: /tag input/i });

    // Input is disabled when maxTags reached, but we can still test the addTag path
    // by forcing a value and pressing Enter
    act(() => {
      fireEvent.change(input, { target: { value: 'c' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(mockOnChange).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Maximum of 2 tags reached'
      );
    });
  });

  it('has visible focus styles on remove buttons', () => {
    render(<TagInputHarness initial={['tag1']} onChangeSpy={mockOnChange} />);
    const removeButton = screen.getByRole('button', { name: /remove tag1/i });
    expect(removeButton).toHaveClass('focus-visible:outline-hidden');
    expect(removeButton).toHaveClass('focus-visible:ring-2');
    expect(removeButton).toHaveClass('focus-visible:ring-ring');
    expect(removeButton).toHaveClass('focus-visible:ring-offset-2');
  });

  describe('focus management after tag removal', () => {
    it('focuses the next tag button when a middle tag is removed', () => {
      render(
        <TagInputHarness
          initial={['first', 'second', 'third']}
          onChangeSpy={mockOnChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /remove second/i }));

      // After removing "second", focus should move to the tag now at index 1 ("third")
      const thirdRemoveBtn = screen.getByRole('button', {
        name: /remove third/i,
      });
      expect(thirdRemoveBtn).toHaveFocus();
    });

    it('focuses the last tag button when the last tag is removed', () => {
      render(
        <TagInputHarness
          initial={['first', 'second', 'third']}
          onChangeSpy={mockOnChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /remove third/i }));

      // After removing the last tag, focus should wrap to the new last tag ("second")
      const secondRemoveBtn = screen.getByRole('button', {
        name: /remove second/i,
      });
      expect(secondRemoveBtn).toHaveFocus();
    });

    it('focuses the input when the only tag is removed', () => {
      render(<TagInputHarness initial={['only']} onChangeSpy={mockOnChange} />);

      fireEvent.click(screen.getByRole('button', { name: /remove only/i }));

      const input = screen.getByRole('textbox', { name: /tag input/i });
      expect(input).toHaveFocus();
    });

    it('focuses the input when removing via Backspace clears all tags', () => {
      render(<TagInputHarness initial={['last']} onChangeSpy={mockOnChange} />);
      const input = screen.getByRole('textbox', { name: /tag input/i });

      fireEvent.keyDown(input, { key: 'Backspace' });

      expect(input).toHaveFocus();
    });

    it('remove buttons have data-tag-remove attributes', () => {
      render(
        <TagInputHarness
          initial={['alpha', 'beta']}
          onChangeSpy={mockOnChange}
        />
      );

      const alphaBtn = screen.getByRole('button', { name: /remove alpha/i });
      const betaBtn = screen.getByRole('button', { name: /remove beta/i });
      expect(alphaBtn).toHaveAttribute('data-tag-remove', '0');
      expect(betaBtn).toHaveAttribute('data-tag-remove', '1');
    });
  });
});

describe('TagInput IME composition', () => {
  it('does not add a tag or remove one while an IME is composing', () => {
    const onChange = vi.fn();
    render(<TagInput value={['existing']} onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'にほん' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });

    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['existing', 'にほん']);
  });
});
