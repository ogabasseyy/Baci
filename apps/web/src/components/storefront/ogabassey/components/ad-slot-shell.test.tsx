import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdSlotShell } from './ad-slot-shell';

const dims = {
  name: 'homepage_large_strip',
  width: 970,
  height: 90,
  mobileWidth: 320,
  mobileHeight: 50,
};

describe('AdSlotShell', () => {
  it('gives the shrink-to-fit label frame its own creative width before GPT mounts', () => {
    const { container } = render(<AdSlotShell {...dims} />);
    const box = container.querySelector('.ogabassey-ad-slot');
    const frame = box?.parentElement;
    expect(frame).toHaveClass('ogabassey-ad-slot-frame');
    expect(frame?.style.getPropertyValue('--ad-slot-w')).toBe('320px');
    expect(frame?.style.getPropertyValue('--ad-slot-w-lg')).toBe('970px');
  });
  it('locks the box height to the per-breakpoint creative size via CSS vars', () => {
    const { container } = render(<AdSlotShell {...dims} />);
    const box = container.querySelector('.ogabassey-ad-slot') as HTMLElement;

    expect(box).not.toBeNull();
    // overflow-hidden + a fixed (not min) height keeps a filled ad from growing
    // the box -> CLS-safe.
    expect(box).toHaveClass('overflow-hidden');
    expect(box.style.getPropertyValue('--ad-slot-h')).toBe('50px');
    expect(box.style.getPropertyValue('--ad-slot-w')).toBe('320px');
    expect(box.style.getPropertyValue('--ad-slot-h-lg')).toBe('90px');
    expect(box.style.getPropertyValue('--ad-slot-w-lg')).toBe('970px');
  });

  it('falls back to desktop dimensions when mobile dimensions are omitted', () => {
    const { container } = render(
      <AdSlotShell height={90} name="legacy_slot" width={970} />
    );
    const box = container.querySelector('.ogabassey-ad-slot') as HTMLElement;

    expect(box.style.getPropertyValue('--ad-slot-h')).toBe('90px');
    expect(box.style.getPropertyValue('--ad-slot-w')).toBe('970px');
    expect(box.style.getPropertyValue('--ad-slot-h-lg')).toBe('90px');
    expect(box.style.getPropertyValue('--ad-slot-w-lg')).toBe('970px');
  });

  it('renders the reserved placeholder with accessible foreground copy', () => {
    render(<AdSlotShell {...dims} />);

    expect(screen.getByText('Sponsored')).toHaveClass(
      'ogabassey-ad-placeholder-text'
    );
    expect(screen.getByText('Ad Space')).toHaveClass(
      'ogabassey-ad-placeholder-text'
    );
    expect(screen.getByText(dims.name)).toBeInTheDocument();
    expect(screen.getByText('970x90')).toBeInTheDocument();
  });

  it('hides the placeholder once an ad has painted but keeps the box', () => {
    const { container } = render(
      <AdSlotShell {...dims} showPlaceholder={false} />
    );

    expect(screen.queryByText('Ad Space')).not.toBeInTheDocument();
    expect(screen.getByText('Sponsored')).toBeInTheDocument();
    // The height-locked box is still present so removing the placeholder does
    // not change layout.
    expect(container.querySelector('.ogabassey-ad-slot')).not.toBeNull();
  });

  it('renders the live ad slot passed as children', () => {
    render(
      <AdSlotShell {...dims} showPlaceholder={false}>
        <div data-testid="gpt-slot" />
      </AdSlotShell>
    );

    expect(screen.getByTestId('gpt-slot')).toBeInTheDocument();
  });

  it('hides the reserved fallback from assistive tech when ariaHidden', () => {
    const { container } = render(<AdSlotShell {...dims} ariaHidden />);
    const outer = container.firstElementChild as HTMLElement;

    expect(outer).toHaveAttribute('aria-hidden', 'true');
  });
});
