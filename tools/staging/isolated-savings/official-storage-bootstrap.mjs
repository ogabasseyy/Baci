export function officialStorageBootstrap(evidence, now) {
  const reject = () => { throw new Error('Official Storage bootstrap evidence rejected'); };
  if (!evidence || Object.keys(evidence).sort().join(',') !== 'db,network,observedAt,reviewed') reject();
  const observed = Date.parse(evidence.observedAt);
  if (!Number.isSafeInteger(now) || !Number.isFinite(observed) || now < observed || now - observed > 300000 || evidence.reviewed !== true) reject();
  const { db, network } = evidence;
  if (!db || !network || !/^[a-f0-9]{64}$/.test(db.id) || !/^[a-f0-9]{64}$/.test(network.id)) reject();
  if (db.image !== 'supabase/postgres:17.6.1.136' || db.project !== 'baci-isolated-savings' || db.service !== 'db' || db.healthy !== true || db.networkId !== network.id) reject();
  if (network.name !== 'baci-isolated-savings_database' || network.project !== 'baci-isolated-savings' || network.internal !== true || network.bridge !== 'baci-stg-db') reject();
  const required = (name) => `\${${name}:?Secure staging setup required: ${name}}`;
  return {
    name: 'baci-isolated-savings',
    services: {
      'storage-bootstrap': {
        image: 'supabase/storage-api:v1.74.0',
        command: ['node', 'dist/scripts/migrate-call.js'],
        working_dir: '/app',
        restart: 'no',
        profiles: ['official-storage-bootstrap'],
        networks: ['database'],
        dns: ['127.0.0.1'],
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        read_only: true,
        tmpfs: ['/tmp:size=32m,mode=1777'],
        mem_limit: '512m',
        memswap_limit: '512m',
        cpus: 0.5,
        pids_limit: 64,
        logging: { driver: 'none' },
        environment: {
          DATABASE_URL: `postgres://baci_storage_initializer:${required('ISOLATED_STORAGE_DB_PASSWORD')}@db:5432/postgres`,
          AUTH_JWT_SECRET: required('ISOLATED_JWT_SECRET'),
          DB_INSTALL_ROLES: 'false',
          DB_SUPER_USER: 'baci_storage_initializer',
          DB_ALLOW_MIGRATION_REFRESH: 'false',
          MULTI_TENANT: 'false',
          PG_QUEUE_ENABLE: 'false',
          PG_QUEUE_WORKERS_ENABLE: 'false',
          VECTOR_STORE_MIGRATIONS_ENABLED: 'false',
          VECTOR_DATABASE_CREATE: 'false',
          STORAGE_BACKEND: 'file',
          FILE_STORAGE_BACKEND_PATH: '/tmp/storage',
          ENABLE_IMAGE_TRANSFORMATION: 'false',
          AWS_EC2_METADATA_DISABLED: 'true',
          OTEL_SDK_DISABLED: 'true',
          LOG_LEVEL: 'silent',
        },
      },
    },
    networks: { database: { external: true, name: network.name } },
  };
}
