# MCP Model Bridge

Runs an agent definition from `.github/agents/` against a model **you name**, instead of the one the IDE session happens to use.

Copilot agent definitions carry no `model` field, so a subagent inherits the session model. This server closes that gap: it reads the agent file, uses its body as the system prompt, and executes a bounded tool loop against a chosen model.

## Status

MVP. Ships with a **mock gateway** so the wiring is testable without credentials. Point it at a real endpoint with two environment variables.

## Quick start

```powershell
npm install
npm run smoke --workspace=packages/mcp-model-bridge
```

The smoke test spawns the server over stdio and asserts the acceptance criterion: the same agent reports different models on different tiers.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BRIDGE_WORKSPACE_ROOT` | `process.cwd()` | Root for path confinement and tool access |
| `BRIDGE_AGENTS_DIR` | `<root>/.github/agents` | Where agent definitions live |
| `BRIDGE_MODEL_POLICY` | `<root>/packages/mcp-model-bridge/model-policy.json` | Tier map and allow-list |
| `BRIDGE_GATEWAY_URL` | *(unset → mock)* | Anthropic-style Messages endpoint |
| `BRIDGE_GATEWAY_TOKEN` | *(unset → mock)* | Credential, read from the environment only |

With `BRIDGE_GATEWAY_URL` and `BRIDGE_GATEWAY_TOKEN` unset, the server runs the mock gateway and reports `gateway: mock`.

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

Reports the agents directory, the tier map, the allow-list, and whether the gateway is live or mocked.

## Model policy

`model-policy.json` holds the tier map and the allow-list:

```json
{
  "tiers": { "cheap": "gpt-5.6-luna", "default": "claude-sonnet-5", "strong": "claude-opus-5" },
  "allowedModels": ["gpt-5.6-luna", "claude-sonnet-5", "claude-opus-5"]
}
```

A model outside `allowedModels` is **refused with an explicit error**. Silent fallback to an expensive model is the failure mode that costs money without anyone noticing, so it is not offered.

## Registering in JetBrains

*Settings → Tools → GitHub Copilot → Model Context Protocol (MCP)*

```json
{
  "servers": {
    "model-bridge": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\WebstormProjects\\jurulabs-shopify\\packages\\mcp-model-bridge\\dist\\index.js"],
      "env": {
        "BRIDGE_WORKSPACE_ROOT": "C:\\Users\\<you>\\WebstormProjects\\jurulabs-shopify"
      }
    }
  }
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

## Known limits

- Agent bodies written for richer toolsets degrade here. `Explorer` relies on `semantic_search`, which the bridge does not offer; it falls back to `grep_search`.
- The gateway client implements an Anthropic-style Messages schema. A different upstream shape is a one-file change in `gateway-client.ts`.
- Tool calls travel as fenced ` ```tool ` blocks rather than a native tool-calling API, which keeps the bridge portable at the cost of some reliability on weaker models.

