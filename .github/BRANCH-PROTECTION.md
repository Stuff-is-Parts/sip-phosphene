# Repository-Host Enforcement — Required External Configuration

Framework spec §25.3 and §7.9 require repository-host enforcement that the
producing agent cannot perform or verify into existence. **None of the controls
below are active until the repository administrator performs them.** Workflow
files existing in this repository does not mean branch protection, required
reviews, or host authorization are configured — run
`tooling/verification-kit/scripts/inspect-github-controls.sh` to see the actual
configured state.

## Exact actions required (repository administrator: Todd)

### 1. Establish the authorization root of trust (framework spec §7.9)

1. Edit `verification/authorization/authorized-identities.json` yourself (not
   through the producing agent) and add your GitHub login:
   ```json
   { "identities": [ { "identityId": "identity.todd", "kind": "github-account", "value": "YOUR_GITHUB_LOGIN" } ] }
   ```
2. Update `verification/authorization/bootstrap-record.json`: set `status` to
   `established`, fill `initialAllowlistHash` (run
   `node tooling/verification-kit/bin/verify.mjs authorization` — the report
   contains the current allowlist hash — or compute it yourself), and record
   the mechanism (e.g. "repository-administration commit by YOUR_GITHUB_LOGIN
   on YYYY-MM-DD"), the actor, the time, and the verification method
   ("GitHub API review verification").
3. Commit these through your own GitHub account so the host records you as the
   author of the trust-root establishment.

### 2. Branch protection on `main` (GitHub → Settings → Branches → Add rule)

- Branch name pattern: `main`
- Enable **Require a pull request before merging** with **Require review from
  Code Owners** (activate CODEOWNERS first — see step 3).
- Enable **Require status checks to pass before merging** and select these
  checks once they are green (exact job names from
  `.github/workflows/verification.yml`):
  - `framework-self-test`
  - `scope-integrity`
  - `authorization-integrity`
  - `authorization-attestation-integrity`
  - `profile-integrity`
  - `project-binding-integrity`
  - `authority-integrity`
  - `evidence-integrity`
  - `oracle-precedence`
  - `inventory-coverage`
  - `behavioral-verification`
  - `provider-health`
  - `change-integrity`
  - `clean-environment`
- **Never** select `completion-report` as a required check: it succeeds when
  the report is generated, not when the project passes (framework spec §25.2).
  Only the global `verify` result establishes completion.
- While the framework build is in progress, some integrity jobs fail for
  truthful reasons (the framework coverage matrix is incomplete; the trust
  root is pending). Configure the rule as soon as the jobs you gate on are
  truthfully green; do not weaken a job to make it green.

### 3. Activate CODEOWNERS

1. Copy `.github/CODEOWNERS.template` to `.github/CODEOWNERS`.
2. Replace `@REPLACE_WITH_YOUR_GITHUB_LOGIN` with your real login.
3. Commit through your own account.

### 4. Scope approval, binding adoption, and binding adequacy witnesses

When you are ready to approve the scope and adopt the binding:

1. Open a pull request containing the witness records (the producer may draft
   the JSON, but the authorization is your review, not the file). Each witness
   record's `hostMetadata` must name the PR number, the review ID (added after
   your review exists), and the commit your review is bound to.
2. Review and approve that PR from your allowlisted account, and **quote the
   witness object hash in your review text** — run
   `node tooling/verification-kit/bin/verify.mjs authorization-attestations`
   to see each witness's object hash, and include the full
   `sha256:…` value in the review body. Live verification rejects an approval
   that does not quote the exact hash, because only the quote binds your
   decision to the exact witness content (a file or comment merely claiming
   approval never verifies). For the binding adequacy witness, the review text
   must additionally evaluate each of the ten adequacy criteria named in
   `verification/binding/project-verification-binding.json`
   `bindingAuthorization.adequacyCriteriaExplicitlyJudged` — a generic
   approval does not establish adequacy (framework spec §7.12).
3. `verify authorization-live` (locally with gh, or the CI
   authorization-live-verification job) then authenticates the approval event
   through the GitHub API — identity against the allowlist (base-revision
   allowlist for allowlist changes), review state, bound commit, quoted hash —
   and produces the hash-bound attestation the clean run consumes (§7.10).
   Live authentication and attestation-integrity checking are distinct: the
   former talks to the host, the latter only verifies retained records.

## What is currently NOT configured (truthful state as of 2026-07-16)

- Branch protection: not configured.
- CODEOWNERS: template only; not active.
- Identity allowlist: empty; bootstrap pending.
- Scope approval, binding adoption, binding adequacy: no witnesses exist.
- Authorization live verification: no attestations exist.
