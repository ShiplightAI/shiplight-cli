import { Router } from "express";
import { resolveApiBase } from "sdk-core/cloud-routing";

export function createEmailForwardingRouter(): Router {
  const router = Router();

  router.get("/api/email-forwarding/addresses", async (_req, res) => {
    const token = process.env.SHIPLIGHT_API_TOKEN;
    if (!token) {
      console.error("[email-forwarding] SHIPLIGHT_API_TOKEN not set, skipping");
      res.json({ addresses: [], configured: false });
      return;
    }

    const apiBase = resolveApiBase(token, process.env.SHIPLIGHT_API_URL);
    if (!apiBase) {
      console.error("[email-forwarding] unsupported legacy v1 token, skipping");
      res.json({ addresses: [], configured: false });
      return;
    }
    const url = `${apiBase}/email-forwarding/addresses`;

    try {
      const upstream = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!upstream.ok) {
        const body = await upstream.json().catch(() => ({})) as { error?: string };
        const detail = body.error ?? `${upstream.status} ${upstream.statusText}`;
        console.error(`[email-forwarding] upstream ${upstream.status}: ${detail}`);
        res.status(upstream.status).json({ error: detail });
        return;
      }

      const body = await upstream.json();
      res.json({ ...body, configured: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[email-forwarding] fetch error: ${message}`);
      res
        .status(502)
        .json({ error: `Failed to reach Shiplight API (${apiBase}): ${message}` });
    }
  });

  return router;
}
