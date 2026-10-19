import importlib.util
import json
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent
SPECIFICATION = importlib.util.spec_from_file_location('replay_claim_fence_contract', HERE / 'contract.py')
contract = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(contract)


def _expand(source, replacements):
    placeholders = set(re.findall(r'__[A-Z_0-9]+__', source))
    contract.require(placeholders == set(replacements), 'template_framing_refused')
    return re.sub(r'__[A-Z_0-9]+__', lambda match: replacements[match.group()], source)


def _guard():
    return _expand((HERE / 'gate.sql').read_text(), {
        '__ROLE__': contract.ROLE, '__AUDIENCE__': contract.AUDIENCE,
        '__CLAIM_KEY__': contract.CLAIM_KEY, '__GENERATION__': contract.GENERATION,
        '__EXPIRY__': str(contract.EXPIRY), '__DEADLINE__': contract.DEADLINE})


def render_transaction(original_definition, *, mode='rollback'):
    body = contract.validate(original_definition, mode)
    guard = _guard()
    fenced_body = body.replace('\nBEGIN\n', '\nBEGIN\n' + guard, 1)
    fenced_definition = original_definition.replace(body, fenced_body, 1)
    contract.require(fenced_body.removeprefix('\nBEGIN\n' + guard) == body.removeprefix('\nBEGIN\n'),
                     'unchanged_body_refused')
    replacements = {
        '__INSTALLER_LOGIN__': contract.INSTALLER_LOGIN,
        '__SYSTEM_IDENTIFIER__': contract.SYSTEM_IDENTIFIER,
        '__DATABASE__': contract.DATABASE,
        '__DEADLINE__': contract.DEADLINE, '__SIGNATURE__': contract.SIGNATURE,
        '__ROUTINE_OID__': str(contract.ROUTINE_OID), '__OWNER__': contract.OWNER,
        '__ACL__': 'NULL' if contract.ACL is None else "'" + json.dumps(contract.ACL, separators=(',', ':')) + "'",
        '__BODY_SHA256__': contract.BODY_SHA256,
        '__DEFINITION_SHA256__': contract.DEFINITION_SHA256,
        '__FENCED_DEFINITION__': fenced_definition,
        '__FENCED_DEFINITION_SHA256__': contract.sha256(fenced_definition),
        '__FENCED_BODY_SHA256__': contract.sha256(fenced_body),
        '__FINISH__': 'ROLLBACK;' if mode == 'rollback' else 'COMMIT;'}
    return _expand((HERE / 'owner.sql').read_text(), replacements)
