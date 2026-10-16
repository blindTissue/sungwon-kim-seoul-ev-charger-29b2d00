import type { ChargerSpeed, ConnectorType, District, LatLng } from "@seoul-ev/shared";
import { CONNECTOR_TYPES } from "@seoul-ev/shared";
import type { FastifyInstance } from "fastify";
import type { Container } from "../container.js";
import { DomainError } from "../domain/errors.js";
import type { ChargerFilter } from "../services/station-service.js";

const latLngQuery = {
  lat: { type: "number", minimum: -90, maximum: 90 },
  lng: { type: "number", minimum: -180, maximum: 180 },
} as const;
const filterQuery = {
  speed: { type: "string", enum: ["DC", "AC"] },
  connector: { type: "string" },
} as const;

function parseFilter(q: { speed?: ChargerSpeed; connector?: string }): ChargerFilter {
  const connectors = q.connector
    ? q.connector
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  if (connectors?.some((c) => !CONNECTOR_TYPES.includes(c as ConnectorType))) {
    throw new DomainError("VALIDATION_ERROR", { field: "connector", allowed: CONNECTOR_TYPES });
  }
  return { speed: q.speed, connectors: connectors as ConnectorType[] | undefined };
}

export function stationRoutes(app: FastifyInstance, c: Container): void {
  app.get<{ Querystring: { lat: number; lng: number; radius_m: number; available_only: boolean; speed?: ChargerSpeed; connector?: string } }>(
    "/stations",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["lat", "lng"],
          properties: { ...latLngQuery, ...filterQuery, radius_m: { type: "integer", minimum: 100, maximum: 20000, default: 3000 }, available_only: { type: "boolean", default: true } },
        },
      },
    },
    async (req) => {
      const { lat, lng, radius_m, available_only } = req.query;
      const stations = await c.stations.nearby({ lat, lng }, radius_m, parseFilter(req.query), available_only);
      return { center: { lat, lng }, radius_m, stations };
    },
  );

  app.get<{ Querystring: { lat: number; lng: number; origin_lat?: number; origin_lng?: number; speed?: ChargerSpeed; connector?: string } }>(
    "/stations/nearest",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["lat", "lng"],
          properties: { ...latLngQuery, ...filterQuery, origin_lat: { type: "number" }, origin_lng: { type: "number" } },
        },
      },
    },
    async (req) => {
      const { lat, lng, origin_lat, origin_lng } = req.query;
      const origin: LatLng | null = origin_lat !== undefined && origin_lng !== undefined ? { lat: origin_lat, lng: origin_lng } : null;
      return c.stations.nearest({ lat, lng }, origin, parseFilter(req.query));
    },
  );

  app.get<{ Params: { id: string } }>("/stations/:id", async (req) => c.stations.detail(req.params.id));

  app.get("/districts", async (): Promise<{ districts: District[] }> => ({ districts: await c.stations.districts() }));

  app.get<{ Params: { code: string } }>("/districts/:code/stations", async (req) => c.stations.districtStations(req.params.code));
}
