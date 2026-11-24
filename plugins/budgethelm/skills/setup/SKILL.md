---
name: setup
description: Install Budgethelm on this computer so runaway AI agents get stopped and token usage is tracked. Use when the user asks to set up, install, or connect Budgethelm.
---

# Set up Budgethelm

Budgethelm installs a small guard hook for Claude Code (and Codex, Gemini CLI, Cursor if present) that stops an agent when it keeps failing or burns tokens far above its normal rate, and uploads usage counts (time, model, token numbers) so the user can see spend per project.

What leaves the computer: time, model name, token counts and the AI tool name. The security scan sends the issue type, severity, relative file name and line number (not file contents or the values of secrets it finds), and the settings check sends a rule code and the settings file location. Model API keys, conversation content and code stay local.

Steps:

1. Tell the user what will be installed (hook files under `~/.claude/hooks`, a backup of each settings file before it is changed, a scheduled background job, files in `~/.agentops`) and ask them to confirm.
2. After they confirm, run the installer for their system:
   - macOS / Linux: `curl -fsSL https://agentops.agentops.workers.dev/install.sh | sh`
   - Windows PowerShell: `irm https://agentops.agentops.workers.dev/install.ps1 | iex`
3. The installer opens a browser page once; the user clicks "Authorize". Everything else is automatic.
4. To remove everything later: `node ~/.agentops/agentops-connect.mjs --uninstall`.

The MCP server that comes with this plugin (`budgethelm`) asks the user to sign in through the browser the first time it is used.
