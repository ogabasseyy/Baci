import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RepairDeviceLayout from './layout';

describe('repairs device layout', () => {
  it('eagerly styles device repair pages instead of waiting for first input', () => {
    render(
      <RepairDeviceLayout>
        <main>Device</main>
      </RepairDeviceLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Device');
  });
});
