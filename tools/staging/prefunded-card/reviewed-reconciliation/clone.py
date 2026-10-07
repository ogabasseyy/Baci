from contract import require, sha256, SOURCE_SHA256


EARLY_RETURN = """  IF intent.phase='reconciliation_required' THEN
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
"""
ALLOWED = "intent.phase NOT IN ('initializing','ready','pending')"
HEADER = 'CREATE OR REPLACE FUNCTION prefunded_card.checkout_promote_collection('


def reviewed_clone(source):
    require(sha256(source) == SOURCE_SHA256, 'original_source_pin')
    require(source.startswith(HEADER) and source.count(HEADER) == 1
            and source.count(EARLY_RETURN) == 1 and source.count(ALLOWED) == 1
            and source.count('\nBEGIN\n') == 1
            and source.count('$function$') == 2, 'clone_exact_anchors')
    changed = source.replace(HEADER, 'CREATE OR REPLACE FUNCTION pg_temp.reviewed_promote_collection(', 1)
    changed = changed.replace(EARLY_RETURN, '', 1)
    changed = changed.replace(ALLOWED, "intent.phase NOT IN ('initializing','ready','pending','reconciliation_required')", 1)
    return changed.replace('\nBEGIN\n', '\nBEGIN\n  PERFORM pg_temp.reviewed_approval_guard(p_scope,p_selection,p_collection);\n', 1)
