/**
 * IB read sub-tools (MVP: open positions). Uses @stoqey/ib only — no order APIs.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { IBApi, EventName } from '@stoqey/ib';
import type { Contract } from '@stoqey/ib';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { getIbConnectionOptions } from './config.js';

/** Allow longer than HTTP finance sub-tools — TWS can be slow to respond. */
export const PORTFOLIO_SUB_TOOL_TIMEOUT_MS = 25_000;

export interface NormalizedPosition {
  account: string;
  position: number;
  avgCost?: number;
  contract: Record<string, unknown>;
}

function contractToRecord(contract: Contract): Record<string, unknown> {
  return {
    conId: contract.conId,
    symbol: contract.symbol,
    secType: contract.secType != null ? String(contract.secType) : undefined,
    exchange: contract.exchange,
    currency: contract.currency,
    localSymbol: contract.localSymbol,
    primaryExch: contract.primaryExch,
    lastTradeDateOrContractMonth: contract.lastTradeDateOrContractMonth,
    strike: contract.strike,
    right: contract.right != null ? String(contract.right) : undefined,
    multiplier: contract.multiplier,
    tradingClass: contract.tradingClass,
  };
}

/**
 * Fetches all open positions from TWS/IB Gateway (one short-lived connection).
 */
export function fetchOpenPositions(): Promise<NormalizedPosition[]> {
  const { host, port, clientId } = getIbConnectionOptions();
  const ib = new IBApi({ host, port });

  const positions: NormalizedPosition[] = [];

  return new Promise((resolve, reject) => {
    const hardTimeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          'Timed out waiting for IB positions (is TWS/IB Gateway running with API enabled?)',
        ),
      );
    }, PORTFOLIO_SUB_TOOL_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(hardTimeout);
      try {
        ib.disconnect();
      } catch {
        /* ignore */
      }
    }

    ib.on(EventName.position, (account: string, contract: Contract, pos: number, avgCost?: number) => {
      positions.push({
        account,
        position: pos,
        avgCost,
        contract: contractToRecord(contract),
      });
    })
      .once(EventName.positionEnd, () => {
        cleanup();
        resolve(positions);
      })
      .once(EventName.connected, () => {
        ib.reqPositions();
      });

    ib.connect(clientId);
  });
}

const IbGetPositionsSchema = z.object({
  account: z
    .string()
    .optional()
    .describe('If set, return only positions for this account id'),
});

export const ibGetPositions = new DynamicStructuredTool({
  name: 'ib_get_positions',
  description: `Fetch all open positions from the connected Interactive Brokers account via TWS or IB Gateway.
Use when the user needs current holdings, position sizes, or contract details for portfolio positions.`,
  schema: IbGetPositionsSchema,
  func: async (input) => {
    const rows = await fetchOpenPositions();
    const accountFilter = input.account?.trim();
    const filtered = accountFilter
      ? rows.filter((r) => r.account === accountFilter)
      : rows;
    const asOf = new Date().toISOString();
    const { host, port } = getIbConnectionOptions();
    return formatToolResult(
      {
        positions: filtered,
        asOf,
        connection: { host, port },
      },
      [],
    );
  },
});
