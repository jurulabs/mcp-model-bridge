import type {
  AgentDefinition,
  AgentRunResult,
  GatewayClient,
  GatewayMessage,
  ResolvedModel,
  StopReason,
  ToolCall,
  WorkspaceTool,
} from './types.js';

const MAX_TOOL_OUTPUT_CHARS = 8_000;
const TOOL_BLOCK_PATTERN = /```tool\s*\r?\n[\s\S]*?```/g;

export interface BoundedAgentRun {
  readonly agent: AgentDefinition;
  readonly model: ResolvedModel;
  readonly task: string;
  readonly gateway: GatewayClient;
  readonly tools: readonly WorkspaceTool[];
  readonly maxRounds: number;
}

/**
 * Drives an agent definition against a gateway for a bounded number of rounds.
 *
 * The ceiling is the budget: a loop that cannot run away cannot spend without
 * limit. Tool failures are reported back as text so the model can correct
 * itself, which keeps one bad call from ending an otherwise healthy run.
 */
export async function runBoundedAgent(run: BoundedAgentRun): Promise<AgentRunResult> {
  if (run.maxRounds < 1) {
    throw new Error('maxRounds must be at least 1');
  }

  const toolsByName = new Map(run.tools.map((tool) => [tool.name, tool]));
  const toolNames = run.tools.map((tool) => tool.name);
  const messages: GatewayMessage[] = [{ role: 'user', content: run.task }];

  let roundsUsed = 0;
  let toolCallsMade = 0;
  let output = '';
  let stoppedReason: StopReason = 'round-limit';

  while (roundsUsed < run.maxRounds) {
    roundsUsed += 1;

    const reply = await run.gateway.complete({
      model: run.model.id,
      systemPrompt: run.agent.systemPrompt,
      messages,
      toolNames,
    });

    output = reply.text;

    if (reply.toolCalls.length === 0) {
      stoppedReason = 'completed';
      break;
    }

    messages.push({ role: 'assistant', content: reply.text });

    const observations: string[] = [];
    for (const call of reply.toolCalls) {
      toolCallsMade += 1;
      observations.push(await executeTool(toolsByName, call));
    }

    messages.push({ role: 'user', content: observations.join('\n\n') });
  }

  return {
    output: stripToolBlocks(output),
    modelUsed: run.model.id,
    tierRequested: run.model.tier,
    roundsUsed,
    toolCallsMade,
    stoppedReason,
  };
}

/**
 * Removes the tool-call protocol from the text handed back to the caller.
 *
 * A run stopped by the round limit ends on a turn that was still requesting
 * tools, so without this the caller receives protocol noise instead of prose.
 */
function stripToolBlocks(text: string): string {
  return text.replace(TOOL_BLOCK_PATTERN, '').trim();
}

async function executeTool(
  toolsByName: ReadonlyMap<string, WorkspaceTool>,
  call: ToolCall,
): Promise<string> {
  const tool = toolsByName.get(call.tool);
  if (!tool) {
    const available = [...toolsByName.keys()].join(', ') || '(none)';
    return `[${call.tool}] Error: unknown tool. Available tools: ${available}.`;
  }

  try {
    const result = await tool.run(call.input);
    return `[${call.tool}]\n${truncate(result, MAX_TOOL_OUTPUT_CHARS)}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `[${call.tool}] Error: ${reason}`;
  }
}

function truncate(content: string, limit: number): string {
  return content.length <= limit
    ? content
    : `${content.slice(0, limit)}\n… truncated at ${limit} characters …`;
}


