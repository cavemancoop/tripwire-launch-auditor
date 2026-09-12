import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

// Stateless Streamable HTTP: each POST is handled by a fresh McpServer +
// transport pair (mcp.ts), so a bare tools/list needs no prior `initialize`
// call in the same connection. The transport replies as SSE
// (`event: message\ndata: {...}`) even for a single response — pull the JSON
// out of the `data:` line.
function parseSse(payload: string): { result: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> } } {
  const line = payload.split('\n').find((l) => l.startsWith('data: '));
  if (!line) throw new Error(`no data: line in SSE payload: ${payload}`);
  return JSON.parse(line.slice('data: '.length));
}

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('POST /mcp', () => {
  it('lists get_report, get_benchmark, request_deepdive', async () => {
    const app = buildServer({ reportReader: async () => null, benchmarkReader: async () => null });
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = parseSse(res.payload);
    const names = (body.result.tools ?? []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_report', 'get_benchmark', 'request_deepdive']));
    await app.close();
  });

  it('calls get_report through the injected reader', async () => {
    const app = buildServer({ reportReader: async (token) => ({ token, reportTime: 't', forecasters: [] }) });
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_report', arguments: { token: '0x00000000000000000000000000000000dec0ded1' } },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = parseSse(res.payload);
    const parsed = JSON.parse(body.result.content![0]!.text);
    expect(parsed.token).toBe('0x00000000000000000000000000000000dec0ded1');
    await app.close();
  });

  it('rejects a malformed token argument via the zod schema, not a 500', async () => {
    const app = buildServer({ reportReader: async () => null });
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_report', arguments: { token: 'not-an-address' } },
      },
    });
    expect(res.statusCode).toBe(200); // JSON-RPC reports the error in the body, not the HTTP status
    const body = parseSse(res.payload) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.result?.isError ?? Boolean(body.error)).toBe(true);
    await app.close();
  });
});
