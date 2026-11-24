# Budgethelm plugin

Budgethelm shows how many tokens your AI coding agents use per project, agent and model, and stops an agent that keeps failing or burns tokens far above its normal rate. This plugin adds the Budgethelm MCP server and a `setup` skill to your editor.

## What it contains

- **MCP server `budgethelm`**: reads usage and cost for the projects in your Budgethelm account. The first time you use it, a browser page asks you to sign in.
- **Skill `setup`**: installs the guard hook and the usage uploader on your computer after you confirm.

## What is sent where

Usage uploads go to `budgethelm.agentops.workers.dev` (the MCP endpoint is still served from `agentops.agentops.workers.dev`; both names answered the same way when we tested them on 2026-11-24). The uploader sends the time, the tool name with the project folder name, the model name and token counts. It also sends a random machine id, your operating system and the list of AI tools it found, plus the type, severity, relative file name and line number of scan findings. It does not send conversation content, source code, secret values or model API keys. The guard hook itself makes no network calls.

Remove everything with `node ~/.agentops/agentops-connect.mjs --uninstall`.

Website: <https://budgethelm.agentops.workers.dev> · License: MIT
