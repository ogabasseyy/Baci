"""Pinned trust anchors for the SARIF drift audit.

Every value here is a reviewed constant: changing one means the
audited artifact changed and a human must re-approve. The audit
fails closed on any mismatch.
"""

AUDITED_RULE_ID = (
    "yaml.github-actions.security.pull-request-target-code-checkout"
    ".pull-request-target-code-checkout"
)
AUDITED_PATH = ".github/workflows/muse-code-review.yml"
PINNED_CHECKOUT_USES = (
    "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0"
)
MUSE_PINNED_VERSION = "1.4.1-R4503.1"
MUSE_PINNED_HOST = "https://lookaside.facebook.com/"
MUSE_PINNED_SHA_X86 = (
    "8b53c9cdbc025bc2d9068bc7016e2c1e51c3a0c608821da1"
    "7528ad23be900a12"
)
MUSE_PINNED_SHA_AARCH64 = (
    "a6d46239975adac282aa829d2a5bd1cd3119334c18ecfa7"
    "76d4377daebddb595"
)
