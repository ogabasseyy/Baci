import argparse
import hashlib
import json
from pathlib import Path
PHYSICAL_DATABASE_SYSTEM_IDENTIFIER, EXPIRY = "7685292944002592802", "2026-09-29T15:59:10Z"
SOURCE_MANIFEST = (
    ("storage.sql", "1441c7fd956861b1375f41537f7616f62ea0a35ea113d6b4c82bf60595ffd9d1"),
    ("storage-functions.sql", "7eddf4a0ed7df1613ea4b4a0163438a3f1c85fa3b00182cd9ee114c9d50c5c7f"),
    ("treasury-storage.sql", "cf590f9bda15df2923822f342ae54090acdabb391a7b1c02ebc839b8c0d46ac0"),
    ("treasury-functions.sql", "9be8a0aff4a549b129a121feab5a59606c6ddbfff9405d2916378dc43a069f8d"),
    ("projection-storage.sql", "57688231ca63c642eadc6c66fda82a3fdde33e546da2f4514b0498983cee3479"),
    ("projection-functions.sql", "a39bfe1beb30c88f5132b56d36a6a8c93b696184de6619bd4fc8549445e7cd01"),
    ("projection-inflow-guard.sql", "dccaa68c1efb7738dde744502b74ddc4f27ec8ce8fac72fa9788bb0e936c7089"),
    ("projection-admission.sql", "652d3d2963f95f73ce035b19754d135d12cd0c26ad08da1ebf6eedd65973a1b8"),
    ("authorization-storage.sql", "7b4c6acfc1932665a0cd317a54fb1af4bd127bcd8bee18d605d02ee55f6f65d9"),
    ("authorization-candidate.sql", "58cec1f7c383faf4e37a63a1607f4b128e0f2b8cad64cbf1e346618839d5226a"),
    ("authorization-functions.sql", "77c4197fa2b849a378659c3ca1a40ed827b5592b865bb7ffc75ba56543c569c5"),
    ("customer-consent.sql", "3e462ffb5ee973bae9c49d9e4b548df80dc63479e0768544979fdb4aa58cc275"),
    ("customer-entry.sql", "cc29df516b4045b7b8ec00e6281acd34449d7167ab07d420612b3c8bc97720dd"),
    ("customer-capability.sql", "d0e740e4b83c88236b5c059af2fcc5ba091f3b6c1c0aed9007a1e94d9e2fc542"),
    ("dispatch-queue.sql", "d56cf3bcb3a280b76691ed9288219a769b0e0634838a1dddbeff7695f57eb217"),
    ("evidence-storage.sql", "991f3abba69449c8eaed77fd71bb7bdd796e291dd3efbe7ea6a6b977d5d2570c"),
    ("evidence-projection-storage.sql", "5064ed5d672a213afdaef6a3bd1bfc10f8c8dfd15ee1ca8861ca0a6ac430e50e"),
    ("evidence-conflict.sql", "e8179d132e0236a598f539f6f316db6591d43b232cb75117ae6259498099a195"),
    ("evidence-record.sql", "1d0d9a21d2b4aa2cecde7904bca1b45795e69d12b25f83fb698e160ff3c1d628"),
    ("evidence-transfer.sql", "a3911b0ddccae1fb2d4fe9bd054025991aa005800d0d3eb327c1407a64d402ab"),
    ("evidence-inflow.sql", "875276a8c46cae17528e0a593c21a6132f904c783281d42a07c73d0789c3f55e"),
    ("evidence-projection.sql", "0b31d44a78d1cc18926ab7e535413af1e4de9929ddf8e9df470a64546918c44b"),
    ("evidence-legacy.sql", "3e75466c4b32187504f0997b8a42feffced57b18a117639240ca88d8e2c49f04"),
    ("reversal-storage.sql", "ded0cad46e5b3be1ae4420bcc612ae5bdd0e0072a15a289f3ce4bcd6d679c567"),
    ("reversal-guard.sql", "f60605b8e7c43da31cdfa2ca30468e4ac01cf186c4508c529a2b07477ff658f1"),
    ("reversal-functions.sql", "2bf3ed0395aee3aeea2b1600e2ef34d419c03afb2743ddae30725d399dcc4e06"),
    ("replay-enrollment.sql", "f0b775e8d9301e0c1718b6f79440d8bdd943ebb4fb38107ef342cad85603320b"),
    ("executor-roles.sql", "f4affa3525a003c0504b9b887fc8cac328568aea351427817081614d5a5bfc7a"),
    ("executor-identity.sql", "a5a001127f6af798b4b4b9f8f9f7bd4c8de9fc3a92d4c91b5f787c20be411c82"),
    ("checkout-storage.sql", "a2f04e097b46158d26f4469424dc92b387ecd9494af738ca1c2a0c489661693d"),
    ("checkout-reserve.sql", "aeb3e3fa2fe9a0694bed4f8c943fdaf1a0d1c99f619490610152fbdafff3e088"),
    ("checkout-initialization.sql", "27bb9c2c10ccbeb2eee82a27e4d9aaa5bd5b177c4d8e56ddc1977344714b8cdc"),
    ("checkout-promotion.sql", "7bc492814c213f7bb35bd74704764f79ecda566b55a3d4d068abaec1cbb8f11a"),
    ("checkout-capability.sql", "3a1e61aa4456862e104677e1c30f43d237b6be0e8c855094d163a5b65c0da618"),
    ("checkout-roles.sql", "f2a3d483ad31d0194902d70bbb819fdf94bf3c7a8ba00ff3c84f7cf553530e25"),
    ("checkout-recovery.sql", "75edc85b3f7b76f8501f7799696c017dff5b879f28a3d671d8e25a73b2c0a0d9"),
)
PREREQUISITES = (
    "public.merchants", "public.customers", "public.customer_savings_goals",
    "public.customer_savings_contributions", "public.customer_saved_payment_methods",
    "public.piggyvest_plan_wallets", "public.transactions", "piggyvest_staging.integrations",
    "piggyvest_staging.wallet_goal_mappings", "piggyvest_savings_ledger.bindings",
    "piggyvest_savings_ledger.operations", "piggyvest_savings_ledger.postings",
)
PREREQUISITE_FUNCTIONS = (
    "piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)",
    "piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid)",
    "public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamp with time zone)",
)
REQUIRED_COLUMNS = (
    ("public.merchants", "id", "uuid"), ("public.merchants", "slug", "text"),
    ("public.customers", "id", "uuid"), ("public.customers", "merchant_id", "uuid"),
    ("public.customers", "user_id", "uuid"), ("public.customers", "email", "text"),
    ("public.customer_savings_goals", "id", "uuid"), ("public.customer_savings_goals", "merchant_id", "uuid"),
    ("public.customer_savings_goals", "customer_id", "uuid"), ("public.customer_savings_goals", "target_amount", "numeric"),
    ("public.customer_savings_goals", "current_amount", "numeric"), ("public.customer_savings_goals", "goal_kind", "text"), ("public.customer_savings_goals", "source_mode", "text"),
    ("public.customer_savings_goals", "status", "text"), ("public.customer_savings_goals", "completed_at", "timestamp with time zone"),
    ("public.customer_savings_goals", "cancelled_at", "timestamp with time zone"), ("public.customer_savings_goals", "spent_at", "timestamp with time zone"), ("public.customer_savings_goals", "updated_at", "timestamp with time zone"),
    ("public.customer_savings_contributions", "id", "uuid"), ("public.customer_savings_contributions", "merchant_id", "uuid"),
    ("public.customer_savings_contributions", "customer_id", "uuid"), ("public.customer_savings_contributions", "goal_id", "uuid"),
    ("public.customer_savings_contributions", "amount", "numeric"), ("public.customer_savings_contributions", "status", "text"), ("public.customer_savings_contributions", "processed_at", "timestamp with time zone"),
    ("public.customer_savings_contributions", "source_type", "text"), ("public.customer_savings_contributions", "idempotency_key", "text"), ("public.customer_savings_contributions", "metadata", "jsonb"),
    ("public.customer_saved_payment_methods", "id", "uuid"), ("public.customer_saved_payment_methods", "merchant_id", "uuid"),
    ("public.customer_saved_payment_methods", "customer_id", "uuid"), ("public.customer_saved_payment_methods", "provider", "text"),
    ("public.customer_saved_payment_methods", "provider_customer_email", "text"), ("public.customer_saved_payment_methods", "authorization_code", "text"),
    ("public.customer_saved_payment_methods", "authorization_signature", "text"), ("public.customer_saved_payment_methods", "authorization_data", "jsonb"),
    ("public.customer_saved_payment_methods", "brand", "text"), ("public.customer_saved_payment_methods", "last4", "text"),
    ("public.customer_saved_payment_methods", "exp_month", "text"), ("public.customer_saved_payment_methods", "exp_year", "text"),
    ("public.customer_saved_payment_methods", "reusable", "boolean"), ("public.customer_saved_payment_methods", "is_default", "boolean"),
    ("public.customer_saved_payment_methods", "is_active", "boolean"), ("public.customer_saved_payment_methods", "disabled_at", "timestamp with time zone"),
    ("piggyvest_staging.integrations", "id", "uuid"),
    ("piggyvest_staging.integrations", "expected_provider_account_id", "text"), ("piggyvest_staging.integrations", "enabled", "boolean"),
    ("piggyvest_staging.wallet_goal_mappings", "integration_id", "uuid"), ("piggyvest_staging.wallet_goal_mappings", "merchant_id", "uuid"),
    ("piggyvest_staging.wallet_goal_mappings", "customer_id", "uuid"), ("piggyvest_staging.wallet_goal_mappings", "goal_id", "uuid"),
    ("piggyvest_staging.wallet_goal_mappings", "provider_wallet_id", "text"), ("piggyvest_staging.wallet_goal_mappings", "provider_customer_id", "text"),
    ("piggyvest_savings_ledger.bindings", "integration_id", "uuid"), ("piggyvest_savings_ledger.bindings", "merchant_id", "uuid"),
    ("piggyvest_savings_ledger.bindings", "customer_id", "uuid"), ("piggyvest_savings_ledger.bindings", "goal_id", "uuid"),
    ("piggyvest_savings_ledger.bindings", "enabled", "boolean"), ("piggyvest_savings_ledger.bindings", "authorized_login", "name"),
    ("piggyvest_savings_ledger.operations", "id", "uuid"), ("piggyvest_savings_ledger.operations", "integration_id", "uuid"), ("piggyvest_savings_ledger.operations", "goal_id", "uuid"),
    ("piggyvest_savings_ledger.postings", "operation_id", "uuid"), ("piggyvest_savings_ledger.postings", "account", "text"), ("piggyvest_savings_ledger.postings", "amount_kobo", "bigint"),
    ("public.transactions", "id", "uuid"), ("public.transactions", "merchant_id", "uuid"), ("public.transactions", "gateway", "text"), ("public.transactions", "transaction_type", "text"), ("public.transactions", "status", "text"), ("public.transactions", "currency", "text"), ("public.transactions", "gateway_reference", "text"), ("public.transactions", "metadata", "jsonb"), ("public.transactions", "amount", "numeric"),
    ("public.piggyvest_plan_wallets", "wallet_id", "text"), ("public.piggyvest_plan_wallets", "piggyvest_customer_id", "text"), ("public.piggyvest_plan_wallets", "customer_id", "uuid"), ("public.piggyvest_plan_wallets", "merchant_id", "uuid"),
)
UNIQUE_KEYS = (
    ("public.merchants", ("id",), "public.merchants_id_key"),
    ("public.customers", ("id",), "public.customers_id_key"),
    ("public.customer_savings_goals", ("id",), "public.customer_savings_goals_id_key"),
    ("piggyvest_savings_ledger.bindings", ("integration_id", "merchant_id", "customer_id", "goal_id"), "piggyvest_savings_ledger.bindings_scope_key"),
    ("piggyvest_staging.integrations", ("id",), "piggyvest_staging.integrations_id_key"),
    ("piggyvest_savings_ledger.operations", ("id",), "piggyvest_savings_ledger.operations_id_key"),
    ("public.customer_savings_contributions", ("id",), "public.customer_savings_contributions_id_key"),
    ("public.customer_saved_payment_methods", ("customer_id", "provider", "authorization_signature"), "public.customer_saved_payment_methods_customer_provider_signature_key"),
)
REQUIRED_ROLES = ("anon", "authenticated", "service_role", "pvb_staging_app_worker")
EXECUTOR_ROLES = ("prefunded_treasury_operator", "prefunded_authorizer", "prefunded_evidence")
ALL_BUNDLE_ROLES = EXECUTOR_ROLES + (
    "prefunded_treasury_ledger_worker", "prefunded_card_authorization_reader",
    "prefunded_card_authorization_provisioner",
)
ALLOWED_DIAGNOSTIC_LABELS = tuple(
    f"foundation_missing:{identifier}" for identifier in PREREQUISITES + PREREQUISITE_FUNCTIONS + REQUIRED_ROLES
) + (
    "foundation_missing:installer_createrole",
    "foundation_conflict:physical_database", "foundation_conflict:prefunded_card_schema",
    "foundation_conflict:executor_role_state", "foundation_conflict:executor_table_privilege",
    "foundation_conflict:customer_savings_contributions_source_type_check",
    "foundation_conflict:inactive_rows", f"foundation_expired:{EXPIRY}",
) + tuple(f"foundation_missing:{relation}.{column}" for relation, column, _ in REQUIRED_COLUMNS) + tuple(
    f"foundation_conflict:{relation}.{column}_type" for relation, column, _ in REQUIRED_COLUMNS
) + tuple(f"foundation_conflict:{identifier}" for _, _, identifier in UNIQUE_KEYS)
DIAGNOSTIC_LABELS_JSON = json.dumps({"labels": ALLOWED_DIAGNOSTIC_LABELS, "version": 1}, separators=(",", ":"))
def _type_set(column_type: str) -> str:
    return "'text'::regtype, 'character varying'::regtype" if column_type == "text" else f"'{column_type}'::regtype"

def _source_body(source_dir: Path, name: str, checksum: str) -> str:
    path = source_dir / name
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"foundation_missing:source:{name}")
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != checksum:
        raise ValueError(f"checksum mismatch: {name}")
    text = content.decode("utf-8")
    if text.startswith("BEGIN;\n"):
        if not text.endswith("COMMIT;\n"):
            raise ValueError(f"foundation_conflict:source_transaction:{name}")
        return text.removeprefix("BEGIN;\n").removesuffix("COMMIT;\n")
    if "\nCOMMIT;" in text or text.startswith("COMMIT;"):
        raise ValueError(f"foundation_conflict:source_transaction:{name}")
    return text


def _unique_key_check(relation: str, columns: tuple[str, ...], identifier: str) -> str:
    column_numbers = ", ".join(
        f"(SELECT attnum FROM pg_attribute WHERE attrelid = '{relation}'::regclass AND attname = '{column}' AND NOT attisdropped)"
        for column in columns
    )
    return (
        f"  IF to_regclass('{relation}') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_constraint "
        f"WHERE conrelid = '{relation}'::regclass AND contype IN ('p', 'u') AND conkey = "
        f"ARRAY[{column_numbers}]::smallint[]) THEN labels := array_append(labels, "
        f"'foundation_conflict:{identifier}'); END IF; END IF;"
    )


def _preflight_sql() -> str:
    relation_checks = "\n".join(
        f"  IF to_regclass('{identifier}') IS NULL THEN missing := array_append(missing, '{identifier}'); END IF;"
        for identifier in PREREQUISITES
    )
    function_checks = "\n".join(
        f"  IF to_regprocedure('{identifier}') IS NULL THEN missing := array_append(missing, '{identifier}'); END IF;"
        for identifier in PREREQUISITE_FUNCTIONS
    )
    role_checks = "\n".join(
        f"  IF to_regrole('{identifier}') IS NULL THEN missing := array_append(missing, '{identifier}'); END IF;"
        for identifier in REQUIRED_ROLES
    )
    column_checks = "\n".join(
        f"  IF to_regclass('{relation}') IS NOT NULL THEN IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '{relation}'::regclass AND attname = '{column}' AND NOT attisdropped) THEN missing := array_append(missing, '{relation}.{column}'); ELSIF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '{relation}'::regclass AND attname = '{column}' AND NOT attisdropped AND atttypid = ANY (ARRAY[{_type_set(column_type)}])) THEN labels := array_append(labels, 'foundation_conflict:{relation}.{column}_type'); END IF; END IF;"
        for relation, column, column_type in REQUIRED_COLUMNS
    )
    key_checks = "\n".join(
        _unique_key_check(relation, columns, identifier)
        for relation, columns, identifier in UNIQUE_KEYS
    )
    return f"""-- foundation preflight
DO $foundation_preflight$
DECLARE
  missing text[] := ARRAY[]::text[];
  labels text[] := ARRAY[]::text[];
  contribution_constraint text;
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) <> '{PHYSICAL_DATABASE_SYSTEM_IDENTIFIER}' THEN
    labels := array_append(labels, 'foundation_conflict:physical_database');
  END IF;
  IF clock_timestamp() >= '{EXPIRY}'::timestamptz THEN
    labels := array_append(labels, 'foundation_expired:{EXPIRY}');
  END IF;
{relation_checks}
{function_checks}
{role_checks}
{column_checks}
{key_checks}
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreaterole)) THEN
    missing := array_append(missing, 'installer_createrole');
  END IF;
  IF to_regnamespace('prefunded_card') IS NOT NULL THEN
    labels := array_append(labels, 'foundation_conflict:prefunded_card_schema');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = ANY (ARRAY{list(ALL_BUNDLE_ROLES)!r}::text[])
  ) THEN
    labels := array_append(labels, 'foundation_conflict:executor_role_state');
  END IF;
  IF to_regclass('public.customer_savings_contributions') IS NOT NULL THEN
    SELECT regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]()]|::text(\\[\\])?', '', 'g')
      INTO contribution_constraint
      FROM pg_constraint
      WHERE conrelid = 'public.customer_savings_contributions'::regclass
        AND conname = 'customer_savings_contributions_source_type_check';
    IF contribution_constraint IS NULL OR contribution_constraint NOT IN (
      'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'']',
      'checksource_type=anyarray[''wallet'',''paystack_authorization'',''manual_adjustment'',''piggyvest_inflow'']'
    ) THEN
      labels := array_append(labels, 'foundation_conflict:customer_savings_contributions_source_type_check');
    END IF;
  END IF;
  IF cardinality(missing) > 0 THEN
    SELECT array_agg('foundation_missing:' || identifier ORDER BY identifier) INTO missing FROM unnest(missing) AS identifier;
    labels := labels || missing;
  END IF;
  IF cardinality(labels) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(labels, ',');
  END IF;
END
$foundation_preflight$;
"""


def _postguard_sql() -> str:
    return f"""-- foundation postguard
DO $foundation_postguard$
BEGIN
  IF clock_timestamp() >= '{EXPIRY}'::timestamptz THEN
    RAISE EXCEPTION 'foundation_expired:{EXPIRY}';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = ANY (ARRAY['prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence'])
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'foundation_conflict:executor_role_state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles AS role
    CROSS JOIN pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE role.rolname = ANY (ARRAY['prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence'])
      AND namespace.nspname = 'prefunded_card' AND relation.relkind IN ('r', 'p')
      AND (has_table_privilege(role.oid, relation.oid, 'SELECT') OR has_table_privilege(role.oid, relation.oid, 'INSERT')
        OR has_table_privilege(role.oid, relation.oid, 'UPDATE') OR has_table_privilege(role.oid, relation.oid, 'DELETE'))
  ) THEN
    RAISE EXCEPTION 'foundation_conflict:executor_table_privilege';
  END IF;
  IF (SELECT count(*) FROM prefunded_card.operations) <> 0
    OR (SELECT count(*) FROM prefunded_card.treasury_bindings) <> 0
    OR (SELECT count(*) FROM prefunded_card.checkout_intents) <> 0 THEN
    RAISE EXCEPTION 'foundation_conflict:inactive_rows';
  END IF;
END
$foundation_postguard$;
"""


def build_install_sql(source_dir: Path) -> str:
    sources = [(name, _source_body(source_dir, name, checksum)) for name, checksum in SOURCE_MANIFEST]
    sections = ["BEGIN;\n", "SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';\nSELECT pg_advisory_xact_lock(hashtextextended('prefunded-card-foundation-install-v1', 0));\n", _preflight_sql()]
    sections.extend(f"-- source: {name}\n{body}" for name, body in sources)
    sections.append("-- foundation finalize executor roles\n")
    sections.extend(f"ALTER ROLE {role} NOLOGIN;\n" for role in EXECUTOR_ROLES)
    sections.append(_postguard_sql())
    sections.append("COMMIT;\n")
    return "\n".join(sections)


POSTFLIGHT_SQL = """BEGIN READ ONLY;
SELECT jsonb_build_object(
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'expectedSystemIdentifier', '7685292944002592802',
  'checkoutFunctionCount', (SELECT count(*) FROM pg_proc AS function WHERE function.pronamespace = 'prefunded_card'::regnamespace AND function.proname = ANY (ARRAY['checkout_capability', 'checkout_reserve', 'checkout_read', 'checkout_claim_initialization', 'checkout_complete_initialization', 'checkout_mark_initialization_uncertain', 'checkout_promote_collection', 'checkout_flag_reconciliation'])),
  'executorRoles', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', role.rolname, 'canLogin', role.rolcanlogin, 'privileged', role.rolsuper OR role.rolcreatedb OR role.rolcreaterole OR role.rolreplication OR role.rolbypassrls) ORDER BY role.rolname) FROM pg_roles AS role WHERE role.rolname = ANY (ARRAY['prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence'])), '[]'::jsonb),
  'inactiveRows', jsonb_build_object('operations', (SELECT count(*) FROM prefunded_card.operations), 'treasuryBindings', (SELECT count(*) FROM prefunded_card.treasury_bindings), 'checkoutIntents', (SELECT count(*) FROM prefunded_card.checkout_intents))
) AS foundation_postflight;
COMMIT;
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--postflight", action="store_true")
    output.add_argument("--diagnostic-labels", action="store_true")
    parser.add_argument("--source-dir", type=Path, default=Path(__file__).parent)
    arguments = parser.parse_args()
    if arguments.diagnostic_labels:
        print(DIAGNOSTIC_LABELS_JSON)
    else:
        print(POSTFLIGHT_SQL if arguments.postflight else build_install_sql(arguments.source_dir), end="")


if __name__ == "__main__":
    main()
