#!/usr/bin/env bash
# Deploy the recode live browser server to Fly.io.
#
#   ./deploy.sh                      # deploy with defaults
#   FLY_APP=my-app ./deploy.sh       # custom app name
#   ./deploy.sh --check              # validate config, change nothing
#
# Requires: flyctl installed and `flyctl auth login` done once.
# For CI, export FLY_API_TOKEN="$(flyctl tokens create deploy)".
#
# What it does, in order:
#   1. verifies flyctl is installed and authenticated
#   2. creates the app if it does not exist
#   3. creates a 1GB volume for traces (so recorded traces survive restarts)
#   4. sets LB_TOKEN as a secret, if you provided one
#   5. deploys the image and prints the permanent URL
set -euo pipefail

APP="${FLY_APP:-recoder}"
REGION="${FLY_REGION:-iad}"
VOL="${FLY_VOL:-lb_data}"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

cd "$(dirname "$0")"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
say "preflight"

# File checks run FIRST and unconditionally: they are the ones that catch a
# broken image, and they must be reportable on a machine with no flyctl (which
# is exactly where you are when you are checking the config before installing
# anything). flyctl is only required to actually deploy.
for f in Dockerfile fly.toml requirements.txt live_browser.py trace_view.py manus_proxy.py; do
  [ -f "$f" ] || die "missing $f — run this from the server/ directory"
done

# The Dockerfile copies exactly these; a missing one fails the build late.
for f in trace_view.py manus_proxy.py; do
  grep -q "COPY $f" Dockerfile || \
    die "Dockerfile does not copy $f — that service would be missing from the image"
done

if ! command -v flyctl >/dev/null 2>&1; then
  if [ "$CHECK" = "1" ]; then
    say "flyctl not installed (fine for --check)"
  else
    die "flyctl not found. Install it:
  curl -L https://fly.io/install.sh | sh"
  fi
fi

if ! flyctl auth whoami >/dev/null 2>&1; then
  if [ "$CHECK" = "1" ]; then
    say "not logged in (fine for --check)"
  else
    die "not logged in to Fly.io.
  Run:  flyctl auth login
  Or:   export FLY_API_TOKEN=\$(flyctl tokens create deploy)"
  fi
fi

if [ "$CHECK" = "1" ]; then
  say "--check: config is valid, nothing was changed"
  exit 0
fi

WHO="$(flyctl auth whoami 2>/dev/null | head -1)"
say "authenticated as $WHO"
say "app=$APP  region=$REGION  volume=$VOL"

# ---------------------------------------------------------------- app
# Parse the JSON rather than grepping it: flyctl pretty-prints its output
# ("Name": "recoder" with a space), so a `grep '"Name":"recoder"'` never
# matches and the script would try to create an app that already exists —
# which a deploy token is not allowed to do.
app_exists() {
  flyctl apps list --json 2>/dev/null \
    | python3 -c 'import json,sys
try: apps=json.load(sys.stdin)
except Exception: sys.exit(1)
sys.exit(0 if any(a.get("Name")==sys.argv[1] for a in apps) else 1)' "$APP"
}

if ! app_exists; then
  say "creating app $APP"
  if ! CREATE_OUT="$(flyctl apps create "$APP" --org "${FLY_ORG:-personal}" 2>&1)"; then
    printf '%s\n' "$CREATE_OUT" >&2
    if printf '%s' "$CREATE_OUT" | grep -qiE 'unauthorized|not authorized'; then
      die "the token cannot create apps — it is scoped to a single app.

  A Fly *deploy* token (flyctl tokens create deploy --app NAME) can only
  deploy to that one app; it cannot create a new one. Either:

    a) create the app once with an account-scoped token, then re-run:
         flyctl apps create $APP --org ${FLY_ORG:-personal}
       (or create it in the Fly dashboard), or

    b) mint an org-scoped token instead:
         flyctl tokens create org --org ${FLY_ORG:-personal}
       and use that as FLY_API_TOKEN."
    fi
    die "could not create app $APP"
  fi
else
  say "app $APP already exists"
fi

# ---------------------------------------------------------------- volume
# Same JSON-parsing rule as the app check above.
volume_exists() {
  flyctl volumes list -a "$APP" --json 2>/dev/null \
    | python3 -c 'import json,sys
try: vols=json.load(sys.stdin)
except Exception: sys.exit(1)
sys.exit(0 if any(v.get("Name")==sys.argv[1] for v in vols) else 1)' "$VOL"
}

if ! volume_exists; then
  say "creating volume $VOL (1GB) in $REGION"
  flyctl volumes create "$VOL" -a "$APP" --region "$REGION" --size 1 --yes
else
  say "volume $VOL already exists"
fi

# ---------------------------------------------------------------- auth
if [ -n "${LB_TOKEN:-}" ]; then
  say "setting LB_TOKEN secret"
  flyctl secrets set LB_TOKEN="$LB_TOKEN" -a "$APP" --stage
else
  say "no LB_TOKEN set — the server will accept unauthenticated calls."
  say "  Set one with:  LB_TOKEN=<long-random> ./deploy.sh"
fi

# ---------------------------------------------------------------- deploy
say "deploying (this builds the Playwright image, ~2-4 min the first time)"
flyctl deploy -a "$APP" --remote-only

URL="https://$APP.fly.dev"
say "waiting for $URL/health"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "$URL/health" >/dev/null 2>&1; then
    say "healthy"
    curl -s "$URL/health"; echo
    break
  fi
  sleep 4
  [ "$i" = "30" ] && say "health check did not pass yet — check: flyctl logs -a $APP"
done

cat <<EOF

  Permanent URL:  $URL

  Paste it into the workbench:
    Browser -> Live browser server -> Server URL
  and, if you set LB_TOKEN, the same token into Access token.

  Verify from a shell:
    curl $URL/health
EOF
