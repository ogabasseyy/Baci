import { FIRST_RELEASE_COHORT_PART_1 } from './first-release-guide-cohort-part1';
import { FIRST_RELEASE_COHORT_PART_2 } from './first-release-guide-cohort-part2';
import type { FirstReleaseCohortPdpEntry } from './first-release-guide-cohort-types';

export { REVIEWED_COHORT_POSTS } from './first-release-reviewed-posts';

export const FIRST_RELEASE_GUIDE_COHORT: FirstReleaseCohortPdpEntry[] = [
  ...FIRST_RELEASE_COHORT_PART_1,
  ...FIRST_RELEASE_COHORT_PART_2,
];
