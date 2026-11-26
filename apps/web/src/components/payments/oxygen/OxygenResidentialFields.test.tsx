import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { PlaceDetails } from '@/components/address-autocomplete-types';
import { OxygenResidentialFields } from './OxygenResidentialFields';

vi.mock('@/components/address-autocomplete', () => ({
  AddressAutocomplete: ({
    onChange,
    onError,
    onSelect,
  }: {
    onChange: (value: string) => void;
    onError: (failed: boolean) => void;
    onSelect: (place: PlaceDetails) => void;
  }) => (
    <>
      <input
        aria-label="Find your home address"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          onSelect({
            route: 'Example Road',
            streetNumber: '4',
            city: 'Lagos',
            state: 'Lagos',
            country: 'Nigeria',
            zip: '',
            formattedAddress: '4 Example Road, Lagos',
            lga: 'Ikeja',
          })
        }
      >
        Select with LGA
      </button>
      <button type="button" onClick={() => onError(true)}>
        Search unavailable
      </button>
      <button
        type="button"
        onClick={() =>
          onSelect({
            route: 'Example Road',
            streetNumber: '4',
            city: 'Ikeja',
            state: 'Lagos',
            zip: '',
            country: 'Nigeria',
            formattedAddress: '4 Example Road, Ikeja',
          })
        }
      >
        Select address
      </button>
    </>
  ),
}));
it('reuses checkout address without requiring duplicate entry and allows a change', () => {
  render(
    <OxygenResidentialFields
      initial={{ street: 'Example Road', city: 'Ikeja', state: 'Lagos' }}
      checkout
      file={null}
      onFile={vi.fn()}
    />
  );
  expect(screen.getByText('From your checkout')).toBeVisible();
  expect(screen.getByLabelText('Street address')).toHaveValue('Example Road');
  fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
  expect(screen.getByLabelText('Street address')).not.toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Enter address manually' })
  );
  expect(screen.getByLabelText('Street address')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Street address'), {
    target: { value: 'Another Road' },
  });
  expect(screen.getByLabelText('Street address')).toHaveValue('Another Road');
});
it('keeps manual fields usable when search fails and does not invent an LGA', () => {
  render(<OxygenResidentialFields file={null} onFile={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Search unavailable' }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'enter your address manually'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select address' }));
  expect(screen.getByLabelText('Street address')).toHaveValue('Example Road');
  expect(screen.getByLabelText('House / flat number')).toHaveValue('4');
  expect(screen.getByLabelText('Local government area (LGA)')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Local government area (LGA)'), {
    target: { value: 'Ikeja' },
  });
  expect(screen.getByLabelText('Local government area (LGA)')).toHaveValue(
    'Ikeja'
  );
});
it('rejects unsupported and oversized proof without accepting a file', () => {
  const onFile = vi.fn();
  render(<OxygenResidentialFields file={null} onFile={onFile} />);
  fireEvent.change(screen.getByLabelText('Proof of address'), {
    target: { files: [new File(['x'], 'bill.html', { type: 'text/html' })] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a PDF');
  expect(onFile).toHaveBeenLastCalledWith(null);
  const large = new File([new Uint8Array(1_500_001)], 'bill.pdf', {
    type: 'application/pdf',
  });
  fireEvent.change(screen.getByLabelText('Proof of address'), {
    target: { files: [large] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('smaller than 1.5 MB');
});

it('shows one address search and only asks for missing details after selection', () => {
  render(<OxygenResidentialFields file={null} onFile={vi.fn()} />);
  expect(screen.getByLabelText('Street address')).not.toBeVisible();
  expect(screen.getByLabelText('City / town')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Select address' }));
  expect(screen.getByLabelText('Street address')).not.toBeVisible();
  expect(screen.getByLabelText('City / town')).not.toBeVisible();
  expect(screen.getByLabelText('State')).not.toBeVisible();
  expect(screen.getByLabelText('House / flat number')).not.toBeVisible();
  expect(screen.getByLabelText('Local government area (LGA)')).toBeVisible();
  expect(screen.getByLabelText('Nearby landmark')).toBeVisible();
});

it('fills and hides the supplied LGA while keeping the distinct city for Oxygen', () => {
  const onChange = vi.fn();
  render(
    <OxygenResidentialFields file={null} onFile={vi.fn()} onChange={onChange} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select with LGA' }));
  expect(screen.getByLabelText('Local government area (LGA)')).toHaveValue(
    'Ikeja'
  );
  expect(
    screen.getByLabelText('Local government area (LGA)')
  ).not.toBeVisible();
  expect(screen.getByLabelText('City / town')).toHaveValue('Lagos');
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ city: 'Lagos', state: 'Lagos', lga: 'Ikeja' })
  );
});

it('keeps missing address fields visible while the customer types and completes them', () => {
  render(<OxygenResidentialFields file={null} onFile={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Select address' }));
  for (const label of ['Local government area (LGA)', 'Nearby landmark']) {
    const input = screen.getByLabelText(label);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'I' } });
    expect(input).toBeVisible();
    fireEvent.change(input, { target: { value: 'Ikeja' } });
    fireEvent.blur(input);
    expect(input).toBeVisible();
    expect(input).toHaveValue('Ikeja');
  }
  // A new search result defines a new set of missing fields.
  fireEvent.click(screen.getByRole('button', { name: 'Select with LGA' }));
  expect(
    screen.getByLabelText('Local government area (LGA)')
  ).not.toBeVisible();
  expect(screen.getByLabelText('Nearby landmark')).toBeVisible();
});

it('keeps a saved landmark editable when restoring a partial entry', () => {
  render(
    <OxygenResidentialFields
      initial={{ street: 'Example Road', landmark: 'I' }}
      file={null}
      onFile={vi.fn()}
    />
  );
  const input = screen.getByLabelText('Nearby landmark');
  expect(input).toBeVisible();
  expect(input).not.toBeRequired();
  fireEvent.change(input, { target: { value: 'Ikeja' } });
  expect(input).toBeVisible();
});

it('does not mark hidden address inputs required and keeps entered fields when search text changes', () => {
  const onChange = vi.fn();
  render(
    <OxygenResidentialFields
      initial={{
        street: 'Example Road',
        city: 'Ikeja',
        state: 'Lagos',
        lga: 'Ikeja',
        house_number: '4',
      }}
      file={null}
      onFile={vi.fn()}
      onChange={onChange}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
  expect(screen.getByLabelText('Street address')).not.toBeVisible();
  expect(screen.getByLabelText('Street address')).not.toBeRequired();
  fireEvent.change(screen.getByLabelText('Find your home address'), {
    target: { value: '' },
  });
  expect(screen.getByLabelText('Street address')).toHaveValue('Example Road');
  expect(onChange).not.toHaveBeenCalled();
});

it('clears selected proof when material address fields change but preserves it for landmark edits', () => {
  const onFile = vi.fn();
  const bill = new File(['bill'], 'bill.pdf', { type: 'application/pdf' });
  render(
    <OxygenResidentialFields
      initial={{
        street: 'Example Road',
        city: 'Ikeja',
        state: 'Lagos',
        lga: 'Ikeja',
        house_number: '4',
      }}
      file={bill}
      onFile={onFile}
    />
  );
  fireEvent.change(screen.getByLabelText('Nearby landmark'), {
    target: { value: 'Opposite Bank' },
  });
  expect(onFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Enter address manually' })
  );
  fireEvent.change(screen.getByLabelText('Street address'), {
    target: { value: 'New Road' },
  });
  expect(onFile).toHaveBeenCalledWith(null);
});

it('clears selected proof when choosing a different autocomplete address', () => {
  const onFile = vi.fn();
  const bill = new File(['bill'], 'bill.pdf', { type: 'application/pdf' });
  render(
    <OxygenResidentialFields
      initial={{
        street: 'Old Street',
        city: 'Ikeja',
        state: 'Lagos',
        lga: 'Ikeja',
        house_number: '1',
      }}
      file={bill}
      onFile={onFile}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Change address' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select with LGA' }));
  expect(onFile).toHaveBeenCalledWith(null);
});
