import hashlib
from pathlib import Path
import re


PENDING = "AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied'"
PENDING_RETIRED = PENDING + '\n    AND NOT prefunded_card.checkout_is_retired(operations.id)'
INTENT_GUARD = """  IF OLD.phase='retired_unconfirmed' THEN
    RAISE EXCEPTION 'retired checkout is terminal' USING ERRCODE='42501';
  END IF;
  IF NEW.phase='retired_unconfirmed' THEN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)
      OR (to_jsonb(NEW)-'phase') IS DISTINCT FROM (to_jsonb(OLD)-'phase')
      OR NOT EXISTS(SELECT 1 FROM prefunded_card.checkout_retirements retirement
        WHERE retirement.operation_id=OLD.id AND retirement.intent_id=OLD.id AND OLD.phase='pending'
          AND retirement.intent_before_sha256=encode(sha256(convert_to(to_jsonb(OLD)::text,'UTF8')),'hex')) THEN
      RAISE EXCEPTION 'checkout retirement transition denied' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
"""
PATCHES = (
    ('storage.sql', 'guard_operation()', (
        ("  IF (to_jsonb(NEW)", """  IF NEW.checkout_retired AND NOT OLD.checkout_retired THEN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper)
      OR (to_jsonb(NEW)-'checkout_retired') IS DISTINCT FROM (to_jsonb(OLD)-'checkout_retired')
      OR NOT EXISTS(SELECT 1 FROM prefunded_card.checkout_retirements retirement WHERE retirement.operation_id=OLD.id
        AND retirement.operation_before_sha256=encode(sha256(convert_to(to_jsonb(OLD)::text,'UTF8')),'hex')) THEN
      RAISE EXCEPTION 'operation retirement transition denied' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)"""),)),
    ('checkout-storage.sql', 'guard_first_card_checkout_intent()', (
        ('  IF (to_jsonb(NEW)', INTENT_GUARD + '  IF (to_jsonb(NEW)'),)),
    ('checkout-reserve.sql', 'checkout_reserve(jsonb,jsonb)', (
        ("prior.phase<>'completed'", "prior.phase NOT IN ('completed','retired_unconfirmed')"),
        (PENDING, PENDING_RETIRED))),
    ('checkout-capability.sql', 'checkout_capability(jsonb,uuid,uuid,uuid,bigint)', (
        ("intent.phase<>'completed'", "intent.phase NOT IN ('completed','retired_unconfirmed')"),
        ("AND operation.projection_status<>'applied';", "AND operation.projection_status<>'applied'\n      AND NOT prefunded_card.checkout_is_retired(operation.id);"))),
    ('storage.sql', 'reserve_pre_treasury_guard(jsonb)', ((PENDING, PENDING_RETIRED),)),
    ('customer-capability.sql', 'customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)', ((PENDING, PENDING_RETIRED),)),
    ('evidence-projection.sql', 'apply_classified_inflow(uuid,text,text)', ((PENDING, PENDING_RETIRED),)),
    ('evidence-inflow.sql', 'classify_provider_inflow(uuid,text,text)', (
        ('IF operation.goal_id IS DISTINCT FROM mapped.goal_id',
         "IF prefunded_card.checkout_is_retired(operation.id) THEN\n          result:=jsonb_build_object('outcome','reconciliation_required');\n        ELSIF operation.goal_id IS DISTINCT FROM mapped.goal_id"),)),
    ('dispatch-queue.sql', 'claim_due(uuid,text,text,integer,uuid,uuid)', (
        ('AND queue.finished_at IS NULL', 'AND NOT prefunded_card.checkout_is_retired(operation.id)\n        AND queue.finished_at IS NULL'),)),
    ('storage-functions.sql', 'claim_reconciliation(uuid,integer)', (
        ("IF operation.collection_status NOT IN ('dispatching','pending','unknown')",
         "IF prefunded_card.checkout_is_retired(operation.id) THEN RETURN jsonb_build_object('outcome','not_verifiable'); END IF;\n  IF operation.collection_status NOT IN ('dispatching','pending','unknown')"),)),
    ('reversal-functions.sql', 'record_collection_reversal(text,jsonb)', (
        ("IF operation.collection_status<>'reversed' THEN", "IF operation.collection_status<>'reversed' AND NOT prefunded_card.checkout_is_retired(operation.id) THEN"),)),
)


def definitions(directory):
    result = []
    for filename, signature, replacements in PATCHES:
        name = signature.split('(')[0]
        source_name = 'reserve' if name == 'reserve_pre_treasury_guard' else name
        source = (Path(directory) / filename).read_text()
        pattern = r'CREATE (?:OR REPLACE )?FUNCTION prefunded_card\.' + source_name + r'\s*\([\s\S]*?\$\$([\s\S]*?)\$\$;'
        matches = list(re.finditer(pattern, source))
        if len(matches) != 1:
            raise ValueError('Reviewed retirement function source differs: ' + name)
        original, body = matches[0].group(), matches[0].group(1)
        changed_body = body
        for before, after in replacements:
            if changed_body.count(before) != 1:
                raise ValueError('Retirement patch must match exactly once: ' + name)
            changed_body = changed_body.replace(before, after)
        changed = original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
        changed = changed.replace('FUNCTION prefunded_card.' + source_name + '(', 'FUNCTION prefunded_card.' + name + '(', 1)
        changed = changed.replace('$$' + body + '$$', '$$' + changed_body + '$$')
        result.append((signature, body, changed_body, changed, 'SECURITY DEFINER' in original))
    return result


def render_patches(directory, *, owner='postgres'):
    if owner not in ('postgres', 'harness_admin'):
        raise ValueError('Retirement owner differs')
    statements = []
    for signature, body, changed_body, changed, definer in definitions(directory):
        before = hashlib.sha256(body.encode()).hexdigest()
        after = hashlib.sha256(changed_body.encode()).hexdigest()
        statements.append(f"""DO $retirement_patch$
DECLARE target oid:=to_regprocedure('prefunded_card.{signature}'); before_acl aclitem[]; before_owner oid;
BEGIN
  IF target IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc routine WHERE routine.oid=target
    AND routine.proowner=(SELECT oid FROM pg_roles WHERE rolname='{owner}')
    AND routine.prosecdef={str(definer).lower()} AND routine.proconfig=ARRAY['search_path=pg_catalog']::text[]
    AND routine.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    AND encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')='{before}') THEN
    RAISE EXCEPTION 'retirement function baseline differs: {signature}' USING ERRCODE='55000'; END IF;
  SELECT proacl,proowner INTO before_acl,before_owner FROM pg_proc WHERE oid=target;
  EXECUTE $retirement_definition${changed}$retirement_definition$;
  IF to_regprocedure('prefunded_card.{signature}') IS DISTINCT FROM target OR NOT EXISTS(
    SELECT 1 FROM pg_proc WHERE oid=target AND proacl IS NOT DISTINCT FROM before_acl AND proowner=before_owner
      AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='{after}') THEN
    RAISE EXCEPTION 'retirement function postflight differs' USING ERRCODE='55000'; END IF;
END $retirement_patch$;
""")
    return '\n'.join(statements)
