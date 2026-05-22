import { prisma } from './index';

export interface SelftestResult {
  connected: boolean;
  tables: string[];
}

export async function selftest(): Promise<SelftestResult> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );

  return {
    connected: true,
    tables: rows.map((r) => r.tablename),
  };
}
