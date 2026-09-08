#!/usr/bin/env python3
from pathlib import Path

workflow = Path('.github/workflows/manus-github-audit.yml').read_text(encoding='utf-8')

required = [
    'issue_comment:',
    'workflow_dispatch:',
    "github.event.comment.author_association == 'OWNER'",
    "startsWith(github.event.comment.body, '[VOYAGE][CHATGPT→MANUS]')",
    'MANUS_GITHUB_CONNECTOR_ID',
    'MANUS_API_KEY',
    'share_visibility: "private"',
    'interactive_mode: false',
    'structured_output_schema',
    '[[ "$SHA" =~ ^[0-9a-f]{40}$ ]]',
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
    'permissions:\n  contents: write',
    'pull-requests: write',
    'git push',
    'gh pr merge',
    'enable_auto_merge',
    'share_visibility: "public"',
]:
    assert forbidden not in workflow, f'forbidden bridge capability: {forbidden}'

print('Manus bridge static invariants: PASS')
