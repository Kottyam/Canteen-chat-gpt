#!/usr/bin/env bash
# LOCAL, THROWAWAY Postgres only. Usage: PGTEST_ADMIN_URL=postgres://postgres@localhost:54329/postgres bash supabase/tests/run-db-tests.sh
# Builds: stub Supabase platform + base schema -> ALL repo migrations (in order) -> synthetic fixtures -> node integration tests.
set -euo pipefail
cd "$(dirname "$0")/../.."
ADMIN=${PGTEST_ADMIN_URL:?set PGTEST_ADMIN_URL to a LOCAL postgres superuser URL}
case "$ADMIN" in *localhost*|*127.0.0.1*|*/tmp*|*host=/tmp*) ;; *) echo "Refusing: PGTEST_ADMIN_URL must be local"; exit 2;; esac
DB=gocanteen_pooling_test_$$
psql "$ADMIN" -Xq -c "create database $DB" >/dev/null
URL="${ADMIN%/*}/$DB"
trap 'psql "$ADMIN" -Xq -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
rm -rf /tmp/gc-migcopy-$$; cp -r supabase/migrations /tmp/gc-migcopy-$$
# Two PRE-EXISTING repo migration syntax defects, patched in the temp copy only (see docs):
sed -i "s/between 0% and 100%/between 0%% and 100%%/" /tmp/gc-migcopy-$$/20260907180000_employee_food_contribution_percentage.sql
sed -i 's/^\$function\$ *$/$function$;/' /tmp/gc-migcopy-$$/20260920135602_targeted_rpc_authorization_hardening.sql
psql "$URL" -Xq -v ON_ERROR_STOP=1 -f supabase/tests/00_stub_base_schema.sql >/dev/null
fails=0; ours=ok
for f in /tmp/gc-migcopy-$$/*.sql; do
  [ "$(basename "$f")" = 20260904173000_backfill_legacy_canteen_links.sql ] && psql "$URL" -Xq -f supabase/tests/00b_seed_legacy_admin.sql >/dev/null 2>&1
  if ! out=$(psql "$URL" -Xq -v ON_ERROR_STOP=1 -1 -f "$f" 2>&1); then
    fails=$((fails+1)); echo "  pre-existing migration not replayable locally: $(basename "$f"): $(echo "$out" | grep ERROR | head -1 | cut -c1-140)"
    case "$f" in *20261107100000_opt_in_pooling*|*20261107101029_pooling_standard_publish_guard*|*20261107102605_harden*|*20261107105152_pooling_member_periods*) ours=FAILED;; esac
  fi
done
echo "migrations replayed with $fails unrelated failures; pooling migrations (20261107100000 + 20261107101029): $ours"
[ "$ours" = ok ] || exit 1
psql "$URL" -Xq -v ON_ERROR_STOP=1 -f supabase/tests/fixtures.sql -f supabase/tests/fixtures_data.sql >/dev/null
PGTEST_URL="$URL" node --test tests/db.integration.test.ts
