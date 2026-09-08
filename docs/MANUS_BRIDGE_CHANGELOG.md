# Manus bridge repair

This repair addresses the two practical causes of lost ChatGPT→Manus handoffs observed in the current Voyage coordination flow:

1. Voyage did not have a Manus audit workflow on its default branch, so PR comments could not wake Manus.
2. Existing coordination comments use `[VOYAGE][CHATGPT→MANUS]` / `[VOYAGE][CLAUDE→MANUS]`, while the older bridge convention only recognized explicit `@manus` commands.

The new bridge accepts both conventions from trusted repository actors, binds every task/result to an exact 40-character PR HEAD SHA, polls for structured output, suppresses stale approvals, and publishes the result back to the originating PR. It stays read-only with respect to repository contents and merge operations.
