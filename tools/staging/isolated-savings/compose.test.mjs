import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeTemplate } from './compose.mjs';

const composeAvailable =
  spawnSync('docker', ['compose', 'version'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  }).status === 0;

test('preloaded workers cannot execute migrated cron jobs or queued HTTP requests', () => {
  const command = composeTemplate().services.db.command;
  assert.ok(command.includes('cron.launch_active_jobs=off'));
  assert.ok(command.includes('pg_net.database_name=baci_disabled_background'));
});

test('query statistics cannot retain staging SQL or utility command contents', () => {
  const command = composeTemplate().services.db.command;
  assert.ok(command.includes('pg_stat_statements.track=none'));
  assert.ok(command.includes('pg_stat_statements.track_utility=off'));
});

test('bootstrap disables optional service roles only when the pinned image contains them', () => {
  const sql = readFileSync(new URL('./bootstrap.sql', import.meta.url), 'utf8');
  assert.match(sql, /FROM pg_roles\s+WHERE rolname IN/);
  assert.match(sql, /\\gexec/);
  assert.doesNotMatch(sql, /ALTER USER supabase_functions_admin NOLOGIN/);
});

test('Auth migrations can replace image-provided helpers without superuser access', () => {
  const sql = readFileSync(new URL('./bootstrap.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER SCHEMA auth OWNER TO supabase_auth_admin/);
  for (const name of ['uid', 'role', 'email']) {
    assert.ok(
      sql.includes(
        `ALTER FUNCTION auth.${name}() OWNER TO supabase_auth_admin;`
      )
    );
  }
  assert.doesNotMatch(
    sql,
    /ALTER (?:USER|ROLE) supabase_auth_admin.*SUPERUSER/
  );
});

test('contains only the pinned official service dependency closure', () => {
  const { services } = composeTemplate();
  assert.deepEqual(Object.keys(services), ['db', 'auth', 'rest', 'mail']);
  assert.deepEqual(
    Object.values(services).map((service) => service.image),
    [
      'supabase/postgres:17.6.1.136',
      'supabase/gotrue:v2.196.0',
      'postgrest/postgrest:v14.17',
      'axllent/mailpit:v1.31.1',
    ]
  );
  for (const service of Object.values(services)) {
    assert.equal(service.restart, 'no');
    for (const dependency of Object.keys(service.depends_on ?? {})) {
      assert.ok(services[dependency]);
    }
    assert.ok(
      service.mem_limit &&
        service.memswap_limit &&
        service.cpus &&
        service.pids_limit
    );
    assert.equal(service.logging.driver, 'none');
    assert.ok(service.healthcheck);
    assert.equal(service.privileged, undefined);
    assert.equal(service.network_mode, undefined);
    assert.equal(service.env_file, undefined);
  }
});

test('isolates every network and publishes only loopback Auth and REST', () => {
  const { services, networks } = composeTemplate();
  for (const service of Object.values(services)) {
    assert.deepEqual(service.dns, ['127.0.0.1']);
    for (const network of service.networks)
      assert.equal(networks[network].internal, true);
  }
  assert.equal(services.db.ports, undefined);
  assert.equal(services.mail.ports, undefined);
  assert.deepEqual(services.auth.ports, ['127.0.0.1:15439:9999']);
  assert.deepEqual(services.rest.ports, ['127.0.0.1:15430:3000']);
  assert.deepEqual(services.mail.networks, ['mail']);
  assert.deepEqual(services.db.networks, ['database']);
});

test('uses only internal database and mail destinations without inherited provider configuration', () => {
  const { services } = composeTemplate();
  assert.match(
    services.auth.environment.GOTRUE_DB_DATABASE_URL,
    /@db:5432\/postgres$/
  );
  assert.match(services.rest.environment.PGRST_DB_URI, /@db:5432\/postgres$/);
  assert.equal(services.auth.environment.GOTRUE_SMTP_HOST, 'mail');
  assert.equal(services.auth.environment.GOTRUE_MAILER_AUTOCONFIRM, 'false');
  assert.equal(services.auth.environment.GOTRUE_DISABLE_SIGNUP, 'true');
  assert.equal(
    services.auth.environment.GOTRUE_EXTERNAL_PHONE_ENABLED,
    'false'
  );
  assert.equal(
    services.auth.environment.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED,
    'false'
  );
  assert.equal(services.mail.environment.MP_SMTP_RELAY_CONFIG, undefined);
  assert.equal(services.mail.environment.MP_SMTP_FORWARD_CONFIG, undefined);
  assert.equal(services.rest.environment.PGRST_ADMIN_SERVER_HOST, 'localhost');
});

test('requires secrets and URLs without any fallback or generated credentials', () => {
  const serialized = JSON.stringify(composeTemplate());
  const variables = [...serialized.matchAll(/\$\{([^}]+)\}/g)].map(
    (match) => match[1]
  );
  assert.ok(variables.length > 4);
  assert.ok(
    variables.every((variable) =>
      /^ISOLATED_[A-Z_]+:\?Secure setup required: ISOLATED_[A-Z_]+$/.test(
        variable
      )
    )
  );
  assert.equal(serialized.includes('staging.ogabassey.com'), false);
  assert.equal(serialized.includes('staging-auth.ogabassey.com'), false);
  assert.equal(serialized.includes('supabase.co'), false);
});

test('persists database and encryption configuration and mounts only the reviewed bootstrap', () => {
  const { services, volumes } = composeTemplate();
  assert.deepEqual(Object.keys(volumes), ['db-data', 'db-config']);
  assert.equal(services.db.volumes[0], 'db-data:/var/lib/postgresql/data');
  assert.equal(services.db.volumes[1], 'db-config:/etc/postgresql-custom');
  const mount = services.db.volumes[2];
  assert.equal(mount.read_only, true);
  assert.equal(mount.bind.create_host_path, false);
  const sql = readFileSync(mount.source, 'utf8');
  assert.match(sql, /ON_ERROR_STOP on/);
  assert.match(sql, /ALTER USER authenticator WITH PASSWORD :'restpass'/);
  assert.match(sql, /ALTER USER supabase_auth_admin WITH PASSWORD :'authpass'/);
  assert.doesNotMatch(sql, /POSTGRES_PASSWORD/);
  assert.doesNotMatch(sql, /https?:|CREATE TABLE|COPY |INSERT INTO/);
});

test('Compose parses the template offline without interpolation or container execution', {
  skip: !composeAvailable && 'Docker Compose plugin unavailable',
}, () => {
  const output = execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      '/dev/null',
      '-f',
      '-',
      'config',
      '--no-interpolate',
      '--no-env-resolution',
      '--format',
      'json',
    ],
    {
      input: JSON.stringify(composeTemplate()),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    }
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.name, 'baci-isolated-savings');
  assert.equal(parsed.networks.database.internal, true);
  assert.equal(parsed.services.auth.ports[0].host_ip, '127.0.0.1');
});

test('Compose fails closed when secure setup is absent', {
  skip: !composeAvailable && 'Docker Compose plugin unavailable',
}, () => {
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', '/dev/null', '-f', '-', 'config', '--quiet'],
    {
      input: JSON.stringify(composeTemplate()),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Secure setup required/);
});

test('Auth and REST never receive root credentials and bootstrap has separate role secrets', () => {
  const { services } = composeTemplate();
  const auth = JSON.stringify(services.auth.environment);
  const rest = JSON.stringify(services.rest.environment);
  assert.doesNotMatch(
    auth,
    /ISOLATED_POSTGRES_PASSWORD|ISOLATED_REST_DB_PASSWORD/
  );
  assert.doesNotMatch(
    rest,
    /ISOLATED_POSTGRES_PASSWORD|ISOLATED_AUTH_DB_PASSWORD/
  );
  assert.match(auth, /ISOLATED_AUTH_DB_PASSWORD/);
  assert.match(rest, /ISOLATED_REST_DB_PASSWORD/);
  assert.notEqual(
    services.db.environment.POSTGRES_PASSWORD,
    services.db.environment.ISOLATED_AUTH_DB_PASSWORD
  );
  assert.notEqual(
    services.db.environment.POSTGRES_PASSWORD,
    services.db.environment.ISOLATED_REST_DB_PASSWORD
  );
});

test('server Auth external path and explicitly validated issuer are separate settings', () => {
  const settings = composeTemplate().services.auth.environment;
  assert.match(settings.API_EXTERNAL_URL, /ISOLATED_API_ORIGIN.*\/auth\/v1$/);
  assert.match(settings.GOTRUE_JWT_ISSUER, /ISOLATED_AUTH_ISSUER/);
});

test('suppresses SQL and parameter-bearing error logs while preserving health checks', () => {
  const { services } = composeTemplate();
  for (const service of Object.values(services)) {
    assert.equal(service.logging.driver, 'none');
    assert.ok(service.healthcheck.test.length);
  }
  for (const setting of [
    'log_min_error_statement=panic',
    'log_parameter_max_length_on_error=0',
    'logging_collector=off',
  ]) {
    assert.ok(services.db.command.includes(setting));
  }
});

test('renderer emits only a template and rejects execution or destination arguments', () => {
  const script = fileURLToPath(new URL('./render.mjs', import.meta.url));
  assert.deepEqual(
    JSON.parse(
      execFileSync(process.execPath, [script, '--template'], {
        encoding: 'utf8',
      })
    ),
    composeTemplate()
  );
  for (const argument of ['--deploy', '--up', 'postgres://production']) {
    const result = spawnSync(process.execPath, [script, argument], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});
