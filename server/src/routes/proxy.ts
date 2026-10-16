import type { PlaceSearchResult, RouteSummary } from "@seoul-ev/shared";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { Container } from "../container.js";
import { DomainError } from "../domain/errors.js";
import { parseLatLng } from "../domain/geo.js";
import { renderMapPage } from "../map/page.js";

export function proxyRoutes(app: FastifyInstance, c: Container, config: Config): void {
  app.get<{ Querystring: { q: string } }>(
    "/places/search",
    { schema: { querystring: { type: "object", required: ["q"], properties: { q: { type: "string", minLength: 1, maxLength: 100 } } } } },
    async (req): Promise<PlaceSearchResult> => c.places.search(req.query.q.trim()),
  );

  app.get<{ Querystring: { from: string; to: string; geometry?: boolean } }>(
    "/route",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["from", "to"],
          properties: { from: { type: "string" }, to: { type: "string" }, geometry: { type: "boolean", default: false } },
        },
      },
    },
    async (req): Promise<RouteSummary> => {
      const from = parseLatLng(req.query.from);
      const to = parseLatLng(req.query.to);
      if (!from || !to) throw new DomainError("VALIDATION_ERROR", { hint: "from/to must be 'lat,lng'" });
      return c.routing.route(from, to, { geometry: req.query.geometry === true });
    },
  );

  app.get<{ Querystring: { lang?: string } }>("/map", async (req, reply) => {
    reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8");
    return renderMapPage({ provider: config.mapProvider, kakaoJsKey: config.kakaoJsKey, lang: req.query.lang === "en" ? "en" : "ko" });
  });
}
