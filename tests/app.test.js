import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { createDatabase } from "../server/db.js";
import { getTorontoNowMinutes, getTorontoToday, SLOT_MINUTES, timeToMinutes } from "../server/time.js";

let app;
let agent;

async function signup(email = "user@example.com") {
  const res = await agent.post("/api/auth/signup").send({
    fullName: "Test User",
    email,
    phone: "4165551234",
    password: "Password123!",
    confirmPassword: "Password123!"
  });
  expect(res.status).toBe(201);
  return res.body.user;
}

function signin(email, password = "Password123!") {
  return agent.post("/api/auth/signin").send({ email, password });
}

async function withGoogleEnv(callback) {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  try {
    await callback();
  } finally {
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
  }
}

function mockGoogleProfile(profile) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (text.includes("openidconnect.googleapis.com/v1/userinfo")) {
      return new Response(JSON.stringify(profile), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function startGoogle(agentToUse = agent, next = "/book") {
  const start = await agentToUse.get(`/api/auth/google?next=${encodeURIComponent(next)}`).expect(302);
  return new URL(start.headers.location).searchParams.get("state");
}

function nextMonday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 1));
  return d.toISOString().slice(0, 10);
}

function nextWeekday(targetDay) {
  const d = new Date();
  const daysAhead = (targetDay - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  app = await createApp({ db: { persist: false } });
  agent = request.agent(app);
});

describe("auth", () => {
  it("signup works and hashes passwords", async () => {
    await signup();
    const row = app.locals.store.get("SELECT password_hash FROM users WHERE email=?", ["user@example.com"]);
    expect(row.password_hash).not.toBe("Password123!");
    expect(row.password_hash.length).toBeGreaterThan(20);
  });

  it("login and logout work", async () => {
    await signup();
    await agent.post("/api/auth/logout").expect(200);
    await signin("user@example.com").expect(200);
    await agent.post("/api/auth/logout").expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user).toBeNull();
  });

  it("shows invalid phone email password errors", async () => {
    const res = await agent.post("/api/auth/signup").send({ fullName: "A", email: "bad", phone: "x", password: "short", confirmPassword: "no" });
    expect(res.status).toBe(400);
  });

  it("signup cannot select admin role", async () => {
    await agent.post("/api/auth/signup").send({
      fullName: "Role Test",
      email: "role@example.com",
      phone: "4165551000",
      password: "Password123!",
      confirmPassword: "Password123!",
      role: "admin"
    }).expect(201);
    const user = app.locals.store.get("SELECT role FROM users WHERE email=?", ["role@example.com"]);
    expect(user.role).toBe("user");
  });

  it("rejects wrong login password", async () => {
    await signup("wrong@example.com");
    await signin("wrong@example.com", "bad-password").expect(401);
  });

  it("starts Google OAuth with the exact configured callback redirect URI", async () => {
    await withGoogleEnv(async () => {
      app = await createApp({ db: { persist: false } });
      agent = request.agent(app);
      const res = await agent.get("/api/auth/google?next=/book").expect(302);
      const redirect = new URL(res.headers.location);
      expect(redirect.origin + redirect.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(redirect.searchParams.get("redirect_uri")).toBe("https://blackberry-liabilities-wind-marilyn.trycloudflare.com/api/auth/google/callback");
      expect(redirect.searchParams.get("response_type")).toBe("code");
      expect(redirect.searchParams.get("scope")).toContain("openid");
    });
  });

  it("has a Google OAuth callback route that validates state", async () => {
    await withGoogleEnv(async () => {
      app = await createApp({ db: { persist: false } });
      agent = request.agent(app);
      await agent.get("/api/auth/google/callback?code=test&state=bad").expect(400);
    });
  });

  it("Google OAuth creates a new user and keeps the session after refresh", async () => {
    await withGoogleEnv(async () => {
      app = await createApp({ db: { persist: false } });
      agent = request.agent(app);
      const restoreFetch = mockGoogleProfile({ sub: "google-new-1", email: "google-new@example.com", name: "Google New" });
      try {
        const state = await startGoogle(agent);
        await agent.get(`/api/auth/google/callback?code=test-code&state=${state}`).expect(302);
        const me = await agent.get("/api/auth/me").expect(200);
        expect(me.body.user.email).toBe("google-new@example.com");
        expect(me.body.user.fullName).toBe("Google New");
        const row = app.locals.store.get("SELECT google_id FROM users WHERE email=?", ["google-new@example.com"]);
        expect(row.google_id).toBe("google-new-1");
      } finally {
        restoreFetch();
      }
    });
  });

  it("Google OAuth matches an existing user by email", async () => {
    await withGoogleEnv(async () => {
      app = await createApp({ db: { persist: false } });
      agent = request.agent(app);
      await signup("existing-google@example.com");
      const existing = app.locals.store.get("SELECT id FROM users WHERE email=?", ["existing-google@example.com"]);
      await agent.post("/api/auth/logout").expect(200);
      const restoreFetch = mockGoogleProfile({ sub: "google-existing-1", email: "existing-google@example.com", name: "Existing Google" });
      try {
        const state = await startGoogle(agent);
        await agent.get(`/api/auth/google/callback?code=test-code&state=${state}`).expect(302);
        const row = app.locals.store.get("SELECT id, google_id FROM users WHERE email=?", ["existing-google@example.com"]);
        expect(row.id).toBe(existing.id);
        expect(row.google_id).toBe("google-existing-1");
        const me = await agent.get("/api/auth/me").expect(200);
        expect(me.body.user.id).toBe(existing.id);
      } finally {
        restoreFetch();
      }
    });
  });
});

describe("booking", () => {
  it("exposes public booking settings without private data", async () => {
    const res = await agent.get("/api/settings").expect(200);
    expect(res.body.timezone).toBe("America/Toronto");
    expect(res.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("user can book an available appointment without choosing a service", async () => {
    await signup();
    const date = nextMonday();
    const res = await agent.post("/api/appointments").send({ date, time: "10:00", fullName: "Test User", phone: "4165551234" }).expect(201);
    expect(res.body.message).toContain("Your appointment is booked");
    expect(res.body.appointment).not.toHaveProperty("price_cad");
    expect(res.body.appointment).not.toHaveProperty("service_id");
  });

  it("only shows available times for a valid service and date", async () => {
    const date = nextMonday();
    const res = await agent.get(`/api/appointments/available?date=${date}`).expect(200);
    expect(res.body.times[0]).toBe("10:00");
    expect(res.body.times).toContain("18:30");
  });

  it("does not show already passed time slots for today", async () => {
    const today = getTorontoToday();
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    app.locals.store.run(`
      UPDATE weekly_availability
      SET is_open=1, start_time='00:00', end_time='23:30'
      WHERE day_of_week=?
    `, [day]);
    const cutoff = Math.ceil(getTorontoNowMinutes() / SLOT_MINUTES) * SLOT_MINUTES;
    const res = await agent.get(`/api/appointments/available?date=${today}`).expect(200);
    expect(res.body.times.every((time) => timeToMinutes(time) >= cutoff)).toBe(true);
    expect(res.body.times).not.toContain("10:00");
    expect(res.body.times).not.toContain("10:30");
  });

  it("does not show times for Sunday", async () => {
    const res = await agent.get(`/api/appointments/available?date=${nextWeekday(0)}`).expect(200);
    expect(res.body.times).toEqual([]);
  });

  it("public calendar marks Sundays closed and does not expose private booking data", async () => {
    await signup("calendar-private@example.com");
    const bookingDate = nextWeekday(1);
    const sundayDate = nextWeekday(0);
    const month = sundayDate.slice(0, 7);
    await agent.post("/api/appointments").send({
      serviceId: 1,
      date: bookingDate,
      time: "10:00",
      fullName: "Private Customer",
      phone: "4165557777",
      notes: "Private note"
    }).expect(201);
    const res = await agent.get(`/api/appointments/month-availability?month=${month}`).expect(200);
    const sunday = res.body.days.find((day) => day.date === sundayDate);
    expect(sunday.status).toBe("closed");
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain("Private Customer");
    expect(payload).not.toContain("4165557777");
    expect(payload).not.toContain("Private note");
  });

  it("public calendar marks fully booked dates as full", async () => {
    await signup("calendar-full@example.com");
    const date = nextWeekday(2);
    const times = ["10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30"];
    for (const time of times) {
      await agent.post("/api/appointments").send({ serviceId: 1, date, time, fullName: "Full Day", phone: "4165558888" }).expect(201);
    }
    const res = await agent.get(`/api/appointments/month-availability?month=${date.slice(0, 7)}`).expect(200);
    expect(res.body.days.find((day) => day.date === date).status).toBe("full");
  });

  it("rejects required fields, past dates, Sundays, malicious input, and anonymous booking", async () => {
    await agent.post("/api/appointments").send({}).expect(401);
    await signup("booker@example.com");
    await agent.post("/api/appointments").send({ serviceId: 1 }).expect(400);
    await agent.post("/api/appointments").send({ serviceId: 1, date: "2020-01-01", time: "10:00", fullName: "Test", phone: "4165551234" }).expect(400);
    await agent.post("/api/appointments").send({ serviceId: 1, date: nextWeekday(0), time: "10:00", fullName: "Test", phone: "4165551234" }).expect(400);
    const date = nextMonday();
    const res = await agent.post("/api/appointments").send({ serviceId: 1, date, time: "10:00", fullName: "<script>x</script>Test", phone: "4165551234", notes: "<img src=x onerror=1>" }).expect(201);
    expect(res.body.appointment.full_name).toBe("Test");
    expect(res.body.appointment.notes).toBe("");
  });

  it("rejects impossible dates and invalid times", async () => {
    await signup("invalid-date@example.com");
    await agent.post("/api/appointments").send({ serviceId: 1, date: "2026-02-31", time: "10:00", fullName: "Test", phone: "4165551234" }).expect(400);
    await agent.post("/api/appointments").send({ serviceId: 1, date: nextMonday(), time: "99:99", fullName: "Test", phone: "4165551234" }).expect(400);
    const available = await agent.get("/api/appointments/available?date=2026-02-31").expect(200);
    expect(available.body.times).toEqual([]);
  });

  it("prevents double booking with 30-minute internal slots", async () => {
    const date = nextMonday();
    await signup("first@example.com");
    await agent.post("/api/appointments").send({ date, time: "10:00", fullName: "First", phone: "4165551234" }).expect(201);
    let available = await agent.get(`/api/appointments/available?date=${date}`).expect(200);
    expect(available.body.times).not.toContain("10:00");
    expect(available.body.times).toContain("10:30");
    const second = request.agent(app);
    await second.post("/api/auth/signup").send({ fullName: "Second", email: "second@example.com", phone: "4165551235", password: "Password123!", confirmPassword: "Password123!" }).expect(201);
    await second.post("/api/appointments").send({ date, time: "10:00", fullName: "Second", phone: "4165551235" }).expect(409);
  });

  it("removes a booked slot from the public calendar count", async () => {
    const date = nextMonday();
    await signup("slot-count@example.com");
    const before = await agent.get(`/api/appointments/available?date=${date}`).expect(200);
    await agent.post("/api/appointments").send({ date, time: before.body.times[0], fullName: "Slot Count", phone: "4165551234" }).expect(201);
    const after = await agent.get(`/api/appointments/available?date=${date}`).expect(200);
    expect(after.body.times).not.toContain(before.body.times[0]);
    expect(after.body.times.length).toBe(before.body.times.length - 1);
  });

  it("cancelled appointments release the slot", async () => {
    const date = nextMonday();
    await signup("cancel-release@example.com");
    const booked = await agent.post("/api/appointments").send({ serviceId: 1, date, time: "10:00", fullName: "First", phone: "4165551234" }).expect(201);
    await agent.patch(`/api/appointments/${booked.body.appointment.id}/cancel`).expect(200);
    const available = await agent.get(`/api/appointments/available?date=${date}`).expect(200);
    expect(available.body.times).toContain("10:00");
  });

  it("users cannot cancel appointments too close to start time", async () => {
    await signup("close-cancel@example.com");
    const id = app.locals.store.run(`
      INSERT INTO appointments (user_id, full_name, phone, date, start_time, end_time, notes)
      VALUES (?, 'Close Cancel', '4165551234', ?, '00:00', '00:30', '')
    `, [2, new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())]);
    await agent.patch(`/api/appointments/${id}/cancel`).expect(400);
  });

  it("rejects invalid phone numbers when booking", async () => {
    await signup("phone-booking@example.com");
    const date = nextMonday();
    await agent.post("/api/appointments").send({ serviceId: 1, date, time: "10:00", fullName: "Test", phone: "abc" }).expect(400);
  });

  it("blocked times are not bookable", async () => {
    const date = nextMonday();
    await signin("admin@barbermohamad.local", "AdminPass123!").expect(200);
    await agent.post("/api/admin/blocked-times").send({ date, startTime: "11:00", endTime: "12:00", reason: "Break" }).expect(201);
    const available = await agent.get(`/api/appointments/available?date=${date}`).expect(200);
    expect(available.body.times).not.toContain("11:00");
    expect(available.body.times).not.toContain("11:30");
  });

  it("rejects invalid blocked time dates and clock values", async () => {
    await signin("admin@barbermohamad.local", "AdminPass123!").expect(200);
    await agent.post("/api/admin/blocked-times").send({ date: "2026-02-31", startTime: "11:00", endTime: "12:00" }).expect(400);
    await agent.post("/api/admin/blocked-times").send({ date: nextMonday(), startTime: "11:00", endTime: "99:00" }).expect(400);
  });
});

describe("access control", () => {
  it("user cannot see other bookings and cannot access admin", async () => {
    const date = nextMonday();
    await signup("one@example.com");
    const booked = await agent.post("/api/appointments").send({ serviceId: 1, date, time: "10:00", fullName: "One", phone: "4165551234" }).expect(201);
    await agent.get("/api/admin/appointments").expect(403);
    const other = request.agent(app);
    await other.post("/api/auth/signup").send({ fullName: "Other", email: "other@example.com", phone: "4165559999", password: "Password123!", confirmPassword: "Password123!" }).expect(201);
    const mine = await other.get("/api/appointments/mine").expect(200);
    expect(mine.body.appointments).toHaveLength(0);
    await other.patch(`/api/appointments/${booked.body.appointment.id}/cancel`).expect(404);
    await other.patch(`/api/appointments/${booked.body.appointment.id}/reschedule`).send({ date: addDays(date, 1), time: "12:00" }).expect(404);
  });

  it("logged-in user can see only their own appointments", async () => {
    const date = nextMonday();
    await signup("mine@example.com");
    await agent.post("/api/appointments").send({ date, time: "10:00", fullName: "Mine", phone: "4165551234", notes: "My note" }).expect(201);
    const other = request.agent(app);
    await other.post("/api/auth/signup").send({ fullName: "Other", email: "other-mine@example.com", phone: "4165559999", password: "Password123!", confirmPassword: "Password123!" }).expect(201);
    await other.post("/api/appointments").send({ date, time: "10:30", fullName: "Other", phone: "4165559999", notes: "Other note" }).expect(201);
    const mine = await agent.get("/api/appointments/mine").expect(200);
    expect(mine.body.appointments).toHaveLength(1);
    expect(mine.body.appointments[0].full_name).toBe("Mine");
    expect(JSON.stringify(mine.body)).not.toContain("Other note");
  });

  it("admin can see all and cancel appointments", async () => {
    const date = nextMonday();
    await signup("customer@example.com");
    const booked = await agent.post("/api/appointments").send({ serviceId: 1, date, time: "10:00", fullName: "Customer", phone: "4165551234" }).expect(201);
    const admin = request.agent(app);
    await admin.post("/api/auth/signin").send({ email: "admin@barbermohamad.local", password: "AdminPass123!" }).expect(200);
    const all = await admin.get("/api/admin/appointments").expect(200);
    expect(all.body.appointments.length).toBeGreaterThan(0);
    await admin.patch(`/api/appointments/${booked.body.appointment.id}/cancel`).expect(200);
  });

  it("unauthenticated users cannot read my appointments", async () => {
    await agent.get("/api/appointments/mine").expect(401);
  });

  it("user can cancel appointment more than 2 hours away and status is saved", async () => {
    const date = nextMonday();
    await signup("cancel-future@example.com");
    const booked = await agent.post("/api/appointments").send({ date, time: "10:00", fullName: "Cancel Future", phone: "4165551234" }).expect(201);
    await agent.patch(`/api/appointments/${booked.body.appointment.id}/cancel`).expect(200);
    const row = app.locals.store.get("SELECT status FROM appointments WHERE id=?", [booked.body.appointment.id]);
    expect(row.status).toBe("cancelled");
  });

  it("user cannot cancel appointment less than 2 hours away", async () => {
    const user = await signup("cancel-close@example.com");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const id = app.locals.store.run(`
      INSERT INTO appointments (user_id, full_name, phone, date, start_time, end_time, notes)
      VALUES (?, 'Close Cancel', '4165551234', ?, '00:00', '00:30', '')
    `, [user.id, today]);
    const res = await agent.patch(`/api/appointments/${id}/cancel`).expect(400);
    expect(res.body.message).toBe("This appointment is too close to edit online. Please contact Mohamad.");
  });

  it("user can reschedule appointment more than 2 hours away", async () => {
    const date = nextMonday();
    const newDate = addDays(date, 1);
    await signup("reschedule@example.com");
    const booked = await agent.post("/api/appointments").send({ date, time: "10:00", fullName: "Reschedule", phone: "4165551234" }).expect(201);
    await agent.patch(`/api/appointments/${booked.body.appointment.id}/reschedule`).send({ date: newDate, time: "11:00" }).expect(200);
    const row = app.locals.store.get("SELECT date, start_time, end_time, status FROM appointments WHERE id=?", [booked.body.appointment.id]);
    expect(row.date).toBe(newDate);
    expect(row.start_time).toBe("11:00");
    expect(row.end_time).toBe("11:30");
    expect(row.status).toBe("booked");
  });

  it("user cannot reschedule appointment less than 2 hours away", async () => {
    const user = await signup("reschedule-close@example.com");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const id = app.locals.store.run(`
      INSERT INTO appointments (user_id, full_name, phone, date, start_time, end_time, notes)
      VALUES (?, 'Close Reschedule', '4165551234', ?, '00:00', '00:30', '')
    `, [user.id, today]);
    const res = await agent.patch(`/api/appointments/${id}/reschedule`).send({ date: nextMonday(), time: "12:00" }).expect(400);
    expect(res.body.message).toBe("This appointment is too close to edit online. Please contact Mohamad.");
  });

  it("reschedule prevents double booking", async () => {
    const date = nextMonday();
    await signup("reschedule-first@example.com");
    const first = await agent.post("/api/appointments").send({ date, time: "10:00", fullName: "First", phone: "4165551234" }).expect(201);
    const other = request.agent(app);
    await other.post("/api/auth/signup").send({ fullName: "Other", email: "reschedule-other@example.com", phone: "4165559999", password: "Password123!", confirmPassword: "Password123!" }).expect(201);
    await other.post("/api/appointments").send({ date, time: "11:00", fullName: "Other", phone: "4165559999" }).expect(201);
    const res = await agent.patch(`/api/appointments/${first.body.appointment.id}/reschedule`).send({ date, time: "11:00" }).expect(409);
    expect(res.body.message).toBe("This time is no longer available. Please choose another time.");
    const row = app.locals.store.get("SELECT date, start_time FROM appointments WHERE id=?", [first.body.appointment.id]);
    expect(row.date).toBe(date);
    expect(row.start_time).toBe("10:00");
  });

  it("admin can filter appointments by date", async () => {
    const date = nextMonday();
    await signup("filter@example.com");
    await agent.post("/api/appointments").send({ serviceId: 1, date, time: "12:00", fullName: "Filter", phone: "4165551234" }).expect(201);
    const admin = request.agent(app);
    await admin.post("/api/auth/signin").send({ email: "admin@barbermohamad.local", password: "AdminPass123!" }).expect(200);
    const filtered = await admin.get(`/api/admin/appointments?date=${date}`).expect(200);
    expect(filtered.body.appointments.every((appt) => appt.date === date)).toBe(true);
  });

  it("admin can mark appointments completed and no-show", async () => {
    const date = nextMonday();
    await signup("complete@example.com");
    const booked = await agent.post("/api/appointments").send({ serviceId: 1, date, time: "13:00", fullName: "Complete", phone: "4165551234" }).expect(201);
    const admin = request.agent(app);
    await admin.post("/api/auth/signin").send({ email: "admin@barbermohamad.local", password: "AdminPass123!" }).expect(200);
    await admin.patch(`/api/admin/appointments/${booked.body.appointment.id}/complete`).expect(200);
    const row = app.locals.store.get("SELECT status FROM appointments WHERE id=?", [booked.body.appointment.id]);
    expect(row.status).toBe("completed");
    await admin.patch(`/api/admin/appointments/${booked.body.appointment.id}/status`).send({ status: "no_show" }).expect(200);
    const updated = app.locals.store.get("SELECT status FROM appointments WHERE id=?", [booked.body.appointment.id]);
    expect(updated.status).toBe("no_show");
  });

  it("normal user cannot manage schedule", async () => {
    await signup("schedule-user@example.com");
    await agent.get("/api/admin/schedule").expect(403);
    await agent.put("/api/admin/schedule/weekly").send({ days: [] }).expect(403);
  });

  it("rejects cross-site and malformed write origins", async () => {
    await signup("origin@example.com");
    await agent.post("/api/auth/logout").set("Origin", "https://evil.example").expect(403);
    await agent.post("/api/auth/logout").set("Origin", "::::").expect(403);
  });

  it("admin can set open and closed weekdays and public calendar follows it", async () => {
    await signin("admin@barbermohamad.local", "AdminPass123!").expect(200);
    const current = await agent.get("/api/admin/schedule").expect(200);
    const days = current.body.weeklyAvailability.map((day) => day.dayOfWeek === 1
      ? { ...day, isOpen: true, startTime: "12:00", endTime: "13:00" }
      : day.dayOfWeek === 2
        ? { ...day, isOpen: false }
        : day);
    await agent.put("/api/admin/schedule/weekly").send({ days }).expect(200);
    const monday = nextWeekday(1);
    const tuesday = nextWeekday(2);
    const mondayTimes = await agent.get(`/api/appointments/available?date=${monday}`).expect(200);
    expect(mondayTimes.body.times).toEqual(["12:00", "12:30"]);
    const tuesdayTimes = await agent.get(`/api/appointments/available?date=${tuesday}`).expect(200);
    expect(tuesdayTimes.body.times).toEqual([]);
    const month = await agent.get(`/api/appointments/month-availability?month=${tuesday.slice(0, 7)}`).expect(200);
    expect(month.body.days.find((day) => day.date === tuesday).status).toBe("closed");
  });

  it("frontend does not expose menu choices or time-length preselection", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "main.jsx"), "utf8");
    expect(source).toContain("Book<br />Appointment");
    expect(source).toContain("Pick a date and time. You can tell Mohamad what you need when you arrive.");
    expect(source).toContain("Cost: Ask Mohamad");
    expect(source).toContain("Date: {summaryDate || \"Not selected\"}");
    expect(source).toContain("Time: {summaryTime || \"Not selected\"}");
    expect(source).not.toContain("Appointment Types");
    expect(source).not.toContain("Haircut + Beard");
    expect(source).not.toContain("Skin Fade");
    expect(source).not.toContain("Beard Trim");
    expect(source).not.toContain("duration_minutes");
    expect(source).not.toContain("/book?service=");
  });

  it("frontend calendar generates month dates and cannot get stuck on loading availability", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "main.jsx"), "utf8");
    expect(source).toContain("daysInMonth");
    expect(source).toContain("Array.from({ length: daysInMonth }");
    expect(source).toContain("Could not load live availability. Please try again.");
    expect(source).toContain("setAvailabilityLoading(false)");
    expect(source).not.toContain("Loading availability.");
  });

  it("frontend includes mobile responsive styles", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src", "styles.css"), "utf8");
    expect(css).toContain("@media (min-width: 641px) and (max-width: 1024px)");
    expect(css).toContain("@media (min-width: 1025px)");
    expect(css).toContain("grid-template-columns: 1fr");
  });

  it("homepage includes why book, simple appointment section, and CTA sections before shared footer", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "main.jsx"), "utf8");
    expect(source).toContain("Why Book With Mohamad?");
    expect(source).toContain("Simple Appointments");
    expect(source).toContain("ContactFooter");
    expect(source).toContain("Ready for a fresh cut?");
    expect(source.indexOf("Why Book With Mohamad?")).toBeLessThan(source.indexOf("Ready for a fresh cut?"));
    expect(source).not.toContain("Popular Services");
  });
});

describe("production hardening", () => {
  it("requires a session secret in production", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = "production";
    try {
      await expect(createApp({ db: { persist: false } })).rejects.toThrow("SESSION_SECRET");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = originalSecret;
    }
  });

  it("does not create a production admin with the development password", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPassword = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "production";
    try {
      await expect(createDatabase({ persist: false })).rejects.toThrow("ADMIN_PASSWORD");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = originalPassword;
    }
  });
});
