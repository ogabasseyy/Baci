import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import { PilotLabNotOptimized } from './lab-not-optimized';

const binding: PilotInventoryBinding = {
  assetId: 'logo-1',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  originalUrl: 'https://cdn.example.com/media/logo.png',
  role: 'logo',
  slotId: 'header-logo',
  sourceSha256: 'a'.repeat(64),
};

describe('PilotLabNotOptimized', () => {
  it('renders the not-optimized status section with optional baseline figure', () => {
    const withoutBaseline = renderToStaticMarkup(
      <PilotLabNotOptimized binding={binding} reason="missing acceptance" />
    );
    expect(withoutBaseline).toContain('data-pilot-lab-status="not-optimized"');
    expect(withoutBaseline).toContain('missing acceptance');
    expect(withoutBaseline).not.toContain('<figure>');

    const withBaseline = renderToStaticMarkup(
      <PilotLabNotOptimized
        baselineAlt="Logo baseline"
        baselineSrc="/__pilot/originals/logo.png"
        binding={binding}
        reason="rejected by reviewer"
      />
    );
    expect(withBaseline).toContain('<figure>');
    expect(withBaseline).toContain('src="/__pilot/originals/logo.png"');
    expect(withBaseline).toContain('alt="Logo baseline"');
  });
});
