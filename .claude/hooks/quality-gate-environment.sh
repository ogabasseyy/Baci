#!/bin/bash

# Quality gates verify the installed dependency tree; they must never mutate it.
export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
