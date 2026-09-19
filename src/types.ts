/**
 * Shared types for the MCP model bridge.
 *
 * The bridge reads an agent definition, resolves a model, and runs a bounded
 * loop against a gateway. Each stage exchanges data through the shapes below.
 */

/** An agent definition parsed from a `.agent.md` file. */
export interface AgentDefinition {
  readonly name: string;
  readonly description: string;
  readonly declaredTools: readonly string[];
  readonly systemPrompt: string;
}

/** A model the bridge is allowed to call, resolved from the policy file. */
export interface ResolvedModel {
  readonly id: string;
  readonly tier: string;
}

/** One message in the conversation the bridge maintains with the gateway. */
export interface GatewayMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** A tool invocation requested by the model. */
export interface ToolCall {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

/** What the gateway returned for one round. */
export interface GatewayReply {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
}

/** Abstraction over the upstream LLM API, so the transport can be swapped. */
export interface GatewayClient {
  complete(request: GatewayRequest): Promise<GatewayReply>;
}

export interface GatewayRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly GatewayMessage[];
  readonly toolNames: readonly string[];
}

/** A workspace tool the bounded loop offers to the model. */
export interface WorkspaceTool {
  readonly name: string;
  readonly describe: string;
  run(input: Record<string, unknown>): Promise<string>;
}

/** Outcome of a bounded agent run. */
export interface AgentRunResult {
  readonly output: string;
  readonly modelUsed: string;
  readonly tierRequested: string;
  readonly roundsUsed: number;
  readonly toolCallsMade: number;
  readonly stoppedReason: StopReason;
}

export type StopReason = 'completed' | 'round-limit';

