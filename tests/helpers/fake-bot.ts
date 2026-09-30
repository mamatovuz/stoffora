/*
 * Gulnora HR bot API (v1) ning xotiradagi soxta nusxasi — testlar tarmoqsiz ishlashi uchun.
 * Javob shakllari bot'ning api/repo.py serializerlari bilan bir xil.
 */

export const GOOD_KEY = "gfk_testprefix_secretsecretsecretsecret";
export const REVOKED_KEY = "gfk_revoked_secretsecretsecretsecret";

type Json = Record<string, unknown>;

export interface FakeBotOptions {
  branches?: number;
  employees?: number;
  attendance?: number;
  scopes?: string[];
}

export function createFakeBot(options: FakeBotOptions = {}) {
  const scopes = options.scopes || [
    "employees:read", "employees:write", "branches:read", "branches:write", "departments:read", "departments:write",
    "positions:read", "positions:write", "attendance:read", "attendance:write", "announcements:read", "announcements:write",
    "notifications:read", "notifications:write", "company:read", "integration:read", "integration:write", "webhooks:read", "webhooks:write",
  ];
  const state = {
    branches: [] as Json[],
    departments: [] as Json[],
    positions: [] as Json[],
    employees: [] as Json[],
    attendance: [] as Json[],
    notifications: [] as Json[],
    announcements: [] as Json[],
    events: [] as Json[],
    externalIds: [] as Json[],
    webhooks: [] as Json[],
    calls: [] as { method: string; path: string; body?: Json; idempotencyKey?: string }[],
    idempotency: new Map<string, { status: number; body: Json }>(),
    /** Keyingi N ta so‘rovga shu status qaytariladi (retry/rate-limit testlari). */
    failNext: [] as { status: number; retryAfter?: number; path?: RegExp }[],
    down: false,
  };
  const now = "2026-09-01T09:00:00+05:00";
  for (let i = 1; i <= (options.branches ?? 3); i += 1)
    state.branches.push({ id: i, name: `Filial ${i}`, code: null, address: `Manzil ${i}`, phone: null, latitude: 40.7 + i / 100, longitude: 72.3, radius: 150, working_hours: "08:00 – 24:00", status: "active", managers: [], employee_count: 0, external_ids: {}, created_at: now, updated_at: now });
  state.departments.push({ id: 1, name: "Dorixona", code: null, description: null, parent_id: null, head: null, status: "active", employee_count: 0, external_ids: {}, created_at: now, updated_at: now });
  state.positions.push({ id: 1, name: "💊 Farmatsevt", code: null, description: null, department_id: 1, status: "active", employee_count: 0, external_ids: {}, created_at: now, updated_at: now });
  for (let i = 1; i <= (options.employees ?? 3); i += 1)
    state.employees.push({
      id: i,
      telegram_id: 1000 + i,
      telegram_username: `user${i}`,
      external_ids: {},
      full_name: `Familiya${i} Ism${i}`,
      phone: `+99890000000${i}`,
      birth_date: "30.04.1995",
      address: "Andijon",
      role: "employee",
      position: "💊 Farmatsevt",
      position_id: 1,
      branch: { id: ((i - 1) % (options.branches ?? 3)) + 1, name: "Filial" },
      department: { id: 1, name: "Dorixona" },
      manager: null,
      status: "active",
      employment_status: "regular",
      hired_at: "2026-07-01T10:00:00+05:00",
      schedule: { work_hours: "08:00 - 17:00", rest_day: "Yakshanba", shift: null },
      // Haqiqiy bot kabi: maosh faqat employees:salary ruxsati bo‘lsa qaytadi.
      ...(scopes.includes("employees:salary") ? { salary: { monthly_salary: i === 1 ? "5 000 000" : "3.5 mln", currency: "UZS" } } : {}),
      created_at: now,
      updated_at: now,
    });
  for (let i = 1; i <= (options.attendance ?? 2); i += 1)
    state.attendance.push({
      id: i,
      employee: { id: ((i - 1) % (options.employees ?? 3)) + 1, full_name: "x", telegram_id: 1001 },
      branch: { id: 1, name: "Filial 1" },
      date: `2026-09-${String(i).padStart(2, "0")}`,
      check_in: `2026-09-${String(i).padStart(2, "0")}T08:10:00+05:00`,
      check_out: `2026-09-${String(i).padStart(2, "0")}T17:05:00+05:00`,
      worked_seconds: 32100,
      late: true,
      late_seconds: 600,
      early_leave: false,
      early_leave_seconds: 0,
      status: "present",
      state: "checked_out",
      verification_method: "gps",
      location: { check_in: { latitude: 40.71, longitude: 72.3, distance_m: 12 }, check_out: null },
      source: "bot",
      note: null,
      external_ids: {},
    });

  let eventSeq = 0;
  const emit = (event: string, data: Json) => {
    eventSeq += 1;
    const envelope = { id: `evt_${eventSeq}`, event, timestamp: now, source: "employee_bot", api_version: "v1", data };
    state.events.push({ seq: eventSeq, ...envelope });
    return envelope;
  };
  const ok = (data: unknown, meta?: Json, status = 200) => ({ status, body: { success: true, data, ...(meta ? { meta } : {}) } });
  const fail = (status: number, code: string, message: string) => ({ status, body: { success: false, error: { code, message } } });
  const page = (rows: Json[], url: URL) => {
    const p = Number(url.searchParams.get("page") || 1);
    const limit = Math.min(200, Number(url.searchParams.get("limit") || 50));
    const total = rows.length;
    return ok(rows.slice((p - 1) * limit, p * limit), { page: p, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
  };
  const collections: Record<string, Json[]> = {
    branches: state.branches,
    departments: state.departments,
    positions: state.positions,
    employees: state.employees,
  };
  const entityOf: Record<string, string> = { branches: "branch", departments: "department", positions: "position", employees: "employee" };

  function handle(method: string, url: URL, headers: Headers, body?: Json): { status: number; body: Json; headers?: Record<string, string> } {
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const auth = headers.get("authorization")?.replace(/^Bearer /, "");
    if (state.down) return { status: 502, body: { status: "error" } };
    const failure = state.failNext.find((f) => !f.path || f.path.test(path));
    if (failure) {
      state.failNext.splice(state.failNext.indexOf(failure), 1);
      return { status: failure.status, body: { success: false, error: { code: "fail", message: `HTTP ${failure.status}` } }, headers: failure.retryAfter !== undefined ? { "retry-after": String(failure.retryAfter) } : undefined };
    }
    if (auth === REVOKED_KEY) return fail(401, "revoked_api_key", "API kalit bekor qilingan.");
    if (auth !== GOOD_KEY) return fail(401, "invalid_api_key", "API kalit noto'g'ri.");
    const idem = headers.get("idempotency-key") || undefined;
    state.calls.push({ method, path, body, idempotencyKey: idem });
    if (idem && method !== "GET") {
      const cached = state.idempotency.get(`${method}${path}${idem}`);
      if (cached) return cached;
    }
    const result = route(method, path, url, body);
    if (idem && method !== "GET" && result.status < 500) state.idempotency.set(`${method}${path}${idem}`, result);
    return result;
  }

  function route(method: string, path: string, url: URL, body?: Json) {
    if (path === "/integration/info")
      return ok({ name: "Gulnora Farm HR Bot API", api_version: "v1", build: "1.0.0", source: "employee_bot", your_key: { name: "staffora", scopes } });
    if (path === "/company") return ok({ name: "Gulnora Farm" });
    if (path === "/integration/changes") {
      const since = Number(url.searchParams.get("since_id") || 0);
      const limit = Number(url.searchParams.get("limit") || 100);
      const rows = state.events.filter((e) => Number(e.seq) > since).slice(0, limit);
      const next = rows.length ? Number(rows[rows.length - 1].seq) : since;
      return ok(rows.map(({ seq: _s, ...rest }) => rest), { next_cursor: next, has_more: rows.length === limit });
    }
    if (path === "/integration/external-ids" && method === "PUT") {
      state.externalIds.push(body!);
      const coll = Object.entries(entityOf).find(([, v]) => v === body!.entity_type)?.[0];
      const row = coll ? collections[coll].find((r) => r.id === body!.entity_id) : undefined;
      if (row) row.external_ids = { ...(row.external_ids as Json), [String(body!.source)]: body!.external_id };
      return ok(body);
    }
    if (path === "/webhooks" && method === "POST") {
      const hook = { id: state.webhooks.length + 1, url: body!.url, secret: `whsec_test${state.webhooks.length + 1}` };
      state.webhooks.push(hook);
      return ok(hook, undefined, 201);
    }
    const hookMatch = /^\/webhooks\/(\d+)$/.exec(path);
    if (hookMatch && method === "DELETE") return ok({ deleted: true });
    if (path === "/attendance" && method === "GET") return page(state.attendance, url);
    if (path === "/attendance/check-in" || path === "/attendance/check-out") {
      const employee = state.employees.find((e) => e.id === body!.employee_id);
      if (!employee) return fail(404, "not_found", "Xodim topilmadi.");
      const row = { id: 100 + state.attendance.length, employee: { id: employee.id }, date: String(body!.timestamp).slice(0, 10), check_in: body!.timestamp, source: body!.source, external_ids: body!.external_id ? { staffora: body!.external_id } : {} };
      state.attendance.push(row);
      emit("attendance.created", row);
      return ok(row, undefined, 201);
    }
    if (path === "/notifications" && method === "POST") {
      const n = { id: state.notifications.length + 1, status: "queued", ...body };
      state.notifications.push(n);
      return ok(n, undefined, 202);
    }
    const notif = /^\/notifications\/(\d+)$/.exec(path);
    if (notif) {
      const n = state.notifications.find((x) => x.id === Number(notif[1]));
      return n ? ok({ ...n, status: "sent" }) : fail(404, "not_found", "yo'q");
    }
    if (path === "/announcements" && method === "POST") {
      const recipients = (body!.recipients || {}) as Json;
      const count = recipients.send_to_all ? state.employees.length : ((recipients.employee_ids || recipients.branch_ids || []) as unknown[]).length;
      const a = { id: state.announcements.length + 1, status: "scheduled", stats: { recipients: count, sent: 0, failed: 0, acknowledged: 0 }, ...body };
      state.announcements.push(a);
      return ok(a, undefined, 201);
    }
    const ann = /^\/announcements\/(\d+)$/.exec(path);
    if (ann) {
      const a = state.announcements.find((x) => x.id === Number(ann[1]))!;
      const stats = a.stats as Json;
      return ok({ ...a, status: "sent", stats: { ...stats, sent: stats.recipients } });
    }
    const coll = /^\/(branches|departments|positions|employees)(?:\/(\d+))?$/.exec(path);
    if (coll) {
      const rows = collections[coll[1]];
      if (!coll[2]) {
        if (method === "GET") return page(rows, url);
        if (method === "POST") {
          const row = { id: rows.length + 100, external_ids: {}, ...body };
          rows.push(row);
          emit(`${entityOf[coll[1]]}.created`, row);
          return ok(row, undefined, 201);
        }
      }
      const row = rows.find((r) => r.id === Number(coll[2]));
      if (!row) return fail(404, "not_found", "Topilmadi.");
      if (method === "GET") return ok(row);
      if (method === "PATCH") {
        Object.assign(row, body, { updated_at: new Date().toISOString() });
        emit(`${entityOf[coll[1]]}.updated`, row);
        return ok(row);
      }
      if (method === "DELETE") {
        rows.splice(rows.indexOf(row), 1);
        emit(`${entityOf[coll[1]]}.deleted`, { id: row.id });
        return ok({ deleted: true });
      }
    }
    return fail(404, "not_found", `Yo'q: ${method} ${path}`);
  }

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const result = handle(init?.method || "GET", url, headers, body);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json", ...(result.headers || {}) } });
  }) as typeof fetch;

  /** Bot tomonidagi o‘zgarish (webhook/changes hodisasi bilan). */
  function botPatch(collection: "employees" | "branches", id: number, patch: Json) {
    const row = collections[collection].find((r) => r.id === id)!;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return emit(`${entityOf[collection]}.updated`, { ...row });
  }
  function botDelete(collection: "employees" | "branches", id: number) {
    const rows = collections[collection];
    const row = rows.find((r) => r.id === id)!;
    rows.splice(rows.indexOf(row), 1);
    return emit(`${entityOf[collection]}.deleted`, { id });
  }

  return { state, fetchImpl, emit, botPatch, botDelete };
}
