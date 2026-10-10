"""Job-container guard for the audited workflow: any container:
drifts (an attacker image would supply the shell binaries that
execute the token-bearing steps).
"""
from semgrep_sarif_shell import map_key_value


def audit_container_image(ctx, drift):
    # (e) The audited workflow runs token-bearing steps on the
    # runner: a job-level container: supplies the shell binaries
    # executing them, so an attacker image reads GH_TOKEN and
    # META_API_KEY from the environment. The audited file pins
    # no container (the semgrep job's image lives in
    # security.yml, outside this audit's scope), so any
    # container: key -- block or flow form -- drifts.
    # Quoted/escaped spellings normalize through map_key_value;
    # residual: container: nested under a run: block scalar is
    # shell text, not YAML, and drifts the same (fail-closed).
    for line in ctx.workflow_lines:
        key, _ = map_key_value(line.strip())
        if key == "container" \
                and "container-override" not in drift:
            drift.append("container-override")
