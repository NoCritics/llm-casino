import { describe, it, expect, afterAll } from 'vitest';
import { selftest } from '../src/selftest';
import { prisma } from '../src/index';

afterAll(async () => {
  await prisma.$disconnect();
});

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
