import fs from 'node:fs';
import path from 'node:path';
import { fail } from './storage.mjs';

// Records may be committed, even to a public repository, so anything shaped like
// a credential is refused on write and flagged by torch doctor. The patterns are
// plain ERE so the public-repo workflow can grep for the same shapes.
export const secretPatterns = [
  ['private key', '-----BEGIN [A-Z ]*PRIVATE KEY-----'],
  ['AWS access key', '\\bAKIA[0-9A-Z]{16}\\b'],
  ['GitHub token', '\\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})'],
  ['API key', '\\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}'],
  ['Stripe key', '\\b[rs]k_live_[0-9A-Za-z]{16,}'],
  ['Slack token', '\\bxox[abprs]-[A-Za-z0-9-]{10,}'],
  ['Google API key', '\\bAIza[0-9A-Za-z_-]{35}'],
  ['password in a URL', '[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]:/@]+:[^[:space:]/@]+@'],
];
const compiled = secretPatterns.map(([name, source]) => [name, new RegExp(source.replaceAll('[:space:]', '\\s'))]);

export const findSecret = value => compiled.find(([, pattern]) => pattern.test(value))?.[0];
export function checkSecrets(value, label) {
  const found = findSecret(value || '');
  if (found) fail(`${label} looks like it contains a credential (${found}). Remove it: Torch records may be committed to git. Nothing was written.`);
}
// One line per record file under .torch/ that looks like it holds a credential.
export function secretWarnings(root) {
  const found = [], walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
        const kind = findSecret(fs.readFileSync(file, 'utf8'));
        if (kind) found.push(`${path.relative(root, file)} looks like it contains a credential (${kind}).`);
      }
    }
  };
  if (fs.existsSync(path.join(root, '.torch'))) walk(path.join(root, '.torch'));
  return found;
}

// Written by torch init --public. Pull requests are checked with
// pull_request_target, which runs this file from the base branch and reads the
// diff through the API without checking it out, so a stranger's pull request
// can neither change the check nor run code. Matches are never printed.
const scan = (flags, target) => `          while IFS= read -r pattern; do
            if grep -${flags} -- "$pattern" ${target}; then found=1; fi
          done <<'PATTERNS'
${secretPatterns.map(([, pattern]) => `          ${pattern}`).join('\n')}
          PATTERNS`;
export const guardWorkflow = `# Written by torch init --public. Guards Torch records in a public repository.
# "pull-request" runs on every pull request, so it can be a required check.
name: Torch guard
on:
  pull_request_target:
  push:
    branches: [main, master]
permissions:
  contents: read
  pull-requests: read
jobs:
  pull-request:
    if: github.event_name == 'pull_request_target'
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: \${{ github.token }}
      PR: \${{ github.event.pull_request.number }}
      REPO: \${{ github.repository }}
      ASSOCIATION: \${{ github.event.pull_request.author_association }}
    steps:
      - name: Only maintainers change .torch/, and never with credentials
        run: |
          # Files first, so a failed API call stops the job instead of passing it.
          gh pr diff "$PR" --repo "$REPO" --name-only > files
          gh pr diff "$PR" --repo "$REPO" > pr.diff
          grep -q '^\\.torch/' files || exit 0
          case "$ASSOCIATION" in OWNER|MEMBER|COLLABORATOR) ;; *)
            echo "::error::Only maintainers may change .torch/. Remove the .torch/ changes from this pull request."
            exit 1;;
          esac
          # Lines this pull request adds to files under .torch/.
          awk '/^diff --git /{t = ($4 ~ /^b\\/\\.torch\\//)} t && /^\\+/ && !/^\\+\\+\\+ /{print substr($0, 2)}' pr.diff > torch-lines
          found=0
${scan('qE', 'torch-lines')}
          if [ "$found" = 1 ]; then
            echo "::error::This pull request adds something to .torch/ that looks like a credential. Remove it and rotate the credential."
            exit 1
          fi
  main:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: No credentials in .torch/
        run: |
          [ -d .torch ] || exit 0
          found=0
${scan('rqE', '.torch')}
          if [ "$found" = 1 ]; then
            echo "::error::.torch/ looks like it contains a credential. Remove it and rotate the credential; git history keeps old versions."
            exit 1
          fi
`;
