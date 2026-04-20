/**
 * Tool Registry — the central registry for all available tools.
 *
 * Responsibilities:
 * - Register and store ToolDefinition records
 * - Provide lookup by name
 * - List all tools (optionally filtered by scope)
 * - Export tool schemas for LLM Function Calling injection
 *
 * EL-001: Core infrastructure for the tool ecosystem.
 */

import type { ToolDefinition } from "../types/index.js";
import { BUILTIN_TOOLS } from "./definitions.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    // Pre-load all built-in tools
    for (const tool of BUILTIN_TOOLS) {
      this.register(tool);
    }
  }

  /**
   * Register a new tool. Overwrites if already exists.
   */
  register(def: ToolDefinition): void {
    this.tools.set(def.name, def);
  }

  /**
   * Get a tool by name. Returns undefined if not found.
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns true if a tool with this name is registered.
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tools.
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * List tools filtered by scope.
   */
  listByScope(scope: "internal" | "external"): ToolDefinition[] {
    return this.listTools().filter((t) => t.scope === scope);
  }

  /**
   * Returns the number of registered tools.
   */
  get count(): number {
    return this.tools.size;
  }

  /**
   * Export all tool schemas formatted for OpenAI Function Calling.
   * Returns an array of tool objects suitable for the `tools` parameter
   * in the OpenAI chat completions API.
   */
  getFunctionCallingSchemas(): OpenAIToolSchema[] {
    return this.listTools().map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            tool.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
                ...(p.enum ? { enum: p.enum } : {}),
              },
            ])
          ),
          required: tool.parameters.filter((p) => p.required).map((p) => p.name),
        },
      },
    }));
  }
}

export interface OpenAIToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/** Shared singleton instance — imported by executor, planner, and chat handler */
export const toolRegistry = new ToolRegistry();
