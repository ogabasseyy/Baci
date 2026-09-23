import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImeiResult } from './imei-checker-types';
import { OgabasseyImeiResults } from './imei-results';

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));
vi.mock('./imei-remediation-offer', () => ({
  ImeiRemediationOffer: ({ lookupId }: { lookupId: string }) => (
    <div>Unlock offer for {lookupId}</div>
  ),
}));

const fullTier = IMEI_SERVICE_TIERS.full;

const baseResult: ImeiResult = {
  blacklistStatus: 'Clean',
  carrier: 'Unlocked',
  device: 'iPhone 15 Pro',
  deviceImage: '',
  deviceType: 'apple',
  icloud: 'Off',
  icloudLock: 'Off',
  imei: '354442067957452',
  modelNumber: 'A3101',
  score: 98,
  simLock: 'Unlocked',
  status: 'Clean',
  verdict: 'Safe to buy',
  verdictType: 'safe',
};

describe('OgabasseyImeiResults', () => {
  it('renders nothing without a result', () => {
    const { container } = render(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={vi.fn()}
        result={null}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the core status cards gated on checksIncluded', () => {
    render(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={vi.fn()}
        result={baseResult}
      />
    );

    expect(screen.getByText('Blacklist Status')).toBeTruthy();
    expect(screen.getByText('iCloud Status')).toBeTruthy();
    expect(screen.getByText('Find My iPhone')).toBeTruthy();
    expect(screen.getByText('SIM Lock')).toBeTruthy();
    expect(screen.getByText('Carrier')).toBeTruthy();
    expect(document.querySelector('[data-imei-result]')).toBeInTheDocument();
  });

  it('renders the widened optional fields when the provider returns them', () => {
    render(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={vi.fn()}
        result={{
          ...baseResult,
          gsxCoverage: 'Expired',
          knoxGuardStatus: 'Inactive',
          repairHistory: 'No Repairs',
        }}
      />
    );

    expect(screen.getByText('Coverage')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('Knox Guard')).toBeTruthy();
    expect(screen.getByText('Repair History')).toBeTruthy();
  });

  it('omits the core cards for a tier that never checked them', () => {
    // 'macIcloud' only checks icloud + serialNumber-shaped fields, not
    // blacklist/SIM/carrier.
    render(
      <OgabasseyImeiResults
        currentTier={IMEI_SERVICE_TIERS.macIcloud}
        onReset={vi.fn()}
        result={baseResult}
      />
    );

    expect(screen.queryByText('Blacklist Status')).toBeNull();
    expect(screen.queryByText('SIM Lock')).toBeNull();
    expect(screen.queryByText('Carrier')).toBeNull();
  });

  it('renders clean and non-clean trust-score tones', () => {
    const { rerender } = render(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={vi.fn()}
        result={baseResult}
      />
    );

    expect(screen.getByText('98%')).toHaveClass(
      'text-[var(--store-success-text,#166534)]'
    );

    rerender(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={vi.fn()}
        result={{
          ...baseResult,
          blacklistStatus: 'Blacklisted',
          score: 12,
          status: 'Blacklisted',
        }}
      />
    );

    expect(screen.getByText('12%')).toHaveClass(
      'text-[var(--store-danger-text,#dc2626)]'
    );
  });

  it.each([
    ['safe', 'Safe to buy', 'text-[var(--store-success-text,#166534)]'],
    ['danger', 'Do not buy', 'text-[var(--store-danger-text,#dc2626)]'],
    [
      'caution',
      'Verify with seller',
      'text-[var(--store-warning-text,#854d0e)]',
    ],
  ] as const)('renders %s verdict tone', (verdictType, verdict, textClass) => {
    render(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={vi.fn()}
        result={{ ...baseResult, verdict, verdictType }}
      />
    );

    expect(screen.getByText(verdict)).toHaveClass(textClass);
  });

  it('calls onReset from the reset action', () => {
    const onReset = vi.fn();
    render(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={onReset}
        result={baseResult}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /check another device/i })
    );

    expect(onReset).toHaveBeenCalledOnce();
  });

  it('requests server-approved remediation only when a lookup id is available', () => {
    const { rerender } = render(
      <OgabasseyImeiResults
        currentTier={fullTier}
        lookupId="11111111-1111-4111-8111-111111111111"
        onReset={vi.fn()}
        result={baseResult}
      />
    );

    expect(screen.getByText(/unlock offer for 11111111/i)).toBeInTheDocument();

    rerender(
      <OgabasseyImeiResults
        currentTier={fullTier}
        onReset={vi.fn()}
        result={baseResult}
      />
    );
    expect(screen.queryByText(/unlock offer for/i)).toBeNull();
  });
});
