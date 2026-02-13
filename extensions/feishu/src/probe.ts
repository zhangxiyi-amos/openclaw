import type { FeishuProbeResult } from "./types.js";
import { createFeishuClient, type FeishuClientCredentials } from "./client.js";

const PROBE_CACHE_TTL_MS = 5 * 60 * 1000;

type ProbeCacheEntry = {
  botName?: string;
  botOpenId?: string;
  expiresAt: number;
};

const probeCache = new Map<string, ProbeCacheEntry>();

export async function probeFeishu(creds?: FeishuClientCredentials): Promise<FeishuProbeResult> {
  if (!creds?.appId || !creds?.appSecret) {
    return {
      ok: false,
      error: "missing credentials (appId, appSecret)",
    };
  }

  const cacheKey = `${creds.appId}:${creds.appSecret}`;
  const cached = probeCache.get(cacheKey);
  const notExpired = !!cached && cached.expiresAt > Date.now();
  if (cached && notExpired) {
    return {
      ok: true,
      appId: creds.appId,
      botName: cached.botName,
      botOpenId: cached.botOpenId,
    };
  }

  try {
    const client = createFeishuClient(creds);
    // Use bot/v3/info API to get bot information
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK generic request method
    const response = await (client as any).request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
      data: {},
    });

    if (response.code !== 0) {
      return {
        ok: false,
        appId: creds.appId,
        error: `API error: ${response.msg || `code ${response.code}`}`,
      };
    }

    const bot = response.bot || response.data?.bot;
    probeCache.set(cacheKey, {
      botName: bot?.bot_name,
      botOpenId: bot?.open_id,
      expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
    });

    return {
      ok: true,
      appId: creds.appId,
      botName: bot?.bot_name,
      botOpenId: bot?.open_id,
    };
  } catch (err) {
    return {
      ok: false,
      appId: creds.appId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
