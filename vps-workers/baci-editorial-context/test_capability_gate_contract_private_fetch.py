"""The base-owned gate accepts only the reviewed private-fetch transition."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "contract_check_private_fetch",
    ROOT / ".github/scripts/capability_gate_contract_check.py",
)
assert SPEC and SPEC.loader
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


class PrivateFetchContractTests(unittest.TestCase):
    def test_unauthenticated_fetch_is_not_accepted(self):
        workflow = (ROOT / ".github/workflows/capability-gate-contract.yml").read_text()
        from capability_gate_contract_workflow_checks import PRIVATE_ENV, PRIVATE_RUN

        legacy = '            base_ref=$(jq -r .pull_request.base.ref "$GITHUB_EVENT_PATH")\n            git fetch --no-tags --depth 1 origin "$base_ref"\n'
        if PRIVATE_ENV in workflow:
            workflow = workflow.replace(PRIVATE_ENV, '', 1).replace(PRIVATE_RUN, legacy, 1)
        self.assertIn(legacy, workflow)
        self.assertTrue(check.workflow_failures(workflow))

    def test_authenticated_transition_is_exact_and_fail_closed(self):
        from capability_gate_contract_workflow_checks import PRIVATE_ENV, PRIVATE_RUN

        workflow = (ROOT / ".github/workflows/capability-gate-contract.yml").read_text()
        original = '        shell: bash\n        run: |\n'
        old = '            base_ref=$(jq -r .pull_request.base.ref "$GITHUB_EVENT_PATH")\n            git fetch --no-tags --depth 1 origin "$base_ref"\n'
        if PRIVATE_ENV in workflow:
            authenticated = workflow
        else:
            self.assertIn(old, workflow)
            authenticated = workflow.replace(original, PRIVATE_ENV + original, 1)
            authenticated = authenticated.replace(old, PRIVATE_RUN, 1)
        self.assertIn(PRIVATE_RUN, authenticated)
        self.assertEqual(check.workflow_failures(authenticated), [])
        for altered in (
            authenticated.replace(PRIVATE_ENV, '', 1),
            authenticated.replace('persist-credentials: false', 'persist-credentials: true', 1),
            authenticated.replace('"$base_sha"', '"${{ github.event.pull_request.head.sha }}"', 1),
            authenticated.replace('credential.helper=', 'credential.helper=store', 1),
            authenticated.replace('python3 "$CHECKER"', 'python3 ./candidate.py', 1),
            authenticated.replace('contents: read', 'contents: write', 1),
            authenticated.replace('        shell: bash\n', '        shell: bash\n        continue-on-error: true\n', 1),
            authenticated.replace('          GH_TOKEN: ${{ github.token }}\n', '          GH_TOKEN: ${{ github.token }}\n          BASH_ENV: /tmp/evil\n', 1),
            authenticated.replace('          GH_TOKEN: ${{ github.token }}\n', '          GH_TOKEN: ${{ github.token }}\n          PYTHONPATH: /tmp/evil\n', 1),
            authenticated.replace('        env:\n', '        "env":\n', 1),
            authenticated.replace('        env:\n', '        env:\n          GH_TOKEN: duplicate\n', 1),
            authenticated.replace('${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git', 'https://${GH_TOKEN}@github.com/evil/repo.git', 1),
            authenticated.replace('            unset GH_TOKEN\n', '', 1),
            authenticated.replace('            rm -rf "$ask_dir"\n', '', 1),
        ):
            self.assertNotEqual(altered, authenticated)
            self.assertTrue(check.workflow_failures(altered))


if __name__ == "__main__":
    unittest.main()
