#!/bin/sh
# Container runtime configuration for PromptForge.
#
# The app reads its optional Google key + SIGNUP_INVITE_CODE from the Worker `env`
# (via `cloudflare:workers`), NOT from the container's process environment.
# Under `wrangler dev --local` those bindings are loaded from a `.dev.vars`
# file that wrangler resolves *next to the -c config* — never from the ambient
# process env. So values handed to the container (compose `env_file`, or
# `docker run -e KEY=...`) do not reach the app on their own.
#
# This entrypoint bridges that gap: it materializes `.dev.vars` from an
# explicit allowlist of runtime variables, then hands off to the wrangler
# command (the image CMD). Only the listed keys are forwarded, so unrelated
# container variables (PATH, HOME, wrangler's own settings, etc.) never leak
# into the Worker runtime. Regenerated on every start, so a restart always
# reflects the current environment.
set -eu

# Runtime variables the Worker consumes. Keep in sync with .dev.vars.example.
RUNTIME_VARS="GOOGLE_API_KEY SIGNUP_INVITE_CODE"

# Locate the wrangler config in the incoming command so the generated
# .dev.vars lands in the directory wrangler loads it from (alongside -c).
config="dist/server/wrangler.json"
prev=""
for arg in "$@"; do
  case "$prev" in
    -c | --config) config="$arg" ;;
  esac
  prev="$arg"
done
dev_vars="$(dirname "$config")/.dev.vars"

# Write the allowlisted, non-empty variables. An absent or empty value is
# skipped (not an error) — the app boots without keys and greys out those
# models. Truncate first so a restart never keeps a stale key.
: >"$dev_vars"
for name in $RUNTIME_VARS; do
  eval "value=\${$name:-}"
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$name" "$value" >>"$dev_vars"
  fi
done

# Codex and Claude are authenticated host CLIs. The loopback-only bridge is
# deliberately unreachable from this container, so hide those models instead
# of presenting controls that can only fail at generation time.
printf '%s=%s\n' "PROMPTFORGE_DISABLE_SUBSCRIPTIONS" "1" >>"$dev_vars"

exec "$@"
