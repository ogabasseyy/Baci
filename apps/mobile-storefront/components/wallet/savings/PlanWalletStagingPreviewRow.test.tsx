import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { PlanWalletStagingPreviewRow } from './PlanWalletStagingPreviewRow';
import type { StartSavingsColors } from './start-savings.types';

const colors: StartSavingsColors = {
  background: '#ffffff',
  border: '#e5e5e5',
  card: '#ffffff',
  error: '#cc0000',
  placeholder: '#999999',
  primary: '#0a7d2c',
  text: '#111111',
  textSecondary: '#666666',
};

describe('PlanWalletStagingPreviewRow', () => {
  it('renders the label/value contract', () => {
    // Arrange & Act
    render(
      <PlanWalletStagingPreviewRow
        colors={colors}
        label="Staging wallet"
        value="₦1,250,000"
      />
    );

    // Assert
    expect(screen.getByText('Staging wallet')).toBeTruthy();
    expect(screen.getByText('₦1,250,000')).toBeTruthy();
  });
});
