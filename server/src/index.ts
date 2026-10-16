import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createContainer } from "./container.js";
import { systemClock } from "./domain/clock.js";

const config = loadConfig();
const container = createContainer(config, systemClock);
const app = await buildApp(config, container, { logger: true });
container.start();

await app.listen({ port: config.port, host: config.host });
app.log.info(
  { providers: { routing: config.routingProvider, places: config.placesProvider, map: config.mapProvider }, debug: config.debugEndpoints, simSpeed: config.simSpeed },
  "Seoul EV mock backend ready (availability is SIMULATED)",
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    container.close();
    process.exit(0);
  });
}
