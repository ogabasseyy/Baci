// @vitest-environment node
import { expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Disabled boot loaded full experience runtime');
  })
);
vi.mock('./lib/experience/compose-runtime', () => runtime());
it('does not import the full runtime when no local profile has been selected', async () => {
  const { registerExperienceStartup } = await import(
    './instrumentation-experience-boot'
  );
  await registerExperienceStartup();
  expect(runtime).not.toHaveBeenCalled();
});
