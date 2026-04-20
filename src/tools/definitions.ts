/**
 * Built-in tool definitions for the Execution Loop.
 *
 * Scope rules (Sprint 05):
 * - "internal" tools: operate on local system data only (memory, task, etc.)
 * - "external" tools: make outbound HTTP calls, always subject to ToolGuardrail
 *
 * All tools follow the ToolDefinition contract from types/index.ts.
 */

import type { ToolDefinition } from "../types/index.js";

// ── Internal tools ─────────────────────────────────────────────────────────

/**
 * Search user memory entries by keyword.
 * Used to surface relevant memories during task execution.
 */
export const memorySearchTool: ToolDefinition = {
  name: "memory_search",
  description:
    "Search the user's persistent memory for entries matching a keyword or topic. " +
    "Returns the most relevant memory entries with their content and category. " +
    "Use this when the task requires recalling something the user has previously mentioned.",
  scope: "internal",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Keyword or phrase to search memory for.",
      required: true,
    },
    {
      name: "max_results",
      type: "number",
      description: "Maximum number of results to return (default: 5).",
      required: false,
    },
  ],
};

/**
 * Read a task's current state and summary.
 */
export const taskReadTool: ToolDefinition = {
  name: "task_read",
  description:
    "Read the current state and summary of an existing task. " +
    "Use this to check what has been done, what is blocked, and what the next step should be.",
  scope: "internal",
  parameters: [
    {
      name: "task_id",
      type: "string",
      description: "The ID of the task to read.",
      required: true,
    },
  ],
};

/**
 * Update a task's status or fields after completing a step.
 */
export const taskUpdateTool: ToolDefinition = {
  name: "task_update",
  description:
    "Update a task's status, summary, or counters. " +
    "Use this to mark a step as completed, update the task goal, or increment step/call counters.",
  scope: "internal",
  parameters: [
    {
      name: "task_id",
      type: "string",
      description: "The ID of the task to update.",
      required: true,
    },
    {
      name: "status",
      type: "string",
      description: "New task status.",
      required: false,
      enum: ["pending", "running", "completed", "failed", "blocked"],
    },
    {
      name: "next_step",
      type: "string",
      description: "Description of the next step to take.",
      required: false,
    },
    {
      name: "completed_step",
      type: "string",
      description: "Description of a step that was just completed (appends to completed_steps).",
      required: false,
    },
  ],
};

/**
 * Create a new sub-task under the current session.
 */
export const taskCreateTool: ToolDefinition = {
  name: "task_create",
  description:
    "Create a new task record. Use this when the execution requires tracking a separate " +
    "sub-goal that should outlive the current execution loop iteration.",
  scope: "internal",
  parameters: [
    {
      name: "title",
      type: "string",
      description: "Short title for the new task.",
      required: true,
    },
    {
      name: "mode",
      type: "string",
      description: "Execution mode: 'direct', 'research', or 'execute'.",
      required: false,
      enum: ["direct", "research", "execute"],
    },
    {
      name: "goal",
      type: "string",
      description: "The goal or objective of this task.",
      required: false,
    },
  ],
};

// ── External tools ─────────────────────────────────────────────────────────

/**
 * Make an outbound HTTP GET request to a pre-approved endpoint.
 * All calls pass through ToolGuardrail (allowlist, method check, size limit).
 */
export const httpRequestTool: ToolDefinition = {
  name: "http_request",
  description:
    "Make an outbound HTTP GET request to a whitelisted external API. " +
    "Only whitelisted hosts are permitted. Returns the response body as text or JSON. " +
    "Use this to fetch live data from approved external services.",
  scope: "external",
  parameters: [
    {
      name: "url",
      type: "string",
      description:
        "The full URL to request. Must be on the allowlist (see guardrail config).",
      required: true,
    },
    {
      name: "headers",
      type: "object",
      description: "Optional HTTP headers as key-value pairs.",
      required: false,
    },
  ],
};

/**
 * Search the web for information.
 * Uses the configured web search provider.
 */
export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Search the web for information relevant to the current task. " +
    "Returns a list of results with titles and snippets. " +
    "Use this when the task requires up-to-date information not available from memory.",
  scope: "external",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "The search query.",
      required: true,
    },
    {
      name: "max_results",
      type: "number",
      description: "Maximum number of results to return (default: 5).",
      required: false,
    },
  ],
};

// ── Registry of all built-in tools ────────────────────────────────────────

export const BUILTIN_TOOLS: ToolDefinition[] = [
  memorySearchTool,
  taskReadTool,
  taskUpdateTool,
  taskCreateTool,
  httpRequestTool,
  webSearchTool,
];

export const TOOL_NAMES = BUILTIN_TOOLS.map((t) => t.name);
