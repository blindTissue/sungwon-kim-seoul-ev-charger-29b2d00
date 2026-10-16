import type { Config } from "./config.js";
import type { Clock } from "./domain/clock.js";
import type { DemoControl } from "./debug/types.js";
import { KakaoPlacesProvider, MockPlacesProvider, type PlacesProvider } from "./providers/places.js";
import { KakaoRoutingProvider, MockRoutingProvider, type RoutingProvider } from "./providers/routing.js";
import { createMockBackend } from "./repositories/mock/index.js";
import type { SeedData } from "./repositories/mock/db.js";
import { ReservationService } from "./services/reservation-service.js";
import { StationService } from "./services/station-service.js";

export interface Container {
  stations: StationService;
  reservations: ReservationService;
  routing: RoutingProvider;
  places: PlacesProvider;
  clock: Clock;
  /** Present only for adapters that support demo controls (the mock). */
  demo: DemoControl | null;
  start(): void;
  close(): void;
}

export interface ContainerOverrides {
  routing?: RoutingProvider;
  places?: PlacesProvider;
  seed?: SeedData;
}

export function createContainer(config: Config, clock: Clock, overrides: ContainerOverrides = {}): Container {
  const routing =
    overrides.routing ?? (config.routingProvider === "kakao" ? new KakaoRoutingProvider(config.kakaoMobilityKey!) : new MockRoutingProvider());
  const places = overrides.places ?? (config.placesProvider === "kakao" ? new KakaoPlacesProvider(config.kakaoRestKey!) : new MockPlacesProvider());

  // Data adapter selection. To plug in the production backend, construct a RealBackend
  // StationRepository / ReservationRepository here instead; nothing else changes.
  const backend = createMockBackend({
    dbPath: config.dbPath,
    clock,
    simSeed: config.simSeed,
    simSpeed: config.simSpeed,
    simTickMs: config.simTickMs,
    seed: overrides.seed,
  });

  const reservations = new ReservationService(backend.reservations, backend.stations, routing, clock);
  const stations = new StationService(backend.stations, routing, clock, async () => {
    await reservations.sweep();
  });

  let sweepTimer: NodeJS.Timeout | null = null;
  return {
    stations,
    reservations,
    routing,
    places,
    clock,
    demo: backend.control,
    start() {
      if (config.simEnabled) backend.simulator.start();
      sweepTimer = setInterval(() => void reservations.sweep(), 1000);
      sweepTimer.unref();
    },
    close() {
      if (sweepTimer) clearInterval(sweepTimer);
      backend.close();
    },
  };
}
