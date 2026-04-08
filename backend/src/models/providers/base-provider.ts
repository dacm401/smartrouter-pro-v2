import type { ChatMessage } from "../../types/index.js";

/** Minimal shape for Function Calling tool parameters (provider-agnostic) */
export interface ToolCallParam {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** OpenAI-compatible tool schema shape */
export interface ToolParam {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  /** Present when the model issued one or more tool calls via Function Calling */
  tool_calls?: ToolCallParam[];
}

export interface ModelProvider {
  name: string;
  supports(model: string): boolean;
  chat(
    model: string,
    messages: ChatMessage[],
    tools?: ToolParam[]
  ): Promise<ModelResponse>;
}
