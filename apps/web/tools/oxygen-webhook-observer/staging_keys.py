"""Save staging keys in macOS Keychain and launch either local test tool."""

import getpass
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

SERVICE = "baci.oxygen.staging.test-tools"
ACCOUNT = "staging-partner"


def credentials(value):
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("Invalid saved credentials")
    for field in ("reference", "secret"):
        if not isinstance(parsed.get(field), str) or not parsed[field].strip():
            raise ValueError("Incomplete saved credentials")
    return {field: parsed[field].strip() for field in ("reference", "secret")}


def save_command(value):
    # security interactive mode keeps the secret out of process arguments.
    return " ".join(shlex.quote(part) for part in [
        "add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", value
    ]) + "\n"


def main():
    if sys.platform != "darwin":
        raise ValueError("This launcher requires macOS Keychain")
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "setup":
        value = json.dumps({
            "reference": getpass.getpass("Staging partner reference (hidden): ").strip(),
            "secret": getpass.getpass("Staging partner secret (hidden): ").strip(),
        })
        credentials(value)
        result = subprocess.run(
            ["/usr/bin/security", "-i"], input=save_command(value), text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
        )
        if result.returncode:
            raise ValueError("Keychain save failed")
        # Verify the stored entry; interactive security may exit zero after an error.
        saved = load()
        if saved != credentials(value):
            raise ValueError("Keychain save could not be confirmed")
        print("Staging keys saved in macOS Keychain. No .env file created.")
        return
    if mode not in ("form", "webhook", "webhook-update"):
        raise ValueError("Use setup, form, or webhook CALLBACK_URL")
    saved = load()
    environment = os.environ.copy()
    environment.update({
        "OXYGEN_TEST_REFERENCE": saved["reference"],
        "OXYGEN_TEST_SECRET": saved["secret"],
        "NODE_OPTIONS": "--conditions=react-server",
    })
    command = ["pnpm", "--filter", "@baci/web", "exec", "tsx"]
    if mode == "form":
        command += ["tools/oxygen-manual-test/cli.ts", "--staging"]
    else:
        if len(sys.argv) != 3:
            raise ValueError("Webhook callback URL required")
        command += ["tools/oxygen-webhook-observer/register-cli.ts", sys.argv[2]]
        if mode == "webhook-update":
            command += ["--update"]
    repository = Path(__file__).resolve().parents[4]
    os.chdir(repository)
    os.execvpe(command[0], command, environment)


def load():
    result = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode:
        raise ValueError("Run setup first; saved staging keys unavailable")
    return credentials(result.stdout)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError):
        print("Unable to run. Use setup first and check Keychain access; no provider retry performed.", file=sys.stderr)
        sys.exit(1)
