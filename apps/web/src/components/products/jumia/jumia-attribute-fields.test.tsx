import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JumiaAttributeFields } from './jumia-attribute-fields';
import type { JumiaDraftAttribute } from './jumia-attribute-values';

const attribute = (
  type: number,
  extra: Partial<JumiaDraftAttribute> = {}
): JumiaDraftAttribute => ({
  code: type,
  name: `Field ${type}`,
  description: '',
  type,
  mandatory: true,
  variation: false,
  translatable: false,
  ...extra,
});
const option = {
  id: 10,
  sid: '11111111-1111-4111-8111-111111111111',
  name: 'Red',
  position: 0,
  isDefault: true,
  status: 'ACTIVE' as const,
};
describe('JumiaAttributeFields', () => {
  it('renders all numeric kinds with accessible labels and no selected defaults', () => {
    const attributes = Array.from({ length: 9 }, (_, type) =>
      attribute(type, {
        options: [option],
        validations: {
          dateFormat: type === 5 ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ss',
        },
      })
    );
    render(
      <JumiaAttributeFields
        attributes={attributes}
        values={{}}
        onChange={vi.fn()}
      />
    );
    for (let type = 0; type < 9; type++)
      expect(
        screen.getByLabelText(`Field ${type} (required)`)
      ).toBeInTheDocument();
    expect(screen.getByLabelText('Field 4 (required)')).toHaveValue('');
    expect(screen.getByLabelText('Field 6 (required)')).toHaveValue('');
    expect(screen.getByLabelText('Field 3 (required)')).toHaveValue([]);
  });
  it('emits typed numeric, option, multiselect and explicit false values', () => {
    const onChange = vi.fn();
    render(
      <JumiaAttributeFields
        attributes={[
          attribute(2),
          attribute(6),
          attribute(4, {
            options: [
              option,
              { ...option, id: 11, name: 'Old', status: 'INACTIVE' },
            ],
          }),
          attribute(3, { options: [option] }),
        ]}
        values={{}}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Field 2 (required)'), {
      target: { value: '0' },
    });
    expect(onChange).toHaveBeenLastCalledWith('2', 0);
    fireEvent.change(screen.getByLabelText('Field 6 (required)'), {
      target: { value: 'false' },
    });
    expect(onChange).toHaveBeenLastCalledWith('6', false);
    fireEvent.change(screen.getByLabelText('Field 4 (required)'), {
      target: { value: '10' },
    });
    expect(onChange).toHaveBeenLastCalledWith('4', 10);
    expect(
      screen.queryByRole('option', { name: 'Old' })
    ).not.toBeInTheDocument();
    const select =
      screen.getByLabelText<HTMLSelectElement>('Field 3 (required)');
    select.options[0].selected = true;
    fireEvent.change(select);
    expect(onChange).toHaveBeenLastCalledWith('3', [10]);
  });
  it('reports unavailable required and optional metadata without a free-text fallback', () => {
    render(
      <JumiaAttributeFields
        attributes={[
          attribute(99),
          attribute(5),
          attribute(4, { mandatory: false }),
        ]}
        values={{}}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/Unsupported attribute type/)).toBeInTheDocument();
    expect(screen.getByText(/Date format unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/No active options/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('retains false and zero and does not normalize invalid date/time strings', () => {
    const onChange = vi.fn();
    render(
      <JumiaAttributeFields
        attributes={[
          attribute(2),
          attribute(6),
          attribute(7, { validations: { dateFormat: 'YYYY-MM-DDTHH:mm:ss' } }),
        ]}
        values={{ 2: 0, 6: false }}
        onChange={onChange}
      />
    );
    expect(screen.getByLabelText('Field 2 (required)')).toHaveValue(0);
    expect(screen.getByLabelText('Field 6 (required)')).toHaveValue('false');
    fireEvent.change(screen.getByLabelText('Field 7 (required)'), {
      target: { value: '2026-02-30T25:00:00' },
    });
    expect(onChange).toHaveBeenLastCalledWith('7', '2026-02-30T25:00:00');
  });
});
