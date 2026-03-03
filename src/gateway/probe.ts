import { randomUUID } from "node:crypto";
import { formatErrorMessage } from "../infra/errors.js";
import type { SystemPresence } from "../infra/system-presence.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { GatewayClient } from "./client.js";
import { READ_SCOPE } from "./method-scopes.js";

export type GatewayProbeAuth = {
  token?: string;
  password?: string;
};

export type GatewayProbeClose = {
  code: number;
  reason: string;
  hint?: string;
};

export type GatewayProbeResult = {
  ok: boolean;
  url: string;
  connectLatencyMs: number | null;
  error: string | null;
  close: GatewayProbeClose | null;
  health: unknown;
  status: unknown;
  presence: SystemPresence[] | null;
  configSnapshot: unknown;
};

type ProbeStepResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function runProbeStep<T>(params: {
  client: GatewayClient;
  method: string;
  requestParams?: unknown;
  timeoutMs: number;
}): Promise<ProbeStepResult<T>> {
  const timeoutMs = Math.max(100, params.timeoutMs);
  return await new Promise<ProbeStepResult<T>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);

    void params.client
      .request<T>(params.method, params.requestParams)
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value });
      })
      .catch((err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: formatErrorMessage(err) });
      });
  });
}

export async function probeGateway(opts: {
  url: string;
  auth?: GatewayProbeAuth;
  timeoutMs: number;
}): Promise<GatewayProbeResult> {
  const startedAt = Date.now();
  const instanceId = randomUUID();
  let connectLatencyMs: number | null = null;
  let connectError: string | null = null;
  let close: GatewayProbeClose | null = null;

  return await new Promise<GatewayProbeResult>((resolve) => {
    let settled = false;
    const settle = (result: Omit<GatewayProbeResult, "url">) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      client.stop();
      resolve({ url: opts.url, ...result });
    };

    const client = new GatewayClient({
      url: opts.url,
      token: opts.auth?.token,
      password: opts.auth?.password,
      scopes: [READ_SCOPE],
      clientName: GATEWAY_CLIENT_NAMES.CLI,
      clientVersion: "dev",
      mode: GATEWAY_CLIENT_MODES.PROBE,
      instanceId,
      onConnectError: (err) => {
        connectError = formatErrorMessage(err);
      },
      onClose: (code, reason) => {
        close = { code, reason };
      },
      onHelloOk: async () => {
        connectLatencyMs = Date.now() - startedAt;
        const deadline = startedAt + Math.max(250, opts.timeoutMs);
        const remainingBudgetMs = () => Math.max(100, deadline - Date.now());

        const statusResult = await runProbeStep({
          client,
          method: "status",
          timeoutMs: remainingBudgetMs(),
        });
        if (!statusResult.ok) {
          settle({
            ok: false,
            connectLatencyMs,
            error: statusResult.error,
            close,
            health: null,
            status: null,
            presence: null,
            configSnapshot: null,
          });
          return;
        }

        const auxiliaryBudgetMs = Math.max(
          100,
          Math.min(1_000, Math.floor(remainingBudgetMs() * 0.6)),
        );
        const [healthResult, presenceResult, configResult] = await Promise.all([
          runProbeStep({
            client,
            method: "health",
            timeoutMs: auxiliaryBudgetMs,
          }),
          runProbeStep<SystemPresence[]>({
            client,
            method: "system-presence",
            timeoutMs: auxiliaryBudgetMs,
          }),
          runProbeStep({
            client,
            method: "config.get",
            requestParams: {},
            timeoutMs: auxiliaryBudgetMs,
          }),
        ]);

        settle({
          ok: true,
          connectLatencyMs,
          error: null,
          close,
          health: healthResult.ok ? healthResult.value : null,
          status: statusResult.value,
          presence:
            presenceResult.ok && Array.isArray(presenceResult.value) ? presenceResult.value : null,
          configSnapshot: configResult.ok ? configResult.value : null,
        });
      },
    });

    const timer = setTimeout(
      () => {
        settle({
          ok: false,
          connectLatencyMs,
          error: connectError ? `connect failed: ${connectError}` : "timeout",
          close,
          health: null,
          status: null,
          presence: null,
          configSnapshot: null,
        });
      },
      Math.max(250, opts.timeoutMs),
    );

    client.start();
  });
}
