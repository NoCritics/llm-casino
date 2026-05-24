import { describe, it, expect } from 'vitest';
import { GET } from '../app/api/health/route';

describe('GET /api/health', () => {
  it('returns 200 with ok=true and lists tables', async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tables)).toBe(true);
    expect(body.tables).toContain('Player');
  });
});
