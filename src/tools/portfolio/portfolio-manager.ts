/**
 * Meta-tool portfolio_manager: inner LLM routes to IB read sub-tools (MVP).
 * Trading/order sub-tools are not implemented — extend PORTFOLIO_MANAGER_SUBTOOLS later.
 */

import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { withTimeout } from '../finance/utils.js';
import { ibGetPositions, PORTFOLIO_SUB_TOOL_TIMEOUT_MS } from './ib-subtools-read.js';

export const PORTFOLIO_MANAGER_DESCRIPTION = `
Meta-tool for Interactive Brokers portfolio operations. Pass a natural language question; an inner router selects IB read sub-tools (positions, and more as added). Requires TWS or IB Gateway with API connections enabled.

## When to Use

- User asks about **their** live IB holdings, open positions, or portfolio at the broker
- Account-specific position or contract questions for Interactive Brokers

## When NOT to Use

- Public company fundamentals or market-wide data (use get_financials or get_market_data)
- Non-IB brokers (this integration is IB via TWS/Gateway only)
- Placing, modifying, or canceling orders — not available in the current implementation (read-only MVP)

## Usage

- Call once with the full natural language request; routing is handled inside the tool
`.trim();

export const PORTFOLIO_MANAGER_COMPACT =
  'Interactive Brokers portfolio (meta-tool): inner router to IB read sub-tools — positions (MVP). Requires TWS/Gateway. Read-only; does not place trades.';

const PORTFOLIO_MANAGER_SUBTOOLS: StructuredToolInterface[] = [ibGetPositions];

const PORTFOLIO_TOOL_MAP = new Map(PORTFOLIO_MANAGER_SUBTOOLS.map((t) => [t.name, t]));

function formatSubToolName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildRouterPrompt(): string {
  return `You are an Interactive Brokers portfolio routing assistant.
Current date: ${getCurrentDate()}

Given the user's natural language request, call the appropriate **read-only** sub-tool(s). Only tools listed below exist in this build — there are **no** order, trade, or cancel tools.

## Available sub-tools

- **ib_get_positions** — Fetch all open positions (optional \`account\` filter if the user names a specific account id).

## Guidelines

1. For "what do I hold", "my positions", "open positions", "portfolio holdings" → **ib_get_positions** (no args unless user specifies an account).
2. If the user names an IB account id, pass it as \`account\`.
3. Prefer a **single** sub-tool call when one suffices. Use parallel calls only when the user clearly needs independent operations.
4. Never invent trades or orders — read operations only.

Call the appropriate sub-tool(s) now.`;
}

const PortfolioManagerInputSchema = z.object({
  query: z.string().describe('Natural language request about the IB portfolio'),
});

export function createPortfolioManager(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'portfolio_manager',
    description: `Interactive Brokers portfolio meta-tool. Routes your natural language request to read-only IB sub-tools (open positions in MVP). Requires TWS/IB Gateway. Does not place trades.`,
    schema: PortfolioManagerInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      onProgress?.('Portfolio (IB)...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: PORTFOLIO_MANAGER_SUBTOOLS,
      });
      const aiMessage = response as AIMessage;

      const toolCalls = aiMessage.tool_calls as ToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'No portfolio sub-tools selected for query' }, []);
      }

      const toolNames = [...new Set(toolCalls.map((tc) => formatSubToolName(tc.name)))];
      onProgress?.(`IB: ${toolNames.join(', ')}...`);

      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          try {
            const tool = PORTFOLIO_TOOL_MAP.get(tc.name);
            if (!tool) {
              throw new Error(`Tool '${tc.name}' not found`);
            }
            const rawResult = await withTimeout(
              tool.invoke(tc.args),
              PORTFOLIO_SUB_TOOL_TIMEOUT_MS,
              tc.name,
            );
            const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            const parsed = JSON.parse(result) as { data?: unknown; sourceUrls?: string[] };
            return {
              tool: tc.name,
              args: tc.args,
              data: parsed.data,
              sourceUrls: parsed.sourceUrls || [],
              error: null as string | null,
            };
          } catch (error) {
            return {
              tool: tc.name,
              args: tc.args,
              data: null,
              sourceUrls: [] as string[],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      const successfulResults = results.filter((r) => r.error === null);
      const failedResults = results.filter((r) => r.error !== null);
      const allUrls = results.flatMap((r) => r.sourceUrls);

      const combinedData: Record<string, unknown> = {};

      for (const result of successfulResults) {
        const args = result.args as Record<string, unknown>;
        const account = typeof args.account === 'string' ? args.account : undefined;
        const key = account ? `${result.tool}_${account}` : result.tool;
        combinedData[key] = result.data;
      }

      if (failedResults.length > 0) {
        combinedData._errors = failedResults.map((r) => ({
          tool: r.tool,
          args: r.args,
          error: r.error,
        }));
      }

      return formatToolResult(combinedData, allUrls);
    },
  });
}
