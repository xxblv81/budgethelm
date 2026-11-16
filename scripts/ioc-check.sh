#!/usr/bin/env bash
# wfx-loot / "WFX Phantom" IOC check (Nov 2026). Read-only, repeatable. Exit 1 if any HIT.
# Usage: scripts/ioc-check.sh [owner/repo]   (remote branch/PR/run-gap checks need `gh`; default: origin)
# Sources: aikido.dev/blog/compromised-github-accounts-push-ci-secret-stealer-to-tens-of-thousands-of-repositories
#          safedep.io/blog/github-actions-wfx-credential-stealer
#          endorlabs.com/learn/github-actions-supply-chain-attack-targeting-ci-secrets-at-scale
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
MSG='ci: refresh build cache|ci: restore|chore: add ci helper|ci: cleanup|chore: add dependency audit workflow'
BR='(^|/)(wfx-docs|chore/[a-z0-9]{8}|ci-check-[0-9]{4})$'
PAT='neuronai-studio|onuragtas|vkuznet/gocurl|WF_CTOKEN|WF_SECRETS|WF_CALLBACK|b42d70a7aab9140ca19e8249|Pass runtime|Restore cache j632|194\.150\.166\.244|18\.143\.168\.96|153\.75\.82\.159|wfx-loot|wfx-ci-|WFX-BEGIN'
tag(){ sed "s#^#$1: #" >> "$OUT"; }
git branch -a 2>/dev/null | sed 's/^[* ]*//' | grep -E "$BR" | tag "HIT local-branch"
git log --all --since=2026-10-01 --format='%h %an <%ae> %s' | grep -E "$MSG" | tag "HIT commit"
git ls-files | grep -E '(^|/)\.ci-[a-z0-9]{6}\.sh$|build-audit-[a-z0-9]{6}\.yml$|fa-solid-400\.woff2$' | tag "HIT file"
git ls-files -z | xargs -0 grep -IlE "$PAT" 2>/dev/null | grep -v 'scripts/ioc-check.sh' | tag "HIT content"
git ls-files | grep -E '(^|/)(package-lock\.json|composer\.lock|go\.sum|go\.mod)$' | while read -r f; do grep -nE 'neuronai-studio|onuragtas/(redock|docker-env)|vkuznet/gocurl' "$f" | sed "s#^#$f:#"; done | tag "HIT dep"
git ls-files | grep -E '(^|/)package\.json$' | while read -r f; do grep -nE '"(preinstall|install|postinstall)"' "$f" | sed "s#^#$f:#"; done | tag "WARN install-hook"
if command -v gh >/dev/null 2>&1; then
  R="${1:-$(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')}"
  gh api --paginate "repos/$R/branches?per_page=100" --jq '.[].name' 2>/dev/null | grep -E "$BR" | tag "HIT remote-branch"
  gh api --paginate "repos/$R/pulls?state=all&per_page=100" --jq '.[]|"#\(.number) \(.title) [\(.head.ref)]"' 2>/dev/null | grep -iE 'dependency audit notes|wfx' | tag "HIT PR"
  gh api --paginate "repos/$R/actions/runs?per_page=100" --jq '.workflow_runs[]|[.workflow_id,.run_number]|@tsv' 2>/dev/null | sort -k1,1n -k2,2n | awk '{ if($1==w && $2!=p+1) printf "workflow %s run %d -> %d\n",w,p,$2; w=$1;p=$2 }' | tag "WARN run-gap"
else echo "NOTE: gh not found; remote checks skipped" >> "$OUT"; fi
cat "$OUT"
if grep -q '^HIT' "$OUT"; then echo "RESULT: HIT"; exit 1; fi
echo "RESULT: clean (IOC list as of 2026-11-16)"
