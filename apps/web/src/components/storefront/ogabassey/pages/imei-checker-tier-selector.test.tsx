import type { ImeiServiceTierKey } from '@baci/shared/imei';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ImeiCheckerTierSelector } from './imei-checker-tier-selector';

describe('ImeiCheckerTierSelector', () => {
  it('keeps similar checks under one goal with explicit alternatives', () => {
    render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['basic', 'appleBasic', 'serialInfo', 'blacklist']}
        selectedTier="basic"
        showAllServices
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
      />
    );
    expect(screen.getByText('Device details')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(
      screen.getByRole('button', { name: 'Compare options for Device details' })
    );
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('renders a card for every displayed tier key', () => {
    render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['full', 'activation', 'blacklist', 'carrier']}
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
        selectedTier="full"
        showAllServices={false}
      />
    );

    expect(
      screen.getByRole('radio', {
        name: /full report, .*, ₦1,500/i,
      })
    ).toBeTruthy();
  });

  it('exposes the tier grid as a radiogroup with one radio per key', () => {
    render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['full', 'activation', 'blacklist', 'carrier']}
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
        selectedTier="full"
        showAllServices={false}
      />
    );

    expect(
      screen.getByRole('radiogroup', { name: /service tier/i })
    ).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('marks the selected tier as aria-checked', () => {
    render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['full', 'blacklist']}
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
        selectedTier="blacklist"
        showAllServices={false}
      />
    );

    const radios = screen.getAllByRole('radio');
    const blacklistRadio = radios.find((radio) =>
      radio.getAttribute('aria-label')?.startsWith('Stolen Check')
    );
    expect(blacklistRadio?.getAttribute('aria-checked')).toBe('true');
  });

  it('calls onSelectTier with the tapped tier key', () => {
    const onSelectTier = vi.fn();
    render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['full', 'activation']}
        onSelectTier={onSelectTier}
        onToggleServices={vi.fn()}
        selectedTier="full"
        showAllServices={false}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /activation check/i }));

    expect(onSelectTier).toHaveBeenCalledWith('activation');
  });

  it('shows the "More checks" toggle only when canToggleServices is true', () => {
    const { rerender } = render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['full']}
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
        selectedTier="full"
        showAllServices={false}
      />
    );
    expect(screen.queryByText('More checks')).toBeNull();

    rerender(
      <ImeiCheckerTierSelector
        canToggleServices={true}
        displayedTierKeys={['full']}
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
        selectedTier="full"
        showAllServices={false}
      />
    );
    expect(screen.getByText('More checks')).toBeTruthy();
  });

  it('relabels the toggle to "Show key checks" once expanded', () => {
    render(
      <ImeiCheckerTierSelector
        canToggleServices={true}
        displayedTierKeys={['full']}
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
        selectedTier="full"
        showAllServices={true}
      />
    );

    expect(screen.getByText('Show key checks')).toBeTruthy();
  });

  it('calls onToggleServices when the toggle is pressed', () => {
    const onToggleServices = vi.fn();
    render(
      <ImeiCheckerTierSelector
        canToggleServices={true}
        displayedTierKeys={['full']}
        onSelectTier={vi.fn()}
        onToggleServices={onToggleServices}
        selectedTier="full"
        showAllServices={false}
      />
    );

    fireEvent.click(screen.getByText('More checks'));

    expect(onToggleServices).toHaveBeenCalled();
  });

  it('reveals the selected tier\'s features when "what\'s included" is toggled', () => {
    render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['full']}
        onSelectTier={vi.fn()}
        onToggleServices={vi.fn()}
        selectedTier="full"
        showAllServices={false}
      />
    );

    expect(screen.queryByText(/serial number/i)).toBeNull();
    fireEvent.click(screen.getByText(/what's included in full report/i));
    expect(screen.getByText(/serial number/i)).toBeTruthy();
  });
});

function KeyboardPicker() {
  const [selected, setSelected] = useState<'basic' | 'blacklist' | 'full'>(
    'basic'
  );
  return (
    <ImeiCheckerTierSelector
      canToggleServices={false}
      displayedTierKeys={['basic', 'blacklist', 'full']}
      selectedTier={selected}
      showAllServices
      onSelectTier={(tier) =>
        setSelected(tier as 'basic' | 'blacklist' | 'full')
      }
      onToggleServices={() => {}}
    />
  );
}

describe('service picker accessibility regressions', () => {
  it('uses one tab stop and arrow keys move focus and selection with wrapping', () => {
    render(<KeyboardPicker />);
    const first = screen.getByRole('radio', { name: /quick id/i });
    const next = screen.getByRole('radio', { name: /stolen check/i });
    const last = screen.getByRole('radio', { name: /full report/i });
    expect(first.tabIndex).toBe(0);
    expect(next.tabIndex).toBe(-1);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(next, { key: 'End' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('opens one linked comparison area at a time', () => {
    render(
      <ImeiCheckerTierSelector
        canToggleServices={false}
        displayedTierKeys={['basic', 'appleBasic', 'icloud', 'icloudPro']}
        selectedTier="basic"
        showAllServices
        onSelectTier={() => {}}
        onToggleServices={() => {}}
      />
    );
    const details = screen.getByRole('button', {
      name: 'Compare options for Device details',
    });
    const ownership = screen.getByRole('button', {
      name: 'Compare options for Ownership & account locks',
    });
    fireEvent.click(details);
    expect(details).toHaveAccessibleName('Close comparison for Device details');
    expect(details).toHaveTextContent('Close comparison');
    const region = screen.getByRole('region', {
      name: 'Compare Device details',
    });
    expect(details.getAttribute('aria-controls')).toBe(region.id);
    expect(
      screen.getByRole('radio', { name: /apple basic info/i })
    ).toBeTruthy();
    fireEvent.click(ownership);
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(details).toHaveAccessibleName('Compare options for Device details');
    expect(
      screen.queryByRole('region', { name: 'Compare Device details' })
    ).toBeNull();
    expect(
      screen.getByRole('region', { name: 'Compare Ownership & account locks' })
    ).toBeTruthy();
  });
});

function ComparisonPicker() {
  const [selected, setSelected] = useState<ImeiServiceTierKey>('basic');
  return (
    <ImeiCheckerTierSelector
      canToggleServices={false}
      displayedTierKeys={['basic', 'appleBasic', 'serialInfo', 'blacklist']}
      selectedTier={selected}
      showAllServices
      onSelectTier={setSelected}
      onToggleServices={() => {}}
    />
  );
}
it('keeps focus and the chosen alternative when its comparison closes', () => {
  render(<ComparisonPicker />);
  const disclosure = screen.getByRole('button', {
    name: 'Compare options for Device details',
  });
  fireEvent.click(disclosure);
  const first = screen.getByRole('radio', { name: /quick id/i });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const alternative = screen.getByRole('radio', { name: /apple basic info/i });
  expect(document.activeElement).toBe(alternative);
  expect(alternative.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(disclosure);
  expect(
    screen
      .getByRole('radio', { name: /apple basic info/i })
      .getAttribute('aria-checked')
  ).toBe('true');
  expect(screen.queryByRole('radio', { name: /quick id/i })).toBeNull();
});

it('walks every alternative in order across successive arrow presses', () => {
  render(<ComparisonPicker />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Compare options for Device details' })
  );
  const first = screen.getByRole('radio', { name: /quick id/i });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const second = screen.getByRole('radio', { name: /apple basic info/i });
  fireEvent.keyDown(second, { key: 'ArrowRight' });
  const third = screen.getByRole('radio', { name: /serial info/i });
  expect(document.activeElement).toBe(third);
  expect(third.getAttribute('aria-checked')).toBe('true');
  expect(
    screen
      .getAllByRole('radio')
      .slice(0, 3)
      .map((e) => e.getAttribute('aria-label')?.split(',')[0])
  ).toEqual(['Quick ID', 'Apple Basic Info', 'Serial Info']);
});
