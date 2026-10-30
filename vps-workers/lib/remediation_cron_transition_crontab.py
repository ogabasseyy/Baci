"""Crontab construction for the remediation transition transaction."""

import re
import shlex


def is_legacy_owned(line, remote_dir, targets, lock_dir):
    remote = shlex.quote(remote_dir)
    for name, schedule, wait in targets:
        target = shlex.quote(f'{remote_dir}/jobs/{name}.mjs')
        log = shlex.quote(f'{remote_dir}/logs/{name}.log')
        prefixes = (
            f'{schedule} flock -n {shlex.quote(f"{lock_dir}/{name}.lock")} ',
            f'{schedule} flock -n {remote}/locks/{name}.lock ',
        )
        prefix = next((candidate for candidate in prefixes if line.startswith(candidate)), '')
        command_prefix = line[len(prefix) :] if prefix else ''
        nested_global = r"^flock (?:-n|-w(?:\s+\d+)?)(?: -E 75)? (?:'[^']+'|\S+) bash -lc '"
        if not (
            command_prefix.startswith("bash -lc '")
            or re.match(nested_global, command_prefix)
        ):
            continue
        if line.endswith(f" {target}' >> {log} 2>&1") and f'cd {remote} && ' in line:
            payload = line.split(" bash -lc '", 1)[1]
            payload = payload[: -len(f"' >> {log} 2>&1")]
            command = payload[: -len(f' {target}')].strip()
            try:
                command_tokens = shlex.split(command.rsplit('&&', 1)[-1].strip())
            except ValueError:
                continue
            if not command_tokens:
                continue
            executable = command_tokens[0]
            if executable in {'node', 'nodejs'} or (
                executable.startswith('/') and executable.endswith(('/node', '/nodejs'))
            ):
                return True
    return False


def transition_crontab(
    original,
    remote_dir,
    node_bin,
    codex_image,
    codex_container_bin,
    targets,
    block_start,
    block_end,
    global_lock_path=None,
    lock_dir=None,
):
    lock_dir = lock_dir or f'{remote_dir}/locks'
    retained = []
    lines = original.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if line == block_start:
            try:
                index = lines.index(block_end, index + 1) + 1
            except ValueError as error:
                raise RuntimeError('unterminated owned remediation cron block') from error
            continue
        if line == block_end:
            raise RuntimeError('unexpected remediation cron block terminator')
        if not is_legacy_owned(line, remote_dir, targets, lock_dir):
            retained.append(line)
        index += 1
    while retained and not retained[-1].strip():
        retained.pop()
    remote = shlex.quote(remote_dir)
    global_lock = shlex.quote(
        global_lock_path or f'{lock_dir}/error-remediator-global.lock'
    )
    command = (
        f'export BACI_CODEX_DOCKER_IMAGE={shlex.quote(codex_image)} '
        f'BACI_CODEX_CONTAINER_BIN={shlex.quote(codex_container_bin)} '
        f'&& cd {remote} && exec flock -F '
    )
    block = [block_start]
    for name, schedule, wait in targets:
        job = (
            'if ! /usr/local/lib/baci-worker-broker/worker-release-launch-gate scheduled; '
            f'then exit 0; fi; exec {shlex.quote(node_bin)} '
            f'{shlex.quote(f"{remote_dir}/jobs/{name}.mjs")}'
        )
        payload = (
            f'{command}{wait} -E 75 {global_lock} '
            f'/bin/bash -lc {shlex.quote(job)}'
        )
        block.append(
            f'{schedule} flock -n {shlex.quote(f"{lock_dir}/{name}.lock")} bash -lc {shlex.quote(payload)} '
            f'>> {remote}/logs/{name}.log 2>&1'
        )
    block.append(block_end)
    escaped_block = [line.replace('%', r'\%') for line in block]
    return '\n'.join([*retained, *([''] if retained else []), *escaped_block]) + '\n'
