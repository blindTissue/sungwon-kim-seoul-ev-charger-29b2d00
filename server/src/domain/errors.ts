import type { ErrorBody, ErrorCode } from "@seoul-ev/shared";

const CATALOG: Record<ErrorCode, { status: number; ko: string; en: string }> = {
  VALIDATION_ERROR: { status: 400, ko: "요청 값이 올바르지 않습니다.", en: "The request is invalid." },
  MISSING_DEVICE_ID: { status: 400, ko: "기기 ID(X-Device-Id)가 필요합니다.", en: "The X-Device-Id header is required." },
  NOT_FOUND: { status: 404, ko: "요청한 항목을 찾을 수 없습니다.", en: "The requested item was not found." },
  ETA_TOO_LONG: {
    status: 422,
    ko: "예상 도착 시간이 {eta}분으로, 10분 이내일 때만 예약할 수 있습니다.",
    en: "Your ETA is {eta} min. Reservations are only allowed when you are within 10 minutes.",
  },
  ALREADY_RESERVED: {
    status: 409,
    ko: "방금 다른 사용자가 이 충전기를 예약했습니다. 다른 충전기를 선택해 주세요.",
    en: "Someone else just reserved this charger. Please pick another one.",
  },
  CHARGER_UNAVAILABLE: {
    status: 409,
    ko: "이 충전기는 지금 사용할 수 없습니다. 다른 충전기를 선택해 주세요.",
    en: "This charger isn't available right now. Please pick another one.",
  },
  COOLDOWN_ACTIVE: {
    status: 429,
    ko: "지난 예약이 도착 없이 만료되어 {min}분 후에 다시 예약할 수 있습니다.",
    en: "Your last reservation expired without arrival. You can reserve again in {min} min.",
  },
  ACTIVE_RESERVATION_EXISTS: {
    status: 409,
    ko: "이미 진행 중인 예약이 있습니다. 기기당 1건만 예약할 수 있습니다.",
    en: "You already have an active reservation. Only one per device is allowed.",
  },
  RESERVATION_NOT_ACTIVE: { status: 409, ko: "이미 종료된 예약입니다.", en: "This reservation has already ended." },
  UPSTREAM_ERROR: { status: 502, ko: "외부 지도 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", en: "Couldn't reach the map service. Please try again shortly." },
  INTERNAL_ERROR: { status: 500, ko: "일시적인 서버 오류입니다. 다시 시도해 주세요.", en: "Temporary server error. Please try again." },
};

export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    readonly params: Record<string, string | number> = {},
  ) {
    super(code);
    this.status = CATALOG[code].status;
  }

  toBody(): ErrorBody {
    const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(this.params[k] ?? ""));
    const c = CATALOG[this.code];
    return { code: this.code, message_ko: fill(c.ko), message_en: fill(c.en), ...(this.details ? { details: this.details } : {}) };
  }
}

export function errorBody(code: ErrorCode, details?: Record<string, unknown>): ErrorBody {
  return new DomainError(code, details).toBody();
}

export function statusOf(code: ErrorCode): number {
  return CATALOG[code].status;
}
