import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairDeviceSuggestionImage } from './RepairDeviceSuggestionImage';

describe('RepairDeviceSuggestionImage', () => {
  it('shows the product image and falls back to a device icon after load failure', () => {
    render(
      <RepairDeviceSuggestionImage
        deviceType="Smartphone"
        imageUrl="https://cdn.example.com/phone.jpg"
        label="iPhone 15"
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'iPhone 15' }));
    expect(
      screen.queryByRole('img', { name: 'iPhone 15' })
    ).not.toBeInTheDocument();
    expect(document.querySelector('svg')).toBeInTheDocument();
  });
});
