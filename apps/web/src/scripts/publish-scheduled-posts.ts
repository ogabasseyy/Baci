import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { publishScheduledPosts } from '@/app/api/cron/publish-scheduled-posts/publish-scheduled-posts-workflow';
import { createServiceClient } from '@/lib/supabase/service';

export async function runPublishScheduledPostsCli(): Promise<number> {
  const response = await publishScheduledPosts(createServiceClient());
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
  runPublishScheduledPostsCli()
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
