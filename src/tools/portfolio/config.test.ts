import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { isPortfolioManagerEnabled } from './config.js';

describe('isPortfolioManagerEnabled', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.IB_PORT;
    delete process.env.IB_CLIENT_ID;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  test('false when IB_PORT missing', () => {
    process.env.IB_CLIENT_ID = '1';
    expect(isPortfolioManagerEnabled()).toBe(false);
  });

  test('false when IB_CLIENT_ID missing', () => {
    process.env.IB_PORT = '7497';
    expect(isPortfolioManagerEnabled()).toBe(false);
  });

  test('true when IB_PORT and IB_CLIENT_ID set', () => {
    process.env.IB_PORT = '7497';
    process.env.IB_CLIENT_ID = '1';
    expect(isPortfolioManagerEnabled()).toBe(true);
  });

  test('false when values are whitespace only', () => {
    process.env.IB_PORT = '   ';
    process.env.IB_CLIENT_ID = '1';
    expect(isPortfolioManagerEnabled()).toBe(false);
  });
});
