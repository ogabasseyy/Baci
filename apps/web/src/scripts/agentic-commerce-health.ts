import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';
import { GET as runAgenticCommerceHealthRoute } from '@/app/api/cron/agentic-commerce-health/route';
import { getCronSecret } from '@/env';

export async function runAgenticCommerceHealthCli(): Promise<number> {
  const cronSecret = getCronSecret() ?? process.env.CRON_SECRET;
  const request = new NextRequest(
    'https://internal.baci.local/api/cron/agentic-commerce-health',
    {
      headers: cronSecret
        ? { Authorization: `Bearer ${cronSecret}` }
        : undefined,
    }
  );
  const response = await runAgenticCommerceHealthRoute(request);
  const body = await response.text();
  if (body) {
    console.log(body);
  }
  return response.status >= 400 ? 1 : 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runAgenticCommerceHealthCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error
      );
      process.exitCode = 1;
    });
}
