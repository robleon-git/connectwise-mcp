import express from "express";
import type { Express } from "express";
export function createControlApi(checkReady: () => Promise<boolean>): {
    app: Express;
    drain: () => void;
} {
    const app = express();
    let draining = false;
    app.disable("x-powered-by");
    app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
    app.get("/health", (_req, res) => { res.status(draining ? 503 : 200).json({ status: draining ? "unavailable" : "ok" }); });
    app.get("/ready", async (_req, res) => {
        let ready = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (!draining)
            try {
                ready = await Promise.race([checkReady(), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 7000); })]);
            }
            catch { /* fixed response only */ }
            finally {
                if (timer)
                    clearTimeout(timer);
            }
        res.status(ready && !draining ? 200 : 503).json({ status: ready && !draining ? "ready" : "unavailable" });
    });
    // No body parser, proxy, customer routes, signup, billing, or admin API in Phase 0.
    app.use((_req, res) => { res.status(404).json({ error: "not_available" }); });
    return { app, drain: () => { draining = true; } };
}
