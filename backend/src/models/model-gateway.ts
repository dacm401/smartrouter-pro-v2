import type { ChatMessage } from "../types/index.js";
import type { ModelProvider, ModelResponse, ToolParam } from "./providers/base-provider.js";
import { openaiProvider } from "./providers/openai.js";
import { anthropicProvider } from "./providers/anthropic.js";

const providers: ModelProvider[] = [openaiProvider, anthropicProvider];

export async function callModel(model: string, messages: ChatMessage[]): Promise<string> {
  const response = await callModelFull(model, messages);
  return response.content;
}

export async function callModelFull(model: string, messages: ChatMessage[]): Promise<ModelResponse> {
  const provider = providers.find((p) => p.supports(model));
  if (!provider) throw new Error(`No provider found for model: ${model}`);
  try { return await provider.chat(model, messages); }
  catch (error: any) { console.error(`Model call failed [${model}]:`, error.message); throw error; }
}

/**
 * Call the model with Function Calling tools enabled.
 * Returns the full ModelResponse (may contain tool_calls).
 */
export async function callModelWithTools(
  model: string,
  messages: ChatMessage[],
  tools: ToolParam[]
): Promise<ModelResponse> {
  const provider = providers.find((p) => p.supports(model));
  if (!provider) throw new Error(`No provider found for model: ${model}`);
  try { return await provider.chat(model, messages, tools); }
  catch (error: any) { console.error(`Model call failed with tools [${model}]:`, error.message); throw error; }
}

export function getAvailableModels(): string[] {
  return ["gpt-4o-mini", "gpt-4o", "claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"];
}
