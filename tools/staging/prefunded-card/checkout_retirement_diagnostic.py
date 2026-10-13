from pathlib import Path

from treasury_owner_contract import Refused


SOURCE_MODULES = frozenset({
    'checkout_retirement_owner.py',
    'checkout_retirement_contract.py',
    'checkout_retirement_provider.py',
    'checkout_retirement_quiescence.py',
    'public_app_upgrade.py',
    'public_app_upgrade_io.py',
    'public_app_upgrade_probes.py',
    'public_app_upgrade_recovery.py',
    'public_artifact.py',
    'public_http_probes.py',
    'public_install_io.py',
    'public_projection.py',
    'public_service_contract.py',
    'runtime_owner_support.py',
    'treasury_owner_contract.py',
    'treasury_owner_io.py',
})
SOURCE_DIRECTORY = Path(__file__).absolute().parent


def failure_diagnostic(error):
    result = {
        'reasonCode': 'REFUSED_CHECK' if type(error) is Refused else 'UNEXPECTED_EXCEPTION',
        'sourceModule': None,
        'sourceLine': None,
    }
    traceback = error.__traceback__
    while traceback is not None:
        filename = Path(traceback.tb_frame.f_code.co_filename).absolute()
        if filename.parent == SOURCE_DIRECTORY and filename.name in SOURCE_MODULES:
            result['sourceModule'] = filename.name
            result['sourceLine'] = traceback.tb_lineno
        traceback = traceback.tb_next
    return result
