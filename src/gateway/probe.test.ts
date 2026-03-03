import { describe, expect, it, vi } from "vitest";

const gatewayClientState = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  requests: [] as string[],
  requestHandlers: new Map<string, () => Promise<unknown>>(),
}));

class MockGatewayClient {
  private readonly opts: Record<string, unknown>;

  constructor(opts: Record<string, unknown>) {
    this.opts = opts;
    gatewayClientState.options = opts;
  }

  start(): void {
    void Promise.resolve()
      .then(async () => {
        const onHelloOk = this.opts.onHelloOk;
        if (typeof onHelloOk === "function") {
          await onHelloOk();
        }
      })
      .catch(() => {});
  }

  stop(): void {}

  async request(method: string): Promise<unknown> {
    gatewayClientState.requests.push(method);
    const handler = gatewayClientState.requestHandlers.get(method);
    if (handler) {
      return await handler();
    }
    if (method === "system-presence") {
      return [];
    }
    return {};
  }
}

vi.mock("./client.js", () => ({
  GatewayClient: MockGatewayClient,
}));

const { probeGateway } = await import("./probe.js");

describe("probeGateway", () => {
  it("treats status success as reachable even when health times out", async () => {
    gatewayClientState.requests = [];
    gatewayClientState.requestHandlers = new Map([
      [
        "health",
        async () =>
          await new Promise<never>(() => {
            // Intentionally never resolve to simulate a slow health refresh.
          }),
      ],
      ["status", async () => ({ ok: true })],
      ["system-presence", async () => []],
      ["config.get", async () => ({ gateway: { bind: "loopback" } })],
    ]);

    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      auth: { token: "secret" },
      timeoutMs: 1_000,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toEqual({ ok: true });
    expect(result.health).toBeNull();
    expect(result.presence).toEqual([]);
    expect(result.configSnapshot).toEqual({ gateway: { bind: "loopback" } });
    expect(gatewayClientState.requests).toContain("status");
  });

  it("connects with operator.read scope", async () => {
    gatewayClientState.requests = [];
    gatewayClientState.requestHandlers = new Map();
    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      auth: { token: "secret" },
      timeoutMs: 1_000,
    });

    expect(gatewayClientState.options?.scopes).toEqual(["operator.read"]);
    expect(result.ok).toBe(true);
  });
});
