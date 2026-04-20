/**
 * Fast 模型可用的工具定义
 * 放在独立文件，避免循环依赖
 */
import type { ToolParam } from "../models/providers/base-provider.js";

/** web_search 工具 schema */
export const WEB_SEARCH_TOOL: ToolParam = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for real-time information such as weather, news, stock prices, sports scores, or any factual data that requires up-to-date information. Use this when the user's query asks about current events, recent data, or information beyond your knowledge cutoff date.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query. Max 200 characters. Be specific and concise.",
          maxLength: 200,
        },
        max_results: {
          type: "integer",
          description: "Maximum number of results to return. Range: 1-10.",
          minimum: 1,
          maximum: 10,
          default: 5,
        },
      },
      required: ["query"],
    },
  },
};

/** Fast 模型所有可用工具列表 */
export const FAST_MODEL_TOOLS: ToolParam[] = [WEB_SEARCH_TOOL];

export type { ToolParam };
