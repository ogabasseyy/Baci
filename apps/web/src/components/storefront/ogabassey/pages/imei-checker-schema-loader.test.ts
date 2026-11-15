import { expect, it } from 'vitest';
import { loadImeiResultSchema } from './imei-checker-schema-loader';

it('loads the shared report validator on demand', async () => {
  const schema = await loadImeiResultSchema();
  expect(schema.safeParse({}).success).toBe(false);
});
