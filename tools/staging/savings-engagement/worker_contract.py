from urllib.parse import parse_qs, quote, unquote, urlsplit


ACCOUNT = 'baci-savings-notifications'
GROUP = ACCOUNT
DATABASE_ROLE = 'baci_savings_notifications_worker'
DATABASE = 'postgres'
CONTAINER = 'baci-isolated-savings-db-1'
SYSTEM_IDENTIFIER = '7685292944002592802'
EXPIRES_AT = '2026-09-29T15:59:10Z'
EXPIRY_EPOCH = 1790697550
WORKER_PATH = '/opt/baci-savings-notifications/worker.mjs'
SERVICE = 'baci-savings-notifications.service'
TIMER = 'baci-savings-notifications.timer'
DEADLINE_SERVICE = 'baci-savings-notifications-deadline.service'
DEADLINE_TIMER = 'baci-savings-notifications-deadline.timer'
CHECK_SERVICE = 'baci-savings-notifications-check.service'
SECRET_PATH = '/etc/baci/piggyvest-staging/notifications/database-url'
CA_PATH = '/etc/baci/piggyvest-staging/postgres-ca.pem'
CA_CREDENTIAL = '/opt/baci-savings-notifications/postgres-ca.pem'
DSN_HOST = 'piggyvest-db.staging.baci.internal'


class InstallError(RuntimeError):
    pass


def service_unit(description: str, check_only: bool = False) -> bytes:
    check_argument = ' --check' if check_only else ''
    return f'''[Unit]
Description={description}
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User={ACCOUNT}
Group={GROUP}
WorkingDirectory=/opt/baci-savings-notifications
LoadCredential=db-url:{SECRET_PATH}
ExecCondition=/bin/sh -c '[ "$(/usr/bin/date -u +%%s)" -lt {EXPIRY_EPOCH} ]'
ExecStart=/bin/sh -eu -c 'export SAVINGS_NOTIFICATIONS_DATABASE_URL="$(/usr/bin/cat "$CREDENTIALS_DIRECTORY/db-url")"; export SAVINGS_NOTIFICATIONS_DATABASE_NAME=postgres SAVINGS_NOTIFICATIONS_ENABLED=true; exec /usr/bin/node /opt/baci-savings-notifications/worker.mjs{check_argument}'
TimeoutStartSec=75s
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictRealtime=yes
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0077
StandardOutput=journal
StandardError=journal
Restart=no
'''.encode()


def unit_files() -> dict[str, bytes]:
    service = service_unit('Baci savings notification delivery worker')
    check_service = service_unit('Read-only Baci savings notification health check', check_only=True)
    timer = f'''[Unit]
Description=Run Baci savings notifications every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
AccuracySec=1s
Unit={SERVICE}

[Install]
WantedBy=timers.target
'''.encode()
    deadline_service = f'''[Unit]
Description=Stop Baci savings notifications at the approved expiry

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl stop {TIMER} {SERVICE} {CHECK_SERVICE}
'''.encode()
    deadline_timer = f'''[Unit]
Description=Expire Baci savings notification scheduling

[Timer]
OnCalendar=2026-09-29 15:59:10 UTC
AccuracySec=1s
Persistent=true
Unit={DEADLINE_SERVICE}

[Install]
WantedBy=timers.target
'''.encode()
    return {
        SERVICE: service,
        TIMER: timer,
        DEADLINE_SERVICE: deadline_service,
        DEADLINE_TIMER: deadline_timer,
        CHECK_SERVICE: check_service,
    }


def database_url(password: str) -> str:
    encoded_password = quote(password, safe='')
    encoded_ca = quote(CA_CREDENTIAL, safe='/')
    return (
        f'postgresql://{DATABASE_ROLE}:{encoded_password}@{DSN_HOST}:5432/{DATABASE}'
        f'?sslmode=verify-full&sslrootcert={encoded_ca}'
    )


def validate_database_url(value: bytes) -> str:
    try:
        text = value.decode('ascii').strip()
        parsed = urlsplit(text)
        query = parse_qs(parsed.query, strict_parsing=True)
    except (UnicodeDecodeError, ValueError) as error:
        raise InstallError('Existing database credential is malformed') from error
    if (
        parsed.scheme != 'postgresql'
        or parsed.username != DATABASE_ROLE
        or not parsed.password
        or parsed.hostname != DSN_HOST
        or parsed.port != 5432
        or parsed.path != f'/{DATABASE}'
        or parsed.fragment
        or query != {'sslmode': ['verify-full'], 'sslrootcert': [CA_CREDENTIAL]}
    ):
        raise InstallError('Existing database credential does not match fixed target')
    return unquote(parsed.password)


def _role_guard() -> str:
    return f'''DO $worker_guard$
DECLARE
  worker_oid oid;
  allowed oid[];
BEGIN
  IF current_database() <> '{DATABASE}'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '{SYSTEM_IDENTIFIER}'
    OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong staging database identity';
  END IF;

  SELECT oid INTO worker_oid FROM pg_catalog.pg_roles WHERE rolname = '{DATABASE_ROLE}';
  IF worker_oid IS NULL THEN RAISE EXCEPTION 'Worker role is missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE oid = worker_oid
      AND (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication
           OR rolbypassrls OR rolconfig IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = worker_oid OR roleid = worker_oid
  ) THEN RAISE EXCEPTION 'Worker role attributes or memberships are unsafe'; END IF;

  allowed := ARRAY[
    to_regprocedure('savings_notifications.enqueue_due()'),
    to_regprocedure('savings_notifications.claim_push(integer)'),
    to_regprocedure('savings_notifications.finish_push(uuid,text,uuid,text,text)'),
    to_regprocedure('savings_notifications.pending_receipts(integer)'),
    to_regprocedure('savings_notifications.record_receipt(text,text,text)')
  ]::oid[];
  IF array_position(allowed, NULL) IS NOT NULL
    OR NOT has_schema_privilege(worker_oid, 'savings_notifications', 'USAGE')
    OR has_schema_privilege(worker_oid, 'savings_notifications', 'CREATE')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace schema
      CROSS JOIN LATERAL aclexplode(coalesce(schema.nspacl,
        acldefault('n'::"char", schema.nspowner))) grant_row
      WHERE schema.nspname = 'savings_notifications' AND grant_row.grantee = worker_oid
        AND grant_row.privilege_type <> 'USAGE'
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc function_row
      CROSS JOIN LATERAL aclexplode(coalesce(function_row.proacl,
        acldefault('f'::"char", function_row.proowner))) grant_row
      WHERE grant_row.grantee = worker_oid AND grant_row.privilege_type = 'EXECUTE'
        AND function_row.oid <> ALL(allowed)
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc function_row WHERE function_row.oid = ANY(allowed)
        AND NOT has_function_privilege(worker_oid, function_row.oid, 'EXECUTE')
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc function_row
      JOIN pg_catalog.pg_namespace function_schema ON function_schema.oid = function_row.pronamespace
      WHERE function_row.prosecdef AND function_row.oid <> ALL(allowed)
        AND has_schema_privilege(worker_oid, function_schema.oid, 'USAGE')
        AND has_function_privilege(worker_oid, function_row.oid, 'EXECUTE')
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_class relation
      CROSS JOIN LATERAL aclexplode(coalesce(relation.relacl, acldefault(
        CASE WHEN relation.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
        relation.relowner))) grant_row
      WHERE relation.relkind IN ('r','p','v','m','f','S')
        AND (relation.relowner = worker_oid OR (grant_row.grantee = worker_oid
        AND grant_row.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
          'REFERENCES','TRIGGER','USAGE')))
    )
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_database db
      CROSS JOIN LATERAL aclexplode(coalesce(db.datacl,
        acldefault('d'::"char", db.datdba))) grant_row
      WHERE db.datname = current_database() AND grant_row.grantee = worker_oid
        AND grant_row.privilege_type IN ('CREATE','TEMP')
    ) THEN RAISE EXCEPTION 'Worker role has privileges outside the function-only contract';
  END IF;
END
$worker_guard$;
'''


def role_preflight_sql() -> str:
    return _role_guard() + (
        "SELECT CASE WHEN rolcanlogin THEN 'LOGIN' ELSE 'NOLOGIN' END AS role_state "
        f"FROM pg_catalog.pg_roles WHERE rolname = '{DATABASE_ROLE}' \\gset\n"
        "\\echo BACI_WORKER_ROLE=:role_state\n"
    )


def provision_sql(password: str, allow_existing_login: bool) -> str:
    quoted_password = "'" + password.replace("'", "''") + "'"
    allow_login = 'true' if allow_existing_login else 'false'
    return (
        "SET log_statement = 'none';\n"
        "SET log_min_error_statement = 'panic';\n"
        "BEGIN;\n"
        + _role_guard()
        + f'''DO $worker_enable$
DECLARE
  worker_role record;
BEGIN
  SELECT rolcanlogin, rolvaliduntil INTO worker_role
  FROM pg_catalog.pg_authid WHERE rolname = '{DATABASE_ROLE}' FOR UPDATE;
  IF worker_role.rolcanlogin THEN
    IF NOT {allow_login}::boolean OR worker_role.rolvaliduntil IS DISTINCT FROM
      TIMESTAMPTZ '2026-09-29 15:59:10+00' THEN
      RAISE EXCEPTION 'Existing worker login does not match fixed configuration';
    END IF;
  ELSE
    ALTER ROLE {DATABASE_ROLE} LOGIN PASSWORD {quoted_password}
      VALID UNTIL '2026-09-29 15:59:10+00';
  END IF;
END
$worker_enable$;
COMMIT;
\\echo BACI_WORKER_ROLE_PROVISIONED
'''
    )
