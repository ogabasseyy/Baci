import { describe, expect, it } from 'vitest';
import { filterComparisonGuides } from './filter-comparison-guides';

const guide = (title: string) => ({
  title,
  href: `https://example.com/${title}`,
  description: 'Guide',
});
describe('filterComparisonGuides', () => {
  it('omits unrelated generational fallback articles', () => {
    const relevant = guide('MacBook M3 Max buying guide');
    expect(
      filterComparisonGuides(
        [guide('MacBook 2015 guide'), relevant],
        ['MacBook Pro 16-inch M2 Max 2023', 'MacBook Pro 16-inch M3 Max 2023']
      )
    ).toEqual([relevant]);
  });
  it('does not confuse Pixel news with AirPods 4 advice', () => {
    const relevant = guide('AirPods 4 ANC or standard?');
    expect(
      filterComparisonGuides(
        [guide('Pixel 4 news'), relevant],
        ['AirPods 4', 'Apple AirPods 4 ANC']
      )
    ).toEqual([relevant]);
  });
});
