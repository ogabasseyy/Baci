"""Checkout step ordering: the canonical PR < clear < trusted <
resolver write order plus step uniqueness (a duplicate clear,
trusted checkout, or resolver escapes its span checks).
"""
from semgrep_sarif_steps import step_name, step_start


def audit_checkout_order(ctx, drift):
    # Canonical write order: PR checkout < collision clear <
    # trusted checkout < resolver. Steps run top-down: a
    # reordered clear (after trusted) deletes the trusted
    # tree, a reordered PR checkout (after trusted) lets a
    # later PR track trusted-scripts/* into the executed
    # tree, and anything resolving before trusted reads a
    # PR-controlled tree. Each located step must be unique:
    # a second clear deletes the trusted tree, a second
    # trusted checkout escapes its span checks, and a second
    # resolver rebinds SCRIPT_DIR past the audited one.
    clear = [i for i, line in enumerate(ctx.workflow_lines)
             if step_name(line) == "Clear trusted-scripts collision"]
    if len(clear) != 1 and "checkout-order" not in drift:
        drift.append("checkout-order")
    if len(ctx.resolve) != 1 and "checkout-order" not in drift:
        drift.append("checkout-order")
    if len(ctx.trusted) != 1 and "checkout-order" not in drift:
        drift.append("checkout-order")
    if len(ctx.pr_refs) != 1 or len(clear) != 1 \
            or len(ctx.trusted) != 1 or len(ctx.resolve) != 1:
        return  # counts already drifted; order is moot
    starts = [step_start(ctx.workflow_lines, ctx.pr_refs[0]),
              clear[0],
              step_start(ctx.workflow_lines, ctx.trusted[0]),
              ctx.resolve[0]]
    if starts != sorted(starts) \
            and "checkout-order" not in drift:
        drift.append("checkout-order")
