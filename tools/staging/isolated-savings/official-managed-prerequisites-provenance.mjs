import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function verifyOfficialManagedProvenance(fetchSource = fetch) {
  const manifest = JSON.parse(
    readFileSync(
      new URL('./official-managed-prerequisites-sources.json', import.meta.url),
      'utf8'
    )
  );
  const texts = {};
  for (const source of manifest.sources) {
    const expectedUrl = `https://raw.githubusercontent.com/${source.repo}/${source.revision}/${source.path}`;
    if (
      !/^[a-f0-9]{40}$/.test(source.revision) ||
      source.url !== expectedUrl ||
      ![
        'supabase/postgres',
        'supabase/auth',
        'supabase/realtime',
        'supabase/pg_net',
        'citusdata/pg_cron',
      ].includes(source.repo)
    )
      throw new Error('Unpinned official source');
    const response = await fetchSource(source.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || response.redirected)
      throw new Error('Official source unavailable');
    const body = await response.text();
    if (createHash('sha256').update(body).digest('hex') !== source.sha256)
      throw new Error('Official source hash mismatch');
    texts[source.id] = body;
  }
  const asset = (name) =>
    readFileSync(
      new URL(`./official-managed-prerequisites-${name}.sql`, import.meta.url),
      'utf8'
    ).trim();
  const auth = texts.auth
    .slice(texts.auth.indexOf('create or replace function'))
    .replaceAll('{{ index .Options "Namespace" }}', 'auth')
    .trim();
  const start = texts.postgresSchema.indexOf(
    'CREATE FUNCTION graphql_public.graphql('
  );
  const graphql = texts.postgresSchema
    .slice(start, texts.postgresSchema.indexOf('$$;', start) + 3)
    .trim();
  const messages = texts.messages
    .match(
      /CREATE TABLE IF NOT EXISTS realtime.messages_new \([\s\S]*?\) PARTITION BY RANGE \(inserted_at\)/
    )[0]
    .replace('IF NOT EXISTS realtime.messages_new', 'realtime.messages')
    .replace(
      'id BIGSERIAL,\n          uuid TEXT DEFAULT gen_random_uuid(),',
      'id UUID NOT NULL DEFAULT gen_random_uuid(),'
    );
  if (
    !texts.uuid.includes(
      'add(:id, :uuid, null: false, default: fragment("gen_random_uuid()"))'
    )
  )
    throw new Error('Official UUID migration changed');
  const topic = texts.topic.match(
    /create or replace function realtime.topic\(\)[\s\S]*?\$\$ language sql stable;/
  )[0];
  if (
    asset('auth') !== auth ||
    asset('graphql') !== graphql ||
    asset('realtime') !== `${messages};\n\n${topic}`
  )
    throw new Error('Official SQL projection mismatch');
  return Object.freeze({
    sourcesVerified: manifest.sources.length,
    sqlProjectionVerified: true,
  });
}
