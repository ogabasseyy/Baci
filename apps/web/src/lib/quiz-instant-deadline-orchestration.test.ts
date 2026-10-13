import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), '../../supabase/migrations');
const readMigration = (file: string) =>
  readFileSync(resolve(migrationsDirectory, file), 'utf8');

it('schedules the deadline clock only after the gated runner is installed', () => {
  const initialOrchestration = readMigration(
    '20260830193445_quiz_instant_deadline_orchestration_v2.sql'
  );
  const gatedOrchestration = readMigration(
    '20260830204300_quiz_instant_deadline_orchestration_health_v2.sql'
  );

  expect(initialOrchestration).not.toContain('cron.schedule(');
  expect(gatedOrchestration).toContain(
    "'SELECT private.run_quiz_deadline_clock_v2()'"
  );
  expect(gatedOrchestration).toContain('cron.schedule(');
});
