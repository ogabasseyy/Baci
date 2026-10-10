import os
from pathlib import Path
import stat

from renewal_contract import PINS, Refused


SOURCE_DIRECTORY = Path(__file__).absolute().parent
SOURCE_MODULES = frozenset({'renewal_owner.py', 'renewal_contract.py', 'renewal_io.py'})
INVENTORY = '/root/baci-week-renewal-inventory.BPBuOXTq/inventory-result.txt'
SOURCE_NAMES = frozenset({'SHA256SUMS', 'README.md', 'renewal_owner.py', 'renewal_contract.py',
                          'renewal_io.py', 'renewal_diagnostic.py'})
DISPLAY_CODES = frozenset({
    'non-readonly-command', 'readonly-command-refused', 'effective-unit-contract',
    'protected-b-runtime-not-stopped', 'expired-a-runtime-not-stopped',
    'protected-b-container-not-stopped', 'bundle-pin-required', 'bundle-source-closure',
    'unreviewed-source-path', 'runtime-state-changed-preparation-retained',
    'root-private-owner-bundle-required', 'preparation-lock-metadata', 'duplicate-json-key',
    'invalid-json', 'invalid-lease-time', 'binding-shape', 'binding-identity',
    'binding-23-routes', 'binding-route-contract', 'binding-lease-window',
    'exact-lease-line-required', 'predecessor-pin', 'predecessor-evidence-identity',
    'reviewed-runtime-cap', 'inventory-format', 'inventory-contract', 'physical-database-pin',
    'historical-financial-invariants', 'inventory-files', 'replay-inventory-identity',
    'jwt-expiry-metadata', 'untrusted-parent', 'private-directory-metadata',
    'source-metadata', 'source-changed', 'source-pin', 'source-changed-before-backup',
    'existing-preparation-retained', 'preparation-name',
})


def failure_diagnostic(error):
    code = 'REFUSED_CHECK' if type(error) is Refused else 'UNEXPECTED_EXCEPTION'
    if type(error) is Refused and len(error.args) == 1:
        value = error.args[0]
        if type(value) is str and value in DISPLAY_CODES:
            code = value
    result = {'reasonCode': code, 'sourceModule': None, 'sourceLine': None}
    traceback = error.__traceback__
    while traceback is not None:
        filename = Path(traceback.tb_frame.f_code.co_filename).absolute()
        if filename.parent == SOURCE_DIRECTORY and filename.name in SOURCE_MODULES:
            result.update(sourceModule=filename.name, sourceLine=traceback.tb_lineno)
            frame = traceback.tb_frame
            value = frame.f_locals.get('path') if filename.name == 'renewal_io.py' else None
            if type(value) is str or type(value) is type(SOURCE_DIRECTORY):
                path = Path(value)
                trusted = str(path) in PINS or str(path) == INVENTORY
                bundled = path.parent == SOURCE_DIRECTORY and path.name in SOURCE_NAMES
                if trusted or bundled:
                    result['failedInput'] = str(path) if trusted else path.name
                    metadata = traceback.tb_frame.f_locals.get('before')
                    if type(metadata) is os.stat_result:
                        result['inputMetadata'] = {
                            'ownerUid': metadata.st_uid, 'groupGid': metadata.st_gid,
                            'mode': f'{stat.S_IMODE(metadata.st_mode):04o}',
                            'nlink': metadata.st_nlink, 'size': metadata.st_size,
                        }
        traceback = traceback.tb_next
    return result
