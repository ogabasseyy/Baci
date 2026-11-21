import { createOxygenStagingFetch } from './oxygen-staging-fetch';
import {
  profile,
  token,
  workflowLookup,
} from './oxygen-staging-fetch.test-support';

test.each([
  `${workflowLookup}&select=id`,
  `${workflowLookup}&order=created_at`,
  'select=id&environment=eq.staging',
])('rejects broadened staging workflow lookups (%s)', async (query) => {
  const transport = jest.fn().mockResolvedValue(new Response('{}'));
  const guardedFetch = createOxygenStagingFetch(transport, profile);
  await expect(
    guardedFetch(`${profile.authOrigin}/rest/v1/oxygen_workflows?${query}`, {
      headers: { authorization: `Bearer ${token()}` },
    })
  ).rejects.toThrow('blocked an unapproved request');
  expect(transport).not.toHaveBeenCalled();
});
