import type { ChargerSpeed } from "@seoul-ev/shared";
import type { DB } from "./db.js";

/** mulberry32: tiny, fast, seedable PRNG so simulator runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 강남구, 중구, 영등포구 */
export const BUSINESS_DISTRICTS = new Set(["11680", "11140", "11560"]);

// Base occupancy by local hour (KST): low overnight, peaks 08–10 and 18–21.
const HOURLY = [0.12, 0.1, 0.08, 0.08, 0.08, 0.1, 0.2, 0.35, 0.62, 0.66, 0.55, 0.45, 0.45, 0.42, 0.42, 0.44, 0.47, 0.55, 0.68, 0.72, 0.7, 0.55, 0.32, 0.18];

export function targetOccupancy(simTime: number, districtCode: string): number {
  const kst = new Date(simTime + 9 * HOUR);
  const hour = kst.getUTCHours();
  const weekday = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  let occ = HOURLY[hour]!;
  if (BUSINESS_DISTRICTS.has(districtCode) && weekday && hour >= 8 && hour <= 20) occ += 0.18;
  if (!weekday) occ *= 0.85;
  return Math.min(0.92, Math.max(0.03, occ));
}

const SESSION = { DC: [25 * MIN, 60 * MIN], AC: [2 * HOUR, 6 * HOUR] } as const;
const OOO_SHARE = 0.03;
const OOO_MEAN = 3 * HOUR;
const UNKNOWN_SHARE = 0.01;
const UNKNOWN_MEAN = 10 * MIN;

interface Row {
  id: string;
  speed: ChargerSpeed;
  status: string;
  district_code: string;
  sim_session_end: number | null;
  sim_fault_until: number | null;
}

export interface SimulatorOptions {
  seed: number;
  speed: number;
  tickMs: number;
  /** Real-time clock (epoch ms) used for status_updated_at and as the starting sim time. */
  now: () => number;
}

/**
 * Mock-only availability simulator. Advances a simulated clock by tickMs × speed per tick and
 * updates charger statuses in the mock SQLite store. Never touches `reserved` chargers.
 */
export class Simulator {
  private rng: () => number;
  private simTime: number;
  private timer: NodeJS.Timeout | null = null;
  ticks = 0;
  speed: number;

  constructor(
    private readonly db: DB,
    private readonly opts: SimulatorOptions,
  ) {
    this.rng = mulberry32(opts.seed);
    this.simTime = opts.now();
    this.speed = opts.speed;
  }

  get seed(): number {
    return this.opts.seed;
  }
  get tickMs(): number {
    return this.opts.tickMs;
  }
  get now(): number {
    return this.simTime;
  }

  private uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  sessionLength(speed: ChargerSpeed): number {
    const [lo, hi] = SESSION[speed];
    return this.uniform(lo, hi);
  }

  /** Sim time at which a session started now would end (used by "I've arrived"). */
  sessionEnd = (c: { speed: ChargerSpeed }): number => this.simTime + this.sessionLength(c.speed);

  private rows(): Row[] {
    return this.db
      .prepare(
        `SELECT c.id, c.speed, c.status, s.district_code, c.sim_session_end, c.sim_fault_until
         FROM chargers c JOIN stations s ON s.id = c.station_id ORDER BY c.id`,
      )
      .all() as Row[];
  }

  /** Re-seeds the RNG and draws a steady-state snapshot for the current time of day. */
  initialize(): void {
    this.rng = mulberry32(this.opts.seed);
    this.simTime = this.opts.now();
    this.ticks = 0;
    const realNow = this.opts.now();
    const upd = this.db.prepare("UPDATE chargers SET status = ?, status_updated_at = ?, sim_session_end = ?, sim_fault_until = ? WHERE id = ?");
    this.db.transaction(() => {
      for (const r of this.rows()) {
        if (r.status === "reserved") continue;
        const u = this.rng();
        if (u < OOO_SHARE) {
          upd.run("out_of_order", realNow, null, this.simTime + this.uniform(0.2, 2) * OOO_MEAN, r.id);
        } else if (u < OOO_SHARE + UNKNOWN_SHARE) {
          upd.run("unknown", realNow, null, this.simTime + this.uniform(0.2, 2) * UNKNOWN_MEAN, r.id);
        } else if (this.rng() < targetOccupancy(this.simTime, r.district_code)) {
          upd.run("charging", realNow, this.simTime + this.rng() * this.sessionLength(r.speed), null, r.id);
        } else {
          upd.run("available", realNow, null, null, r.id);
        }
      }
    })();
  }

  /** Advances simulated time by tickMs × speed and applies arrivals, departures and faults. */
  tick(): void {
    const dt = this.opts.tickMs * this.speed;
    if (dt <= 0) return;
    this.simTime += dt;
    this.ticks++;
    const realNow = this.opts.now();
    const t = this.simTime;
    const set = this.db.prepare("UPDATE chargers SET status = ?, status_updated_at = ?, sim_session_end = ?, sim_fault_until = ? WHERE id = ? AND status <> 'reserved'");
    const pOoo = 1 - Math.exp(-(OOO_SHARE / ((1 - OOO_SHARE) * OOO_MEAN)) * dt);
    const pUnknown = 1 - Math.exp(-(UNKNOWN_SHARE / ((1 - UNKNOWN_SHARE) * UNKNOWN_MEAN)) * dt);

    this.db.transaction(() => {
      for (const r of this.rows()) {
        // Draw the same number of random values per charger every tick so runs stay reproducible
        // regardless of which branch is taken.
        const [u1, u2, u3] = [this.rng(), this.rng(), this.rng()];
        if (r.status === "reserved") continue;

        if (r.status === "out_of_order" || r.status === "unknown") {
          if (r.sim_fault_until !== null && r.sim_fault_until > t) continue;
          // Back online: resume whatever is plausible for the hour.
          if (u1 < targetOccupancy(t, r.district_code)) set.run("charging", realNow, t + u2 * this.sessionLength(r.speed), null, r.id);
          else set.run("available", realNow, null, null, r.id);
          continue;
        }

        if (u1 < pOoo) {
          set.run("out_of_order", realNow, null, t + this.uniform(0.3, 1.7) * OOO_MEAN, r.id);
          continue;
        }
        if (u1 < pOoo + pUnknown) {
          set.run("unknown", realNow, null, t + this.uniform(0.3, 1.7) * UNKNOWN_MEAN, r.id);
          continue;
        }

        if (r.status === "charging") {
          if (r.sim_session_end === null || r.sim_session_end <= t) set.run("available", realNow, null, null, r.id);
          continue;
        }

        // available: arrival hazard chosen so steady-state occupancy ≈ target.
        const occ = targetOccupancy(t, r.district_code);
        const [lo, hi] = SESSION[r.speed];
        const meanSession = (lo + hi) / 2;
        const rate = occ / ((1 - occ) * meanSession);
        if (u2 < 1 - Math.exp(-rate * dt)) {
          set.run("charging", realNow, t + lo + (hi - lo) * u3, null, r.id);
        }
      }
    })();
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), this.opts.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
