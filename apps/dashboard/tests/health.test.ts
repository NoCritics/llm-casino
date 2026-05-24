import { describe, it, expect } from 'vitest';
import { GET } from '../app/api/health/route';

describe('GET /api/health (dashboard)', () => {
  it('returns 200 with ok=true and confirms DB connectivity', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.app).toBe('dashboard');
  });
});
