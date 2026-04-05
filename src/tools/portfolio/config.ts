/**
 * Interactive Brokers / portfolio_manager feature gate.
 * Single source of truth for registry and system prompt section.
 */

/** Non-empty IB_PORT and IB_CLIENT_ID enable the portfolio_manager tool. */
export function isPortfolioManagerEnabled(): boolean {
  const port = process.env.IB_PORT?.trim();
  const clientId = process.env.IB_CLIENT_ID?.trim();
  return Boolean(port && clientId);
}

export function getIbConnectionOptions(): { host: string; port: number; clientId: number } {
  const host = process.env.IB_HOST?.trim() || '127.0.0.1';
  const port = parseInt(process.env.IB_PORT || '7497', 10);
  const clientId = parseInt(process.env.IB_CLIENT_ID || '0', 10);
  if (Number.isNaN(port) || Number.isNaN(clientId)) {
    throw new Error('Invalid IB_PORT or IB_CLIENT_ID');
  }
  return { host, port, clientId };
}
