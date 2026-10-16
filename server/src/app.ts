import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type { Health } from "@seoul-ev/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import type { Container } from "./container.js";
import { iso } from "./domain/clock.js";
import { DomainError, errorBody } from "./domain/errors.js";
import { debugRoutes } from "./routes/debug.js";
import { proxyRoutes } from "./routes/proxy.js";
import { reservationRoutes } from "./routes/reservations.js";
import { stationRoutes } from "./routes/stations.js";

export async function buildApp(config: Config, container: Container, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    ajv: { customOptions: { coerceTypes: true, removeAdditional: false, useDefaults: true } },
  });

  // Many clients send Content-Type: application/json on body-less POSTs (cancel, arrive, debug).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, null);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error("Invalid JSON body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await app.register(cors, { origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(","), allowedHeaders: ["Content-Type", "X-Device-Id"] });

  const leafletDir = join(dirname(createRequire(import.meta.url).resolve("leaflet/package.json")), "dist");
  await app.register(fastifyStatic, { root: leafletDir, prefix: "/static/leaflet/", decorateReply: false });
  const geoDir = join(dirname(fileURLToPath(import.meta.url)), "../static");
  await app.register(fastifyStatic, { root: geoDir, prefix: "/static/geo/", decorateReply: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) return reply.code(err.status).send(err.toBody());
    const e = err as { validation?: unknown; message?: string; statusCode?: number };
    if (e.validation) return reply.code(400).send(errorBody("VALIDATION_ERROR", { reason: e.message }));
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return reply.code(e.statusCode).send(errorBody("VALIDATION_ERROR", { reason: e.message }));
    req.log.error(err);
    return reply.code(500).send(errorBody("INTERNAL_ERROR"));
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody("NOT_FOUND")));

  app.get(
    "/health",
    async (): Promise<Health> => ({
      ok: true,
      server_time: iso(container.clock.now()),
      debug_endpoints: config.debugEndpoints,
      providers: { routing: config.routingProvider, places: config.placesProvider, map: config.mapProvider },
    }),
  );

  stationRoutes(app, container);
  reservationRoutes(app, container);
  proxyRoutes(app, container, config);
  if (config.debugEndpoints && container.demo) debugRoutes(app, container, container.demo);

  return app;
}
