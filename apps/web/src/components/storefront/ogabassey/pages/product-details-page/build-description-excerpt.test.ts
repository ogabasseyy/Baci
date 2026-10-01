import { describe, expect, it } from 'vitest';
import { buildDescriptionExcerpt } from './build-description-excerpt';

describe('buildDescriptionExcerpt', () => {
  it('extracts text from a "Why Worth" H2 heading match', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Great value for money and premium build quality.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Great value for money and premium build quality.');
  });

  it('filters specification sentences from "Why Worth" paragraph with prose and specs', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Incredible speed and battery life. Storage: 2TB PCIe NVMe SSD. RAM: 64GB.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Incredible speed and battery life.');
  });

  it('falls through to second paragraph when "Why Worth" paragraph contains only specification sentences', () => {
    const html =
      '<h2>Why It Is Worth Buying</h2><p>Storage: 2TB PCIe NVMe SSD. RAM: 64GB.</p><p>Built for reliable all-day performance and intense creative workflows.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe(
      'Built for reliable all-day performance and intense creative workflows.'
    );
  });

  it('falls back to the second paragraph when no "Why Worth" H2 is present', () => {
    const html =
      '<p>Storage: 256GB.</p><p>Built for reliable everyday performance.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Built for reliable everyday performance.');
  });

  it('filters specification sentences from second paragraph with prose and specs', () => {
    const html =
      '<p>Storage: 128GB.</p><p>A premium flagship phone. Storage: 1TB NVMe. RAM: 16GB.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('A premium flagship phone.');
  });

  it('falls through to plain text when second paragraph contains only specification sentences', () => {
    const html =
      '<p>Storage: 1TB NVMe. RAM: 16GB. Condition: Open Box.</p><p>Storage: 1TB. RAM: 16GB.</p>Engineered for maximum portability with long battery endurance.';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe(
      'Engineered for maximum portability with long battery endurance.'
    );
  });

  it('preserves feature-heading prose lines that are not raw specs', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Camera: Capture every detail in vivid color, day or night.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe(
      'Camera: Capture every detail in vivid color, day or night.'
    );
  });

  it('preserves feature prose using common verbs outside a hardcoded allowlist', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Display: See every detail on the expansive screen with brilliant clarity.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe(
      'Display: See every detail on the expansive screen with brilliant clarity.'
    );
  });

  it('preserves short concise single-sentence plain-text descriptions', () => {
    const description = 'Premium quality for everyday use.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Premium quality for everyday use.');
  });

  it('preserves leading marketing prose before specification sentences in plain text', () => {
    const description =
      'Built for reliable all-day performance. Storage: 2TB. RAM: 64GB.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('returns filtered plain-text prose in document order', () => {
    const description =
      'Dell XPS 16 9650. Built for reliable studio workflows. Engineered for intense creative sessions.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe(
      'Built for reliable studio workflows. Engineered for intense creative sessions.'
    );
  });

  it('filters demonstrable product titles without treating unlisted short sentences as titles', () => {
    const description =
      'Dell XPS 16 9650. Built for reliable all-day performance. Storage: 2TB.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('filters unmatched catalog label metadata from "Why Worth" paragraph', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Incredible speed and battery life. Brand: Apple. Storage: 2TB.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Incredible speed and battery life.');
  });

  it('filters product titles from paragraph branches before returning prose', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>iPhone 15 Pro Max. Incredible speed and battery life.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Incredible speed and battery life.');
  });

  it('filters product titles from the second-paragraph branch before returning prose', () => {
    const html =
      '<p>Storage: 128GB.</p><p>Dell XPS 16 9650. Built for reliable all-day performance.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('preserves display prose that contains an acronym without model digits', () => {
    const html = '<h2>Why It is Worth Buying</h2><p>Premium OLED display.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Premium OLED display.');
  });

  it('preserves short labeled marketing sentences instead of treating them as specs', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Camera: Powerful camera system. Service: Great service.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Camera: Powerful camera system. Service: Great service.');
  });

  it('preserves feature prose without allowlisted connector words', () => {
    const html =
      "<h2>Why It is Worth Buying</h2><p>Camera: Capture life's magic.</p>";
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe("Camera: Capture life's magic.");
  });

  it('preserves promotional copy that embeds a model name', () => {
    const description =
      'Meet Galaxy S24 Ultra. Built for reliable all-day performance.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe(
      'Meet Galaxy S24 Ultra. Built for reliable all-day performance.'
    );
  });

  it('extracts prose from paragraphs with nested inline formatting', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Built for <strong>reliable</strong> all-day performance.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('treats labeled technical values with connectors as specs not prose', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Storage: 2TB SSD and 64GB RAM.</p><p>Built for reliable all-day performance.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('filters bare catalog titles with embedded alphanumeric model tokens', () => {
    const description = 'Galaxy S24 Ultra. Storage: 256GB.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('');
  });

  it('preserves marketing prose that starts with an embedded model name', () => {
    const description = 'Galaxy S24 Ultra unlocks creativity.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Galaxy S24 Ultra unlocks creativity.');
  });

  it('filters lowercase enum catalog values for common specification labels', () => {
    const description =
      'Color: silver. Platform: ios. Connectivity: wifi. Built for reliable all-day performance.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('filters multiword enum catalog values for common specification labels', () => {
    const description =
      'Color: space gray. Platform: playstation 5. Connectivity: dual sim. Built for reliable all-day performance.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('filters standalone availability status metadata', () => {
    const description =
      'Availability: in stock. Built for reliable all-day performance.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('extracts worth paragraph when the paragraph tag has attributes', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p class="lead">Built for reliable performance.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Built for reliable performance.');
  });

  it('extracts the second paragraph when the paragraph tag has attributes', () => {
    const html =
      '<p>Storage: 256GB.</p><p data-testid="benefit">Built for reliable performance.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Built for reliable performance.');
  });

  it('preserves marketing prose that mentions trademarked feature names', () => {
    const description = 'Retina® display brings stunning clarity.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Retina® display brings stunning clarity.');
  });

  it('still filters bare catalog titles that include trademark symbols', () => {
    const description =
      'iPhone 15 Pro Max®. Built for reliable all-day performance.';
    const result = buildDescriptionExcerpt(description);
    expect(result).toBe('Built for reliable all-day performance.');
  });

  it('returns the full text without appending "..." when the match is 200 chars or fewer', () => {
    const shortText = '<h2>Why It Worth</h2><p>Short benefit text.</p>';
    const result = buildDescriptionExcerpt(shortText);
    expect(result).toBe('Short benefit text.');
    expect(result.endsWith('...')).toBe(false);
  });

  it('truncates to 200 chars and appends "..." when the matched text is longer', () => {
    const longBenefit = 'A'.repeat(210);
    const html = `<h2>Why It Worth</h2><p>${longBenefit}</p>`;
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe(`${'A'.repeat(200)}...`);
    expect(result.length).toBe(203);
  });

  it('returns an empty string for empty input', () => {
    const result = buildDescriptionExcerpt('');
    expect(result).toBe('');
  });

  it('filters out redundant spec key-value sentences and returns empty when description is purely specs', () => {
    const specDump =
      'Dell XPS 16 9650. Storage: 2TB PCIe® NVMe™ SSD ( UPGRADABLE). RAM: 64GB RAM (ONBOARD – NON-UPGRADABLE). Colour: Platinum. Condition: New.';
    const result = buildDescriptionExcerpt(specDump);
    expect(result).toBe('');
  });

  it('preserves marketing descriptions that include actual prose content', () => {
    const prose =
      'iPhone 15 Pro Max. Forged in titanium and featuring the groundbreaking A17 Pro chip. Customizable Action button and powerful camera system.';
    const result = buildDescriptionExcerpt(prose);
    expect(result).toBe(
      'Forged in titanium and featuring the groundbreaking A17 Pro chip. Customizable Action button and powerful camera system.'
    );
  });

  it('preserves title-case marketing values that would otherwise look like catalog labels', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Camera: Great Photos.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Camera: Great Photos.');
  });

  it('decodes common HTML entities after stripping tags', () => {
    const html =
      '<h2>Why It is Worth Buying</h2><p>Speed &amp;amp; battery&amp;nbsp;built for creators.</p>';
    const result = buildDescriptionExcerpt(html);
    expect(result).toBe('Speed & battery built for creators.');
    expect(result).not.toContain('&amp;');
    expect(result).not.toContain('&nbsp;');
  });
});
