import { describe, expect, it } from 'vitest';
import { extractCapacitySpecRole } from './ogabassey-catalog-agent-spec-role';

function roleFor(text: string, token: string) {
  const start = text.indexOf(token);
  const unit = token.replace(/[\d.\s-]+/g, '');
  return extractCapacitySpecRole(text, start, start + token.length, unit);
}

describe('ogabassey-catalog-agent-spec-role', () => {
  it('binds capacity roles by closest attachment on both sides and ignores non-capacity units', () => {
    expect(roleFor('256GB internal memory', '256GB')).toBe('storage');
    expect(roleFor('8GB DDR4 RAM', '8GB')).toBe('ram');
    expect(roleFor('8GB RAM with SSD storage', '8GB')).toBe('ram');
    expect(roleFor('RAM: 8GB and storage: 256GB', '8GB')).toBe('ram');
    expect(roleFor('RAM: 8GB and storage: 256GB', '256GB')).toBe('storage');
    expect(roleFor('RAM 8GB Storage 256GB', '8GB')).toBe('ram');
    expect(roleFor('RAM 8GB Storage 256GB', '256GB')).toBe('storage');
    expect(roleFor('8GB RAM 256GB Storage', '8GB')).toBe('ram');
    expect(roleFor('8GB RAM 256GB Storage', '256GB')).toBe('storage');
    expect(roleFor('8GB RAM 256GB', '256GB')).toBeUndefined();
    expect(
      roleFor('Apple iPhone 16 256GB RAM 8GB; OLED display Phones', '256GB')
    ).toBeUndefined();
    expect(
      roleFor('Apple iPhone 16 256GB RAM 8GB; OLED display Phones', '8GB')
    ).toBe('ram');
    expect(roleFor('Storage 32GB RAM 4GB', '32GB')).toBe('storage');
    expect(roleFor('Storage 32GB RAM 4GB', '4GB')).toBe('ram');
    expect(roleFor('RAM 64GB Storage 1TB', '64GB')).toBe('ram');
    expect(roleFor('RAM 64GB Storage 1TB', '1TB')).toBe('storage');
    expect(roleFor('16GB RAM 512GB SSD', '16GB')).toBe('ram');
    expect(roleFor('16GB RAM 512GB SSD', '512GB')).toBe('storage');
    expect(roleFor('Storage 32GB RAM 4GB DDR3', '32GB')).toBe('storage');
    expect(roleFor('Storage: 1TB; 8GB RAM 256GB - SSD', '256GB')).toBe(
      'storage'
    );
    expect(roleFor('64GB RAM 16GB VRAM', '64GB')).toBe('ram');
    expect(roleFor('64GB RAM 3200MHz', '64GB')).toBe('ram');
    expect(
      roleFor('Apple iPhone 16 256GB RAM 8GB LPDDR5 Storage 512GB', '256GB')
    ).toBeUndefined();
    expect(roleFor('DDR4 8GB RAM 256GB - SSD', '256GB')).toBe('storage');
    expect(
      roleFor('Apple iPhone 7 32GB RAM 2GB; LCD display Phones', '32GB')
    ).toBeUndefined();
    expect(
      roleFor('Apple iPhone 7 32GB RAM 2GB; LCD display Phones', '2GB')
    ).toBe('ram');
    expect(roleFor('32GB RAM', '32GB')).toBe('ram');
    expect(roleFor('64GB RAM 16GB of storage', '16GB')).toBe('storage');
    expect(roleFor('256GB SSD 1TB HDD', '256GB')).toBe('storage');
    expect(roleFor('256GB SSD 1TB HDD', '1TB')).toBe('storage');
    expect(roleFor('8GB RAM and a 120Hz display', '120Hz')).toBeUndefined();
  });
});
