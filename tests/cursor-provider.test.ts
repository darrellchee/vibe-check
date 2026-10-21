import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { collectUsage } from '../lib/collector';
import { validateSnapshot } from '../lib/validation';
import { providerFromUrl } from '../lib/providers';
import { sessionToken } from '../lib/auth';
import { POST as ingest } from '../app/api/ingest/route';
import { GET as usage } from '../app/api/usage/route';
import { GET as widget } from '../app/api/widget/route';
import type { UsageSnapshot } from '../lib/types';

const unavailable = { tokens: false, cost: false, sessions: false, humanRequests: false, assistantRequests: false, cacheBreakdown: false };
async function fixture(): Promise<UsageSnapshot> {
  const base = await collectUsage(path.join(tmpdir(), `missing-cursor-qa-${randomUUID()}`));
  return { ...base, provider: 'cursor', availability: { ...unavailable }, pricing: { checkedAt: '2026-10-20', sources: ['https://cursor.com/docs/account/usage'] } };
}

test('Cursor selection and optional metric availability are strictly validated', async () => {
  assert.equal(providerFromUrl('https://dashboard.example/api/usage?provider=cursor'), 'cursor');
  for (const query of ['provider=Cursor', 'provider=cursor&provider=codex', 'provider=cursor&provider=cursor']) assert.throws(() => providerFromUrl(`https://dashboard.example/api/usage?${query}`));
  const cursor = await fixture();
  assert.equal(validateSnapshot(cursor), cursor);
  const legacy = { ...cursor }; delete legacy.provider; delete legacy.availability;
  assert.equal(validateSnapshot(legacy), legacy);
  for (const availability of [null, false, [], {}, { ...unavailable, tokens: 'false' }, { ...unavailable, tokens: 0 }, { ...unavailable, projectPath: 'private-project' }]) assert.throws(() => validateSnapshot({ ...cursor, availability }));
  for (const source of ['https://cursor.com.attacker.example/docs/account/usage', 'http://cursor.com/docs/account/usage', 'https://cursor.com@attacker.example/usage']) assert.throws(() => validateSnapshot({ ...cursor, pricing: { ...cursor.pricing, sources: [source] } }));
});

test('Cursor upload, reads and public widget cannot overwrite or expose another provider', async () => {
  const env: Record<string, string | undefined> = process.env;
  const settings = { ATLAS_MODE: 'cloud', SYNC_TOKEN: 'synthetic-cursor-private-token-123456789', DASHBOARD_PASSWORD: 'synthetic-cursor-password', UPSTASH_REDIS_REST_URL: 'https://cursor-fixture-storage.example', UPSTASH_REDIS_REST_TOKEN: 'synthetic-fixture-storage', NODE_ENV: 'production', PUBLIC_WIDGET: 'true', PUBLIC_CLAUDE_WIDGET: 'true', PUBLIC_CURSOR_WIDGET: undefined };
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, env[key]]));
  const realFetch = globalThis.fetch;
  const stored = new Map<string, string>();
  try {
    for (const [key, value] of Object.entries(settings)) { if (value === undefined) delete env[key]; else env[key] = value; }
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), settings.UPSTASH_REDIS_REST_URL);
      const cmd = JSON.parse(String(init?.body));
      if (cmd[0] === 'GET') return Response.json({ result: stored.get(cmd[1]) || null });
      assert.equal(cmd[0], 'EVAL');
      const key = cmd[3], prior = stored.get(key);
      if (prior && JSON.parse(prior).generatedAt >= cmd[4]) return Response.json({ result: 0 });
      stored.set(key, cmd[5]); return Response.json({ result: 1 });
    };
    const cursor = await fixture();
    const codex = { ...cursor, provider: 'codex' as const }; delete codex.availability;
    const claude = { ...codex, provider: 'claude' as const };
    const upload = (snapshot: unknown, provider: string) => new Request(`https://dashboard.example/api/ingest?provider=${provider}`, { method: 'POST', headers: { Authorization: `Bearer ${settings.SYNC_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) });
    for (const [provider, snapshot] of [['codex', codex], ['claude', claude], ['cursor', cursor]] as const) assert.equal((await ingest(upload(snapshot, provider))).status, 200);
    assert.deepEqual([...stored.keys()].sort(), ['claude-atlas:snapshot:v1', 'codex-atlas:snapshot:v1', 'cursor-atlas:snapshot:v1']);
    assert.equal((await ingest(upload(cursor, 'claude'))).status, 400);
    assert.equal((await ingest(upload(claude, 'cursor'))).status, 400);
    assert.equal((await ingest(upload(cursor, 'cursor'))).status, 409);
    const read = (provider: string, authenticated = true) => new Request(`https://dashboard.example/api/usage?provider=${provider}`, { headers: authenticated ? { cookie: `atlas_session=${sessionToken(settings.DASHBOARD_PASSWORD)}` } : {} });
    assert.equal((await usage(read('cursor', false))).status, 401);
    const response = await usage(read('cursor'));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const payload = await response.json(); assert.equal(payload.provider, 'cursor'); assert.deepEqual(payload.availability, unavailable);
    const badgeRequest = new Request('https://dashboard.example/api/widget?provider=cursor');
    assert.equal((await widget(badgeRequest)).status, 404);
    env.PUBLIC_CURSOR_WIDGET = 'true';
    const badge = await widget(badgeRequest); assert.equal(badge.status, 200);
    const svg = await badge.text(); assert.ok(svg.includes('CURSOR ATLAS'));
    assert.match(svg, /unavailable|not available|unknown/i);
    for (const privateValue of [settings.SYNC_TOKEN, settings.DASHBOARD_PASSWORD, settings.UPSTASH_REDIS_REST_TOKEN, 'projectPath']) assert.equal(svg.includes(privateValue), false);
    const known = structuredClone(cursor);
    known.generatedAt = new Date(Date.parse(cursor.generatedAt) + 1).toISOString();
    known.availability = { ...unavailable, tokens: true, assistantRequests: true, cacheBreakdown: true };
    const tokenCounts = { inputTokens: 12, cachedInputTokens: 5, cacheWriteTokens: 3, outputTokens: 6, reasoningTokens: 0, totalTokens: 18 };
    Object.assign(known.totals, tokenCounts, { assistantRequests: 1, unpricedTokens: 18 });
    known.models = [{ ...tokenCounts, model: 'auto', requests: 1, costUsd: 0, priced: false, unpricedTokens: 18 }];
    known.daily = [{ ...tokenCounts, date: '2026-10-18', models: known.models, sessions: 0, humanRequests: 0, assistantRequests: 1, costUsd: 0, unpricedTokens: 18 }];
    known.hours[0] = { hour: 0, tokens: 18, requests: 1 };
    assert.equal((await ingest(upload(known, 'cursor'))).status, 200);
    const partialWidget = await widget(badgeRequest);
    assert.equal(partialWidget.status, 200);
    const partialSvg = await partialWidget.text();
    assert.match(partialSvg, />18</);
    assert.match(partialSvg, /Unavailable/i);
    stored.set('cursor-atlas:snapshot:v1', JSON.stringify(codex));
    assert.equal((await usage(read('cursor'))).status, 503);
    assert.equal((await widget(badgeRequest)).status, 503);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete env[key]; else env[key] = value; }
  }
});
