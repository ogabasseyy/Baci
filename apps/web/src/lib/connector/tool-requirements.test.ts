import { expect, it } from 'vitest';
import { CONNECTOR_MANIFEST } from './manifest';
import { TOOL_REQUIREMENTS } from './tool-requirements';

it('declares only view permissions for every exposed read-only tool', () => {
  expect(Object.keys(TOOL_REQUIREMENTS).sort()).toEqual(
    CONNECTOR_MANIFEST.map((tool) => tool.name).sort()
  );
  for (const tool of CONNECTOR_MANIFEST) {
    expect(TOOL_REQUIREMENTS[tool.name].action).toBe('view');
    expect(tool.requiredScope).toBe(
      `${TOOL_REQUIREMENTS[tool.name].resource}:read`
    );
  }
});
