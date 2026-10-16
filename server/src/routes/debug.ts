import type { FastifyInstance } from "fastify";
import type { Container } from "../container.js";
import type { DemoControl } from "../debug/types.js";
import { toReservation } from "./reservations.js";

export function debugRoutes(app: FastifyInstance, c: Container, demo: DemoControl): void {
  app.post<{ Params: { id: string }; Body: { status: "available" | "charging" | "out_of_order" | "unknown" } }>(
    "/debug/chargers/:id/status",
    {
      schema: {
        body: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["available", "charging", "out_of_order", "unknown"] } } },
      },
    },
    async (req) => c.stations.toCharger(await demo.setChargerStatus(req.params.id, req.body.status)),
  );

  app.post<{ Params: { id: string }; Body: { seconds?: number } | undefined }>(
    "/debug/reservations/:id/fast-forward",
    { schema: { body: { type: ["object", "null"], properties: { seconds: { type: "integer", minimum: 1 } } } } },
    async (req) => {
      await demo.fastForwardReservation(req.params.id, req.body?.seconds);
      await c.reservations.sweep();
      const r = await c.reservations.getById(req.params.id);
      return { reservation: r ? toReservation(r) : null, server_time: new Date(c.clock.now()).toISOString() };
    },
  );

  app.delete<{ Params: { deviceId: string } }>("/debug/devices/:deviceId/cooldown", async (req, reply) => {
    await demo.clearCooldown(req.params.deviceId);
    reply.code(204);
  });

  app.post("/debug/reset", async () => {
    await demo.reset();
    return demo.simulatorState();
  });

  app.get("/debug/simulator", async () => demo.simulatorState());

  app.post<{ Body: { speed?: number; tick?: boolean } }>(
    "/debug/simulator",
    { schema: { body: { type: "object", properties: { speed: { type: "number", minimum: 0, maximum: 1000 }, tick: { type: "boolean" } } } } },
    async (req) => demo.setSimulator(req.body),
  );
}
