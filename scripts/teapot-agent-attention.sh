#!/usr/bin/env bash
# Teapot agent-attention signal.
#
# Writes one JSON file per worktree into the repository's shared git dir:
#   <git-common-dir>/teapot/agents/<sha1-of-worktree>.json
#
# The VS Code extension reads those files to show a worktree attention marker.
# Best-effort and non-blocking: failures exit 0 so hooks never block the agent.
set -uo pipefail

payload=$(cat)

{
  read -r event
  read -r cwd
} < <(
  python3 -c '
import json
import os
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    print("")
    sys.exit(0)

event = (
    data.get("hook_event_name")
    or data.get("event")
    or data.get("event_name")
    or data.get("name")
    or ""
)
cwd = (
    data.get("cwd")
    or data.get("project_dir")
    or data.get("workspace_root")
    or os.getcwd()
)

print(event)
print(cwd)
' <<<"$payload"
)

[ -n "${cwd:-}" ] || exit 0

{
  read -r worktree
  read -r common
} < <(
  git -C "$cwd" rev-parse --path-format=absolute --show-toplevel --git-common-dir 2>/dev/null
)
[ -n "${worktree:-}" ] && [ -n "${common:-}" ] || exit 0

dir="$common/teapot/agents"
hash=$(printf '%s' "$worktree" | shasum | cut -d' ' -f1)
file="$dir/$hash.json"
agent="${TEAPOT_AGENT_NAME:-agent}"

case "$event" in
  UserPromptSubmit | user_prompt_submit | PostToolUse | post_tool_use | SessionEnd | session_end | SessionStart | session_start)
    rm -f "$file"
    ;;
  Notification | notification | Stop | stop)
    mkdir -p "$dir"
    state="done"
    case "$event" in
      Notification | notification)
        state="needs-input"
        ;;
    esac
    wt_json=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$worktree")
    agent_json=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$agent")
    tmp="$file.$$.tmp"
    printf '{"worktreePath":%s,"state":"%s","agent":%s,"updatedAt":%s}\n' \
      "$wt_json" "$state" "$agent_json" "$(date +%s)" >"$tmp" && mv -f "$tmp" "$file"
    ;;
esac

exit 0
