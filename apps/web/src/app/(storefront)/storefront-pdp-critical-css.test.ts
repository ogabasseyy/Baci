import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const storefrontDir = dirname(fileURLToPath(import.meta.url));

function readStorefrontFile(fileName: string): string {
  const filePath = join(storefrontDir, fileName);

  if (!existsSync(filePath)) {
    throw new Error(
      `Missing storefront fixture ${fileName} in ${storefrontDir}. Run from the @baci/web test environment.`
    );
  }

  return readFileSync(filePath, 'utf8');
}

describe('critical PDP description geometry', () => {
  it('omits redundant visible-summary and selection-hint rules from critical summary CSS', () => {
    const summaryCss = readStorefrontFile(
      'storefront-pdp-critical-summary.css'
    );

    expect(summaryCss).not.toMatch(/\[data-ogabassey-pdp-visible-summary\]/);
    expect(summaryCss).not.toMatch(
      /\[data-ogabassey-pdp-commerce-selection-hint\]/
    );
  });

  it('keeps only the initial deferred description geometry in critical PDP CSS', () => {
    const criticalPdpCss = readStorefrontFile('storefront-pdp-critical.css');
    const descriptionCriticalPdpCss = readStorefrontFile(
      'storefront-pdp-description-critical.css'
    );

    expect(criticalPdpCss).not.toMatch(
      /data-ogabassey-pdp-deferred-description-container/
    );
    const descriptionPanel = descriptionCriticalPdpCss.match(
      /\[data-ogabassey-pdp-deferred-description-panel\]\s*\{([\s\S]*?)\}/
    )?.[1];

    expect(descriptionPanel).toBeDefined();
    expect(descriptionPanel).toContain('var(--ogabassey-surface)');
    expect(descriptionPanel).toContain('var(--ogabassey-border)');
    expect(descriptionPanel).toContain('var(--ogabassey-surface-text)');
    expect(descriptionPanel).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(descriptionCriticalPdpCss).toMatch(
      /\[data-ogabassey-pdp-deferred-description-container\]\s*\{[\s\S]*?max-width:\s*1400px/
    );
    expect(descriptionCriticalPdpCss).toMatch(
      /\[data-ogabassey-pdp-deferred-description-panel\]\s*\{[\s\S]*?min-height:\s*20rem/
    );
    expect(descriptionCriticalPdpCss).toMatch(
      /@media \(min-width: 768px\) \{[\s\S]*?\[data-ogabassey-pdp-deferred-description-container\]\s*\{[\s\S]*?padding-inline:\s*1\.5rem/
    );
    expect(descriptionCriticalPdpCss).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
