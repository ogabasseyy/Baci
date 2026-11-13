import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors, { BRAND } from '@/constants/Colors';
import { BvnField } from './BvnField';

const renderField = (error: string | null = null) => {
  const onChange = jest.fn();
  render(
    <BvnField
      colors={Colors.light}
      value="12345678901"
      onChange={onChange}
      error={error}
      editable
    />
  );
  return onChange;
};

describe('BVN field with the server keeping PiggyVest off', () => {
  it('hides the BVN by default and shows it on demand', () => {
    renderField();
    expect(screen.getByLabelText('BVN').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByRole('button', { name: 'Show BVN' }));
    expect(screen.getByLabelText('BVN').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide BVN' })).toBeOnTheScreen();
  });

  it('keeps digits only', () => {
    const onChange = renderField();
    fireEvent.changeText(screen.getByLabelText('BVN'), '12a3-4');
    expect(onChange).toHaveBeenCalledWith('1234');
  });

  it('shows its error right under the field, in place of the hint', () => {
    renderField('That BVN was rejected. Check the number and try again.');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That BVN was rejected. Check the number and try again.'
    );
    expect(screen.queryByText(/Forgot it\?/)).toBeNull();
  });
});

describe('bugfix: the BVN field looked like an error before any error', () => {
  const border = () => {
    const style = screen.getByTestId('bvn-input-wrap').props.style;
    return Object.assign({}, ...[style].flat(Number.POSITIVE_INFINITY))
      .borderColor;
  };

  it('is neutral at rest, brand-coloured while typing, red only on an error', () => {
    const { rerender } = render(
      <BvnField
        colors={Colors.light}
        value=""
        onChange={jest.fn()}
        error={null}
        editable
      />
    );
    expect(border()).toBe(Colors.light.border);

    fireEvent(screen.getByLabelText('BVN'), 'focus');
    expect(border()).toBe(BRAND.primary);
    fireEvent(screen.getByLabelText('BVN'), 'blur');
    expect(border()).toBe(Colors.light.border);

    rerender(
      <BvnField
        colors={Colors.light}
        value=""
        onChange={jest.fn()}
        error="That BVN was rejected. Check the number and try again."
        editable
      />
    );
    expect(border()).toBe(Colors.light.error);
  });
});
