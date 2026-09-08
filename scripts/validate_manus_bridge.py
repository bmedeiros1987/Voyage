#!/usr/bin/env python3
from pathlib import Path

workflow = Path('.github/workflows/manus-github-audit.yml').read_text(encoding='utf-8')

required = [
    'name: Manus audit bridge',
    'push:',
    '- manus-audit-control',
    "- '.manus/audit-request.json'",
    'issue_comment:',
    'workflow_dispatch:',
    '- name: Authorize trusted trigger',
    'EVENT_NAME: ${{ github.event_name }}',
    'REF_NAME: ${{ github.ref_name }}',
    "COMMENT_ASSOCIATION: ${{ github.event.comment.author_association || '' }}",
    "COMMENT_BODY: ${{ github.event.comment.body || '' }}",
    'if [ "$REF_NAME" = "manus-audit-control" ]; then',
    'OWNER|MEMBER|COLLABORATOR)',
    '[[ "$COMMENT_BODY" == "@manus "* ]]',
    '[[ "$COMMENT_BODY" == "[VOYAGE][CHATGPT→MANUS]"* ]]',
    'echo "allowed=$allowed" >> "$GITHUB_OUTPUT"',
    "if: steps.trigger.outputs.allowed == 'true'",
    'EXPECTED_SHA=',
    '.manus/audit-request.json',
    "jq -r '.requested_sha'",
    'Control request is stale:',
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
    "branches:\n      - main",
]:
    assert forbidden not in workflow, f'forbidden bridge capability: {forbidden}'

# Authorization must happen inside a real job rather than suppressing the job
# with a complex top-level `jobs.<id>.if`, so failures remain observable.
request_job = workflow.split('request-audit:', 1)[1]
pre_steps = request_job.split('steps:', 1)[0]
assert '\n    if:' not in pre_steps, 'request-audit must not have a top-level job if gate'

print('Manus bridge static invariants: PASS')
