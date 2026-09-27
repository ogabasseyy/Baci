import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';

export async function buildRegistration(directory: string, projectId: string) {
  if (!/^prj_[A-Za-z0-9_]+$/.test(projectId)) {
    throw new Error('A staging Vercel project ID is required');
  }

  const output = join(directory, '.vercel/output');
  await mkdir(join(directory, '.vercel'), { recursive: true });
  await mkdir(output);
  const functionDirectory = join(
    output,
    'functions/api/webhooks/piggyvest.func'
  );
  await mkdir(functionDirectory, { recursive: true });
  const source = await readFile(
    join(import.meta.dirname, 'registration-handler.ts'),
    'utf8'
  );
  await writeFile(
    join(functionDirectory, 'index.mjs'),
    stripTypeScriptTypes(source)
  );
  await writeFile(
    join(functionDirectory, '.vc-config.json'),
    JSON.stringify({
      runtime: 'nodejs24.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      maxDuration: 5,
      environment: {
        PVB_INTEGRATION_ENV: 'staging',
        PVB_STAGING_REGISTRATION_PROJECT_ID: projectId,
      },
    })
  );
  await writeFile(join(output, 'config.json'), JSON.stringify({ version: 3 }));
  return output;
}
