import { describe, it, expect } from 'vitest';
import { selftest } from '../src/selftest';

describe('db selftest', () => {
  it('reports the expected V1 tables as present', async () => {
    const result = await selftest();

    expect(result.connected).toBe(true);

    const expected = [
      'Player', 'Game', 'Bet',
      'TreasuryWallet', 'TreasuryMove',
      'Campaign', 'SupportTicket',
      'Message', 'Event', 'AgentRun', 'PauseFlag',
    ];
    for (const table of expected) {
      expect(result.tables, `missing table ${table}`).toContain(table);
    }
  });
});
