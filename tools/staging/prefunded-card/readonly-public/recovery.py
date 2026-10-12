import os
from pathlib import Path
import subprocess

from public_app_upgrade_io import sync
import public_service_contract as service
from treasury_owner_contract import ENVIRONMENT, Refused


def recover(retained, audit, moved, removed, original_units, inspect, command,
            replace_file, create_container, manifest, predecessor_manifest):
    errors = []
    root = Path(service.ROOT)

    def attempt(name, operation):
        try:
            operation()
        except Exception:
            errors.append(name)

    def stop_units():
        result = subprocess.run(['/usr/bin/systemctl', 'stop', service.NAME + '.service',
            service.NAME + '-deadline.timer'], env=ENVIRONMENT, capture_output=True, timeout=40)
        if result.returncode:
            raise Refused('recovery-stop')

    def remove_new():
        observed = inspect(service.NAME)
        if (observed.get('Name') != '/' + service.NAME or observed.get('Image') != service.IMAGE
                or observed.get('Config', {}).get('Labels', {}).get(service.LABEL) != manifest
                or not isinstance(observed.get('Id'), str) or len(observed['Id']) != 64):
            raise Refused('recovery-container-identity')
        command([*service.DOCKER, 'rm', '--force', observed['Id']])

    def restore_tree():
        if root.exists():
            os.rename(root, root.parent / (root.name + '.failed-readonly-' + audit.name))
        os.rename(retained, root)
        sync(root.parent)

    attempt('stop-public-units', stop_units)
    if removed:
        attempt('remove-owned-candidate-container', remove_new)
    if moved:
        attempt('restore-retained-tree', restore_tree)
    for name, content in original_units.items():
        attempt('restore-' + name, lambda name=name, content=content:
            replace_file(Path('/etc/systemd/system') / name, content))
    attempt('reload-original-units', lambda: command(['/usr/bin/systemctl', 'daemon-reload']))
    if removed and 'restore-retained-tree' not in errors:
        attempt('recreate-stopped-predecessor', lambda: create_container(predecessor_manifest))
    return errors
