import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { createProxy } from '../../src/proxy/index.js';
import type {
  GearboxConfig,
  Ledger,
  RequestContext,
  RouteDecision,
  Router,
  UsageBlock,
} from '../../src/types.js';

// --- helpers ---------------------------------------------------------------

interface Upstream {
  server: Server;
  port: number;
  requests: Array<{ method: string; url: string; headers: IncomingMessage['headers']; body: string }>;
}

function startUpstream(
  handler: (req: IncomingMessage, res: ServerResponse, body: string, hit: number) => void,
): Promise<Upstream> {
  return new Promise((resolve) => {
    const requests: Upstream['requests'] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        handler(req, res, body, requests.length);
      });
    });
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, requests });
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function makeConfig(overrides: Partial<GearboxConfig> & { upstreamBaseUrl: string; port: number }): GearboxConfig {
  const tier = (modelId: string) => ({
    modelId,
    inputPrice: 1,
    outputPrice: 1,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 1.25,
  });
  return {
    tiers: {
      haiku: tier('claude-haiku-4-5'),
      sonnet: tier('claude-sonnet-5'),
      opus: tier('claude-opus-4-8'),
      fable: tier('claude-fable-5'),
    },
    defaultTier: 'sonnet',
    maxTier: 'opus',
    baselineModel: 'claude-opus-4-8',
    routing: { longContextThreshold: 100000, escalationFailureThreshold: 3, switchMarginUsd: 0.01 },
    ledgerPath: '/tmp/gearbox-test-ledger.jsonl',
    ...overrides,
  };
}

// Router that always returns a fixed decision, recording feedback calls.
function fixedRouter(decision: RouteDecision): Router & { success: string[]; failure: string[] } {
  const success: string[] = [];
  const failure: string[] = [];
  return {
    success,
    failure,
    route(_ctx: RequestContext) {
      return decision;
    },
    reportSuccess(id) {
      success.push(id);
    },
    reportFailure(id) {
      failure.push(id);
    },
  };
}

function recordingLedger(): Ledger & { entries: Array<{ sessionId: string; decision: RouteDecision; usage: UsageBlock }> } {
  const entries: Array<{ sessionId: string; decision: RouteDecision; usage: UsageBlock }> = [];
  return {
    entries,
    record(sessionId, decision, usage) {
      entries.push({ sessionId, decision, usage });
    },
  };
}

const decisionSonnet: RouteDecision = {
  tier: 'sonnet',
  model: 'claude-sonnet-5',
  switched: true,
  rule: 'test',
  reason: 'test',
};

// --- teardown --------------------------------------------------------------

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function boot(upstream: Upstream, router: Router, ledger: Ledger) {
  const port = await freePort();
  const config = makeConfig({ upstreamBaseUrl: `http://127.0.0.1:${upstream.port}`, port });
  const proxy = createProxy(config, router, ledger);
  await proxy.start();
  cleanups.push(() => proxy.stop());
  cleanups.push(() => new Promise<void>((r) => upstream.server.close(() => r())));
  return port;
}

// --- tests -----------------------------------------------------------------

describe('createProxy', () => {
  it('forwards headers verbatim and rewrites the model', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', usage: { input_tokens: 10, output_tokens: 5 } }));
    });
    const ledger = recordingLedger();
    const port = await boot(upstream, fixedRouter(decisionSonnet), ledger);

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret-token',
        'x-api-key': 'sk-ant-123',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024',
      },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });
    await res.json();

    const seen = upstream.requests[0];
    expect(seen.headers.authorization).toBe('Bearer secret-token');
    expect(seen.headers['x-api-key']).toBe('sk-ant-123');
    expect(seen.headers['anthropic-version']).toBe('2023-06-01');
    expect(seen.headers['anthropic-beta']).toBe('prompt-caching-2024');
    expect(seen.headers.host).not.toBe(undefined); // fetch sets its own host
    expect(JSON.parse(seen.body).model).toBe('claude-sonnet-5'); // rewritten
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('streams SSE through intact and extracts usage from message_start + message_delta', async () => {
    const events = [
      'event: message_start\n' +
        'data: {"type":"message_start","message":{"usage":{"input_tokens":42,"output_tokens":1,"cache_read_input_tokens":8}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{},"usage":{"output_tokens":99}}\n\n',
    ];
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // Write across chunks, splitting an event mid-way to exercise buffering.
      const raw = events.join('');
      res.write(raw.slice(0, 30));
      res.write(raw.slice(30, 120));
      res.write(raw.slice(120));
      res.end();
    });
    const ledger = recordingLedger();
    const port = await boot(upstream, fixedRouter(decisionSonnet), ledger);

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const text = await res.text();

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toBe(events.join('')); // byte-for-byte
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].usage).toEqual({
      input_tokens: 42,
      output_tokens: 99, // from message_delta, overriding the 1 in message_start
      cache_read_input_tokens: 8,
    });
  });

  it('falls back to the original model on a 4xx after rewrite', async () => {
    const upstream = await startUpstream((_req, res, body, hit) => {
      const model = JSON.parse(body).model;
      if (hit === 1) {
        expect(model).toBe('claude-sonnet-5'); // rewritten attempt
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { message: 'model not found' } }));
      } else {
        expect(model).toBe('claude-opus-4-8'); // original on retry
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_2', usage: { input_tokens: 7, output_tokens: 3 } }));
      }
    });
    const ledger = recordingLedger();
    const router = fixedRouter(decisionSonnet);
    const port = await boot(upstream, router, ledger);

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe('msg_2');
    expect(upstream.requests).toHaveLength(2);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].decision.rule).toBe('proxy-fallback');
    expect(ledger.entries[0].decision.model).toBe('claude-opus-4-8');
    expect(router.failure.length).toBe(1); // the 4xx
    expect(router.success.length).toBe(1); // the retry
  });

  it('strips only context-1m* tokens from anthropic-beta when the model is rewritten', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', usage: { input_tokens: 10, output_tokens: 5 } }));
    });
    const ledger = recordingLedger();
    const port = await boot(upstream, fixedRouter(decisionSonnet), ledger);

    await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-beta': 'context-1m-2025-08-07,interleaved-thinking-2025-05-14',
      },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(upstream.requests[0].headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14');
  });

  it('drops the anthropic-beta header entirely when context-1m was its only token', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', usage: { input_tokens: 10, output_tokens: 5 } }));
    });
    const ledger = recordingLedger();
    const port = await boot(upstream, fixedRouter(decisionSonnet), ledger);

    await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-beta': 'context-1m-2025-08-07',
      },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(upstream.requests[0].headers['anthropic-beta']).toBe(undefined);
  });

  it('forwards anthropic-beta untouched when the model is not rewritten', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', usage: { input_tokens: 10, output_tokens: 5 } }));
    });
    const ledger = recordingLedger();
    // Router returns the same model the client sent — no rewrite.
    const noRewriteDecision: RouteDecision = {
      tier: 'opus',
      model: 'claude-opus-4-8',
      switched: false,
      rule: 'test',
      reason: 'test',
    };
    const port = await boot(upstream, fixedRouter(noRewriteDecision), ledger);

    await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-beta': 'context-1m-2025-08-07,interleaved-thinking-2025-05-14',
      },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(upstream.requests[0].headers['anthropic-beta']).toBe(
      'context-1m-2025-08-07,interleaved-thinking-2025-05-14',
    );
  });

  it('sends the original, unstripped anthropic-beta header on fallback retry', async () => {
    const upstream = await startUpstream((_req, res, body, hit) => {
      const model = JSON.parse(body).model;
      if (hit === 1) {
        expect(model).toBe('claude-sonnet-5'); // rewritten attempt
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { message: 'model not found' } }));
      } else {
        expect(model).toBe('claude-opus-4-8'); // original on retry
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_2', usage: { input_tokens: 7, output_tokens: 3 } }));
      }
    });
    const ledger = recordingLedger();
    const router = fixedRouter(decisionSonnet);
    const port = await boot(upstream, router, ledger);

    await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-beta': 'context-1m-2025-08-07,interleaved-thinking-2025-05-14',
      },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(upstream.requests).toHaveLength(2);
    // Rewritten attempt: stripped.
    expect(upstream.requests[0].headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14');
    // Fallback retry with original model: untouched, original header.
    expect(upstream.requests[1].headers['anthropic-beta']).toBe(
      'context-1m-2025-08-07,interleaved-thinking-2025-05-14',
    );
  });

  it('passes a 429 on a rewritten model through unchanged, without falling back', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }));
    });
    const ledger = recordingLedger();
    const router = fixedRouter(decisionSonnet);
    const port = await boot(upstream, router, ledger);

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(json.error.type).toBe('rate_limit_error');
    expect(upstream.requests).toHaveLength(1); // no fallback retry
    expect(router.failure.length).toBe(1);
    expect(router.success.length).toBe(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('passes through non-/v1/messages requests without body inspection', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-echo-path': req.url! });
      res.end(JSON.stringify({ ok: true }));
    });
    const ledger = recordingLedger();
    const router = fixedRouter(decisionSonnet);
    const port = await boot(upstream, router, ledger);

    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      method: 'GET',
      headers: { authorization: 'Bearer t' },
    });
    await res.json();

    expect(res.headers.get('x-echo-path')).toBe('/v1/models');
    expect(upstream.requests[0].url).toBe('/v1/models');
    expect(upstream.requests[0].headers.authorization).toBe('Bearer t');
    expect(ledger.entries).toHaveLength(0); // no routing/ledger for passthrough
    expect(router.success.length + router.failure.length).toBe(0);
  });

  it('returns 502 with a JSON error body when upstream is unreachable', async () => {
    const deadPort = await freePort();
    const port = await freePort();
    const config = makeConfig({ upstreamBaseUrl: `http://127.0.0.1:${deadPort}`, port });
    const proxy = createProxy(config, fixedRouter(decisionSonnet), recordingLedger());
    await proxy.start();
    cleanups.push(() => proxy.stop());

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.type).toBe('error');
    expect(json.error.type).toBe('gearbox_upstream_error');
  });

  it('forwards a malformed JSON body untouched', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    const ledger = recordingLedger();
    const port = await boot(upstream, fixedRouter(decisionSonnet), ledger);

    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    });
    await res.json();

    expect(upstream.requests[0].body).toBe('{ this is not json'); // untouched
    expect(ledger.entries).toHaveLength(0);
  });
});
