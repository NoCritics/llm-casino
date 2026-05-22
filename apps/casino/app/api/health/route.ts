import { NextResponse } from 'next/server';
import { selftest } from '@casino/db';

export async function GET() {
  try {
    const result = await selftest();
    return NextResponse.json({ ok: true, tables: result.tables });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
