#!/usr/bin/env bash
# Sourced only after exact legacy history and explicit approval are verified.
reconcile_checkout_recovery_legacy() {
  local gate='20261015215000_customer_checkout_shipping_recovery_activation_gate'
  local version="${gate%%_*}" name="${gate#*_}"
  local cursor='20261013213516_customer_checkout_shipping_recovery_context'
  local expected='' next guard
  if [ -n "$migration_max_version" ] && [[ "$migration_max_version" < "$version" ]]; then
    echo 'Legacy recovery reconciliation deferred by version cap; no migration writes.'
    # Leave every mutation until the uncapped pass; hook probes still run.
    exit 0
  fi
  while [ "$cursor" != "$gate" ]; do
    expected="${expected}${expected:+,}('${cursor%%_*}','${cursor#*_}')"
    next="$(atomic_migration_group_next_base "$cursor")" || return 1
    cursor="$next"
  done
  guard="$(cat <<SQL
LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;
LOCK TABLE private.customer_checkout_shipping_recovery_previews IN ACCESS EXCLUSIVE MODE;
DO \$recovery_reconcile\$
BEGIN
  IF EXISTS (
    SELECT * FROM (VALUES $expected) AS expected(version,name)
    EXCEPT SELECT version,name FROM supabase_migrations.schema_migrations
  ) OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='$version')
    OR pg_catalog.to_regclass('private.checkout_shipping_recovery_release_activation') IS NOT NULL THEN
    RAISE EXCEPTION 'recovery_legacy_history_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM private.customer_checkout_shipping_recovery_previews) THEN
    RAISE EXCEPTION 'recovery_legacy_writes_require_reconciliation';
  END IF;
END;
\$recovery_reconcile\$;
SQL
)"
  # This installs only the new closed gate and its history row in one transaction,
  # before any other pending migration. Never replays the ten live predecessors.
  apply_pending_migration "$migrations_dir/$gate.sql" "$version" "$name" "$guard"
}
