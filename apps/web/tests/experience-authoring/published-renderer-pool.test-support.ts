import { Pool } from 'pg';
import {
  createPublishedRendererReader,
  rendererDatabaseDeadlines,
} from '../../tools/builder-production/published-renderer-reader';
import type { experienceDataFixture } from './data-fixture.test-support';

export async function setupPublishedRendererPool(
  fixture: Awaited<ReturnType<typeof experienceDataFixture>>
) {
  if (!fixture.db.localDatabase) throw Error('LOCAL_DATABASE_REQUIRED');
  await fixture.db.pool.query(
    'CREATE ROLE baci_experience_renderer_reader_login LOGIN NOINHERIT; GRANT baci_experience_renderer_reader TO baci_experience_renderer_reader_login'
  );
  const pool = new Pool({
    host: fixture.db.localDatabase.socketDirectory,
    user: 'baci_experience_renderer_reader_login',
    database: 'postgres',
    options: '-c role=baci_experience_renderer_reader',
    ...rendererDatabaseDeadlines,
  });
  try {
    const read = await createPublishedRendererReader(pool);
    return { read, pool, close: () => pool.end() };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
