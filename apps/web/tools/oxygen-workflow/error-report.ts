import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { readOxygenErrorReport } from '../../src/lib/payments/oxygen/error-report';

/** Local operator-only report. Existing ordinary worker credentials; no service role. */
async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      workflow: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: error-report.ts --config /absolute/private/runtime.json --workflow UUID [--out /absolute/report.json]'
    );
    return;
  }
  if (!values.config || !isAbsolute(values.config) || !values.workflow)
    throw new Error('A private runtime config and workflow UUID are required');
  const mode = (await stat(values.config)).mode;
  if ((mode & 0o077) !== 0)
    throw new Error('Runtime config must be accessible only to its owner');
  const config = z
    .object({
      NEXT_PUBLIC_SUPABASE_URL: z.url(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
      OXYGEN_STAGING_WORKER_EMAIL: z.string(),
      OXYGEN_STAGING_WORKER_PASSWORD: z.string(),
    })
    .parse(JSON.parse(await readFile(values.config, 'utf8')));
  const client = createClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        fetch: async (input, init) => {
          try {
            return await fetch(input, init);
          } catch {
            return Response.json(
              { error: 'connection_unavailable' },
              { status: 503 }
            );
          }
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
  const { error } = await client.auth.signInWithPassword({
    email: config.OXYGEN_STAGING_WORKER_EMAIL,
    password: config.OXYGEN_STAGING_WORKER_PASSWORD,
  });
  if (error) throw new Error('Staging worker sign-in failed');
  const attempts = await readOxygenErrorReport(client, values.workflow);
  const report = `${JSON.stringify(
    {
      environment: 'staging',
      workflowId: values.workflow,
      generatedAt: new Date().toISOString(),
      notice:
        'Sanitized attempt evidence; missing historical responses are not reconstructed.',
      attempts,
    },
    null,
    2
  )}\n`;
  if (values.out) {
    if (!isAbsolute(values.out))
      throw new Error('Report output must be an absolute path');
    await writeFile(values.out, report, { mode: 0o600, flag: 'wx' });
    console.log(`Exported ${attempts.length} retained attempts`);
  } else console.log(report);
}
void main().catch(() => {
  console.error(
    'Unable to export diagnostics. Check worker access, workflow ID, private config and output path.'
  );
  process.exitCode = 1;
});
