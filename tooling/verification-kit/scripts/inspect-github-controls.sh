#!/usr/bin/env bash
# Inspect actually-configured GitHub repository controls (framework spec §25.3).
# Reports the real configured state via the GitHub API; never assumes a control
# is active because a file exists. Requires authenticated gh CLI.
set -u

REPO="${1:-Stuff-is-Parts/sip-phosphene}"
BRANCH="${2:-main}"

echo "== GitHub control inspection for ${REPO} (branch: ${BRANCH}) =="

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not available — cannot verify any repository-host control. NOT CONFIGURED is the only safe assumption."
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh CLI not authenticated — cannot verify any repository-host control."
  exit 1
fi

echo "-- branch protection --"
if protection=$(gh api "repos/${REPO}/branches/${BRANCH}/protection" 2>/dev/null); then
  echo "${protection}" | gh api --method=GET /dev/null --jq '.' 2>/dev/null || echo "${protection}"
else
  echo "NOT CONFIGURED: no branch protection on ${BRANCH}"
fi

echo "-- required status checks --"
if checks=$(gh api "repos/${REPO}/branches/${BRANCH}/protection/required_status_checks" --jq '.contexts[]?' 2>/dev/null); then
  if [ -n "${checks}" ]; then echo "${checks}"; else echo "protection exists but no required status checks selected"; fi
else
  echo "NOT CONFIGURED: no required status checks"
fi

echo "-- CODEOWNERS --"
if gh api "repos/${REPO}/contents/.github/CODEOWNERS" --jq '.name' >/dev/null 2>&1; then
  echo "ACTIVE: .github/CODEOWNERS exists on the host"
else
  echo "NOT CONFIGURED: no .github/CODEOWNERS on the host (template does not count)"
fi

echo "-- collaborators with admin (trust-root candidates) --"
gh api "repos/${REPO}/collaborators?permission=admin" --jq '.[].login' 2>/dev/null || echo "unable to list collaborators (token scope)"

echo "== end inspection: only the states printed above are verified; everything else is unconfigured =="
