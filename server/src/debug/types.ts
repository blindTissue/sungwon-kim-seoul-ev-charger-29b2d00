import type { ChargerStatus, SimulatorState } from "@seoul-ev/shared";
import type { ChargerRecord, ReservationRecord } from "../repositories/types.js";

/** Demo/debug operations (§7.3). Only the mock adapter implements this; a real backend has none. */
export interface DemoControl {
  setChargerStatus(id: string, status: Exclude<ChargerStatus, "reserved">): Promise<ChargerRecord>;
  /** Moves expires_at earlier. The reservation service's expiry sweep then applies the normal expiry rules. */
  fastForwardReservation(id: string, seconds?: number): Promise<ReservationRecord>;
  clearCooldown(deviceId: string): Promise<void>;
  reset(): Promise<void>;
  simulatorState(): SimulatorState;
  setSimulator(opts: { speed?: number; tick?: boolean }): SimulatorState;
}
