export type ProviderName = "kakao" | "mock";

export interface Config {
  port: number;
  host: string;
  publicBaseUrl: string | null;
  dbPath: string;
  routingProvider: ProviderName;
  placesProvider: ProviderName;
  mapProvider: ProviderName;
  kakaoRestKey: string | null;
  kakaoMobilityKey: string | null;
  kakaoJsKey: string | null;
  simSeed: number;
  simSpeed: number;
  simTickMs: number;
  simEnabled: boolean;
  debugEndpoints: boolean;
  corsOrigin: string;
}

function provider(name: string, env: NodeJS.ProcessEnv): ProviderName {
  const v = (env[name] ?? "mock").toLowerCase();
  if (v !== "kakao" && v !== "mock") throw new Error(`${name} must be "kakao" or "mock", got "${v}"`);
  return v;
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(v: string | undefined, dflt: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${v}`);
  return n;
}

/** First non-empty value; later names are aliases (e.g. Cloud Agent secret names). */
function first(env: NodeJS.ProcessEnv, ...names: string[]): string | null {
  for (const n of names) if (env[n]) return env[n]!;
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const restKey = first(env, "KAKAO_REST_API_KEY", "KAKAO_REST_API");
  const cfg: Config = {
    port: num(env.PORT, 3000),
    host: env.HOST ?? "0.0.0.0",
    publicBaseUrl: env.PUBLIC_BASE_URL || null,
    dbPath: env.DB_PATH || ":memory:",
    routingProvider: provider("ROUTING_PROVIDER", env),
    placesProvider: provider("PLACES_PROVIDER", env),
    mapProvider: provider("MAP_PROVIDER", env),
    kakaoRestKey: restKey,
    kakaoMobilityKey: first(env, "KAKAO_MOBILITY_API_KEY") ?? restKey,
    kakaoJsKey: first(env, "KAKAO_JS_KEY", "KAKAO_JS"),
    simSeed: num(env.SIM_SEED, 42),
    simSpeed: num(env.SIM_SPEED, 1),
    simTickMs: num(env.SIM_TICK_MS, 30_000),
    simEnabled: bool(env.SIM_ENABLED, true),
    debugEndpoints: bool(env.DEBUG_ENDPOINTS, false),
    corsOrigin: env.CORS_ORIGIN ?? "*",
  };
  if (cfg.routingProvider === "kakao" && !cfg.kakaoMobilityKey) throw new Error("ROUTING_PROVIDER=kakao requires KAKAO_MOBILITY_API_KEY or KAKAO_REST_API_KEY (alias KAKAO_REST_API)");
  if (cfg.placesProvider === "kakao" && !cfg.kakaoRestKey) throw new Error("PLACES_PROVIDER=kakao requires KAKAO_REST_API_KEY (alias KAKAO_REST_API)");
  if (cfg.mapProvider === "kakao" && !cfg.kakaoJsKey) throw new Error("MAP_PROVIDER=kakao requires KAKAO_JS_KEY (alias KAKAO_JS)");
  return cfg;
}
