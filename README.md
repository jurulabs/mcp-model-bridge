# MCP Model Bridge

Runs an agent definition from `.github/agents/` against a model **you name**, instead of the one the IDE session happens to use.

Copilot agent definitions carry no `model` field, so a subagent inherits the session model. This server closes that gap: it reads the agent file, uses its body as the system prompt, and executes a bounded tool loop against a chosen model.

**Project-independent.** Nothing here is tied to the repository it was developed in. Point it at any project and it picks up that project's agents and that project's model policy.

## Status

MVP. Ships with a **mock gateway** so the wiring is testable without credentials. Point it at a real endpoint with two environment variables.

## Install

The bridge is a developer tool, not a runtime dependency. Install it once, use it everywhere.

```powershell
# from a checkout
npm install
npm run build
npm link
```

```powershell
# or straight from a git remote, once the package lives in its own repo
npm install -g git+https://github.com/<you>/mcp-model-bridge.git
```

```powershell
# or from a registry, if you publish it
npm install -g @jurulabs/mcp-model-bridge
```

All three put `mcp-model-bridge` on the PATH.

## Quick start

```powershell
npm run smoke
```

The smoke test spawns the built server against a fixture project under `test/fixture-workspace` that has nothing to do with the surrounding repository. It asserts that the bridge discovers that project's agents and policy, and that the same agent reports different models on different tiers.

Point it at a real project instead:

```powershell
node scripts/smoke-test.mjs C:\path\to\any\project
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BRIDGE_WORKSPACE_ROOT` | `process.cwd()` | The host project. Root for path confinement and tool access. |
| `BRIDGE_AGENTS_DIR` | `<root>/.github/agents` | Where agent definitions live |
| `BRIDGE_MODEL_POLICY` | auto-discovered | Tier map and allow-list |
| `BRIDGE_GATEWAY_URL` | *(unset → mock)* | Anthropic-style Messages endpoint |
| `BRIDGE_GATEWAY_TOKEN` | *(unset → mock)* | Credential, read from the environment only |

In practice only `BRIDGE_WORKSPACE_ROOT` needs setting. Everything else is discovered.

With `BRIDGE_GATEWAY_URL` and `BRIDGE_GATEWAY_TOKEN` unset, the server runs the mock gateway and reports `gateway: mock`. A half-configured gateway also reports `mock`, which surfaces the missing variable instead of hiding it behind a confident label.

## Model policy

The policy file holds the tier map and the allow-list:

```json
{
  "tiers": { "cheap": "gpt-5.6-luna", "default": "claude-sonnet-5", "strong": "claude-opus-5" },
  "allowedModels": ["gpt-5.6-luna", "claude-sonnet-5", "claude-opus-5"]
}
```

It is looked up in this order:

1. `BRIDGE_MODEL_POLICY`, if set
2. `<workspaceRoot>/.github/model-policy.json` — the host project's own policy
3. the bundled `model-policy.json` — so a fresh project needs no setup

`list_agents` reports which one won, as `source: explicit | workspace | bundled`.

A model outside `allowedModels` is **refused with an explicit error**. Silent fallback to an expensive model is the failure mode that costs money without anyone noticing, so it is not offered.

## Tools

### `run_agent`

| Parameter | Required | Meaning |
|---|---|---|
| `agent` | yes | File stem under the agents directory, e.g. `Explorer` |
| `task` | yes | The instruction, including the desired output contract |
| `model` | no | Tier name (`cheap`, `default`, `strong`) or an allow-listed model id |
| `maxRounds` | no | Tool rounds before stopping, default 4, ceiling 10 |

Returns the agent's output followed by a provenance block:

```
agent: Explorer
model used: gpt-5.6-luna (tier: cheap)
rounds: 2, tool calls: 1
stopped: completed
```

The provenance block is the point of the exercise. A bridge that runs but reports the session model has failed at the only thing it exists to do.

### `list_agents`

Reports the agents directory, the active policy file and where it came from, the tier map, the allow-list, and whether the gateway is live or mocked.

## Registering in JetBrains

*Settings → Tools → GitHub Copilot → Model Context Protocol (MCP)*

```json
{
  "servers": {
    "model-bridge": {
      "command": "mcp-model-bridge",
      "env": {
        "BRIDGE_WORKSPACE_ROOT": "C:\\path\\to\\the\\project\\you\\are\\working\\in"
      }
    }
  }
}
```

If you did not link the binary onto the PATH, call the entry point directly instead:

```json
{
  "command": "node",
  "args": ["C:\\path\\to\\mcp-model-bridge\\dist\\index.js"]
}
```

Run `npm run build` first — the entry point is the compiled `dist/index.js`.

## Safety

- **Read-only toolset.** `read_file` and `grep_search` only; a cheap model driving these tools cannot edit anything.
- **Path confinement.** Every requested path resolves against the workspace root; traversal is refused.
- **Round ceiling.** The loop cannot run away, so it cannot spend without limit.
- **Credentials from the environment.** Never from the agent file or the policy file.
- **Separate billing.** Gateway calls are charged outside the Copilot subscription. Two cost centres exist; only one appears in the IDE.

## Architecture

The full design, including the variants considered and why this scope was chosen, lives in the global `ai-automation` skill:

```
~/.agents/skills/ai-automation/MCP-BRIDGE.md
```

To move this package into its own repository, see [EXTRACTION.md](./EXTRACTION.md).

## Known limits

- Agent bodies written for richer toolsets degrade here. An agent that relies on `semantic_search` falls back to `grep_search`.
- The gateway client implements an Anthropic-style Messages schema. A different upstream shape is a one-file change in `src/gateway-client.ts`.
- Tool calls travel as fenced ` ```tool ` blocks rather than a native tool-calling API, which keeps the bridge portable at the cost of some reliability on weaker models.
- Publishing under the `@jurulabs` scope requires owning that scope on the target registry. Git and `npm link` installs need no registry at all.

