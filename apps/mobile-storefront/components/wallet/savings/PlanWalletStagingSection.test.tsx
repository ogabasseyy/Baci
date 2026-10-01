import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PlanWalletStagingSection } from './PlanWalletStagingSection';

const colors = {
  background: Colors.light.background,
  border: Colors.light.border,
  card: Colors.light.card,
  error: Colors.light.error,
  placeholder: Colors.light.placeholder,
  primary: Colors.light.primary,
  text: Colors.light.text,
  textSecondary: Colors.light.textSecondary,
};

describe('PlanWalletStagingSection', () => {
  it('prompts for a device when no target is priced', () => {
    render(<PlanWalletStagingSection colors={colors} targetKobo={0} />);
    expect(screen.getByLabelText('Plan wallet staging preview')).toBeTruthy();
    expect(screen.getByText(/Select a device/i)).toBeTruthy();
  });

  it('shows synthetic reconciled progress against the priced target', () => {
    render(
      <PlanWalletStagingSection colors={colors} targetKobo={10_000_000} />
    );
    expect(screen.getByText('₦98,000.00')).toBeTruthy();
    expect(screen.getByText(/Continue saving/i)).toBeTruthy();
  });

  it('shows ready state once synthetic power covers the target', () => {
    render(<PlanWalletStagingSection colors={colors} targetKobo={9_800_000} />);
    expect(screen.getByText(/Ready — covers the target/i)).toBeTruthy();
  });

  it('discloses the cancel quote with forfeited interest split out', () => {
    render(
      <PlanWalletStagingSection colors={colors} targetKobo={10_000_000} />
    );
    expect(screen.getByText('₦95,000.00')).toBeTruthy();
    expect(screen.getByText('₦5,000.00')).toBeTruthy();
  });
});
