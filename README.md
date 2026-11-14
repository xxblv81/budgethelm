# Budgethelm

Stops AI coding agents when they get stuck in a loop or burn tokens far above their normal rate, and shows token spend per project, agent and model.

Works with Claude Code, Codex CLI, Gemini CLI, Cursor and more. Website: <https://agentops.agentops.workers.dev/en>

This repository holds the parts that run on your computer (the connect script, the npm launcher, the Claude Code plugin) and the MCP Registry listing. The hosted dashboard is not in this repository.

## Install

macOS / Linux:

```sh
curl -fsSL https://agentops.agentops.workers.dev/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://agentops.agentops.workers.dev/install.ps1 | iex
```

With Node.js 18+ (npm package `budgethelm`):

```sh
npx budgethelm
```

All three do the same thing: a browser page opens once, you click **Authorize**, and the rest is automatic (guard hooks for the AI tools it finds, the Budgethelm MCP for Claude Code, usage upload, a scan of AI tool config files, start at login). Each settings file is backed up before it is changed.

Remove everything:

```sh
node ~/.agentops/agentops-connect.mjs --uninstall
```

Look before you install: `npx budgethelm --help` prints every option (the help text is in Traditional Chinese for now), and running `node agentops-connect.mjs` with no options only detects tools and prints what would be sent, without sending anything.

## Claude Code plugin

```text
/plugin marketplace add xxblv81/budgethelm
/plugin install budgethelm@budgethelm
```

The plugin adds the Budgethelm MCP server (sign in through the browser on first use) and a `/budgethelm:setup` skill that walks you through the installer. If you already ran the installer, Claude Code also has an MCP server named `agentops` that points to the same service; you only need one of them.

## MCP server

Remote MCP (Streamable HTTP, OAuth 2.1): `https://agentops.agentops.workers.dev/api/mcp`

```sh
claude mcp add --transport http budgethelm https://agentops.agentops.workers.dev/api/mcp
```

Listed in the official MCP Registry as `io.github.xxblv81/budgethelm`.

## What leaves your computer

Time, model name and token counts. Model API keys, conversation content, code and file paths stay on your computer. Budgethelm never calls models for you and never holds your model API keys.

## Pricing

Free while in beta. Pro will be US$1.99/month; payments are not open yet and nothing is charged until they are.

## Names

The product was called AgentOps before 2026-11-10. Internal names (`~/.agentops`, `AGENTOPS_*` variables, `agentops-connect.mjs`, the `agentops.workers.dev` address) stay the same so existing installs keep working. Budgethelm is not related to agentops.ai.

## License

MIT
