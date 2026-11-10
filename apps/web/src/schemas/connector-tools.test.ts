import { expect, it } from 'vitest';
import { connectorTools } from './connector-tools';
import { experienceToolNames } from './experience-tools';

it('defaults to eight legacy tools; trusted profile adds fourteen without mutating either set', () => {
  const legacy = connectorTools();
  expect(legacy).toHaveLength(8);
  expect(connectorTools(true)).toEqual([...legacy, ...experienceToolNames]);
  expect(connectorTools(true)).toContain('read_experience_performance');
  expect(new Set(connectorTools(true)).size).toBe(22);
  legacy.pop();
  expect(connectorTools()).toHaveLength(8);
});
