/**
 * Global HTTP proxy support for Node.js fetch().
 *
 * Node.js's built-in fetch (undici) does NOT respect HTTP_PROXY / HTTPS_PROXY
 * environment variables by default. This module sets a global undici dispatcher
 * so all fetch() calls go through the configured proxy.
 *
 * Import this module early in the startup path (side-effect import).
 */
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

if (proxyUrl) {
  try {
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
  } catch {
    // Silently ignore invalid proxy URLs to avoid blocking startup.
  }
}
