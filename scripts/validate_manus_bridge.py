#!/usr/bin/env python3
from pathlib import Path

workflow = Path('.github/workflows/manus-github-audit.yml').read_text(encoding='utf-8')

required = [
    'name: Manus audit bridge',
    'push:',
    '- manus-audit-control',
    '- .manus/audit-request.json',
    'permissions:',
    'contents: read',
    'issues: write',
    'pull-requests: read',
    'checks: read',
    'group: manus-audit-control',
    'cancel-in-progress: true',
    'test -f .manus/audit-request.json',
    "jq -er '.pr_number'",
    "jq -er '.requested_sha'",
    '[[ "$REQUESTED_SHA" =~ ^[0-9a-f]{40}$ ]]',
    'test "$CURRENT_SHA" = "$REQUESTED_SHA"',
    'MANUS_GITHUB_CONNECTOR_ID',
    'connectors:[$connector_id]',
    'share_visibility:"private"',
    'interactive_mode:false',
    'structured_output_schema',
    'https://api.manus.ai/v2/task.create',
    'https://api.manus.ai/v2/task.listMessages',
    'MANUS_API_KEY: ${{ secrets.MANUS_API_KEY }}',
    'test "$sha" = "$REQUESTED_SHA"',
    'current_sha=',
    'MANUS: STALE',
    'MANUS: MERGE',
    'MANUS: BLOCKER',
    'ChatGPT is the sole merge coordinator',
]

for needle in required:
    assert needle in workflow, f'missing bridge invariant: {needle}'

for forbidden in [
    'contents: write',
    'pull-requests: write',
    'git push',
    'gh pr merge',
    'enable_auto_merge',
    'share_visibility:"public"',
    'branches:\n      - main',
    'issue_comment:',
]:
    assert forbidden not in workflow, f'forbidden bridge capability: {forbidden}'

assert workflow.endswith('\n'), 'workflow must end with newline'
print('Manus minimal exact-SHA bridge invariants: PASS')
