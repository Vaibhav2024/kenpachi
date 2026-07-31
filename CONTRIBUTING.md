# Contributing to kenpachi-sdk

Thanks for considering a contribution!

## Setup

\`\`\`bash
git clone https://github.com/Vaibhav2024/kenpachi-sdk.git
cd kenpachi-sdk
npm install
\`\`\`

## Before opening a PR

\`\`\`bash
npm run typecheck
npm run test
npm run lint
npm run build
\`\`\`

All four must pass. Please add or update tests for any behavior change.

## Commit style

Use conventional-commit-style prefixes where it makes sense: `feat:`, `fix:`,
`docs:`, `test:`, `chore:`. Not strictly enforced, but it keeps history readable.

## Reporting issues

Please include: Node version, a minimal reproduction, and the actual vs.
expected behavior.