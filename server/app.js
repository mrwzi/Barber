import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { createDatabase } from "./db.js";
import { dayOfWeek, getTorontoNowMinutes, getTorontoToday, isValidDate, isValidTime, minutesToTime, overlaps, SLOT_MINUTES, timeToMinutes } from "./time.js";

const JWT_COOKIE = "barber_session";
const GOOGLE_STATE_COOKIE = "barber_google_state";
const SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://blackberry-liabilities-wind-marilyn.trycloudflare.com").replace(/\/$/, "");
const GOOGLE_REDIRECT_PATH = "/api/auth/google/callback";
const GOOGLE_REDIRECT_URI = `${PUBLIC_BASE_URL}${GOOGLE_REDIRECT_PATH}`;
const phoneSchema = z.string().regex(/^[+]?[\d\s().-]{7,20}$/);
const emailSchema = z.string().email().transform((value) => value.toLowerCase());
const dateSchema = z.string().refine(isValidDate);
const timeSchema = z.string().refine(isValidTime);
const statusSchema = z.enum(["booked", "completed", "cancelled", "no_show"]);

function clean(value) {
  return sanitizeHtml(String(value ?? "").trim(), { allowedTags: [], allowedAttributes: {} });
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, fullName: user.full_name, email: user.email, phone: user.phone, role: user.role };
}

function googleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI
  };
}

function googleReady() {
  const config = googleConfig();
  return Boolean(config.clientId && config.clientSecret);
}

function redirectTarget(value) {
  if (!value || !String(value).startsWith("/")) return "/book";
  if (String(value).startsWith("//")) return "/book";
  return String(value);
}

function requestHost(req) {
  return req.get("host");
}

function sourceHost(value) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return "__invalid__";
  }
}

export async function createApp(options = {}) {
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production.");
  }
  const store = options.store || await createDatabase(options.db || {});
  const app = express();
  app.locals.store = store;

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: "50kb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    if (!["POST", "PATCH", "DELETE"].includes(req.method)) return next();
    const source = sourceHost(req.get("origin")) || sourceHost(req.get("referer"));
    if (source && source !== requestHost(req)) {
      return res.status(403).json({ message: "Invalid request origin." });
    }
    if (process.env.NODE_ENV === "production" && !source) {
      return res.status(403).json({ message: "Invalid request origin." });
    }
    next();
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });

  function sign(user) {
    return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: "7d" });
  }

  function setCookie(res, token) {
    res.cookie(JWT_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  function setGoogleStateCookie(res, state) {
    res.cookie(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000
    });
  }

  function currentUser(req, _res, next) {
    const token = req.cookies[JWT_COOKIE];
    req.user = null;
    if (token) {
      try {
        const payload = jwt.verify(token, SECRET);
        req.user = store.get("SELECT id, full_name, email, phone, role FROM users WHERE id=?", [payload.id]);
      } catch {
        req.user = null;
      }
    }
    next();
  }

  function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ message: "Please sign in or create an account to confirm your appointment." });
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin") return res.status(403).json({ message: "Admin access required." });
    next();
  }

  function appointmentRows(whereSql = "", params = []) {
    return store.all(`
      SELECT a.*, u.email AS user_email
      FROM appointments a
      JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY a.date ASC, a.start_time ASC
    `, params);
  }

  function hasConflict(date, startTime, endTime, excludeAppointmentId = null) {
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    const appointments = excludeAppointmentId
      ? store.all("SELECT start_time, end_time FROM appointments WHERE date=? AND status='booked' AND id<>?", [date, excludeAppointmentId])
      : store.all("SELECT start_time, end_time FROM appointments WHERE date=? AND status='booked'", [date]);
    const blocked = store.all("SELECT start_time, end_time FROM blocked_times WHERE date=?", [date]);
    return [...appointments, ...blocked].some((row) => overlaps(start, end, timeToMinutes(row.start_time), timeToMinutes(row.end_time)));
  }

  function appointmentEditMessage(appt) {
    if (!appt || appt.status !== "booked" || appt.date < getTorontoToday()) {
      return "This appointment is too close to edit online. Please contact Mohamad.";
    }
    if (appt.date === getTorontoToday() && timeToMinutes(appt.start_time) - getTorontoNowMinutes() <= 120) {
      return "This appointment is too close to edit online. Please contact Mohamad.";
    }
    return "";
  }

  function weeklySchedule() {
    return store.all("SELECT day_of_week AS dayOfWeek, is_open AS isOpen, start_time AS startTime, end_time AS endTime FROM weekly_availability ORDER BY day_of_week ASC")
      .map((row) => ({ ...row, isOpen: Boolean(row.isOpen) }));
  }

  function scheduleForDate(date) {
    return store.get("SELECT day_of_week AS dayOfWeek, is_open AS isOpen, start_time AS startTime, end_time AS endTime FROM weekly_availability WHERE day_of_week=?", [dayOfWeek(date)]);
  }

  function blockedTimes(whereSql = "", params = []) {
    return store.all(`SELECT id, date, start_time AS startTime, end_time AS endTime, reason FROM blocked_times ${whereSql} ORDER BY date ASC, start_time ASC`, params);
  }

  function availableTimes(date) {
    if (!isValidDate(date) || date < getTorontoToday()) return [];
    const schedule = scheduleForDate(date);
    if (!schedule || !schedule.isOpen) return [];
    const nowCutoff = date === getTorontoToday()
      ? Math.ceil(getTorontoNowMinutes() / SLOT_MINUTES) * SLOT_MINUTES
      : 0;
    const open = Math.max(timeToMinutes(schedule.startTime), nowCutoff);
    const close = timeToMinutes(schedule.endTime);
    if (open >= close) return [];
    const times = [];
    for (let start = open; start + SLOT_MINUTES <= close; start += SLOT_MINUTES) {
      const end = start + SLOT_MINUTES;
      if (!hasConflict(date, minutesToTime(start), minutesToTime(end))) times.push(minutesToTime(start));
    }
    return times;
  }

  function monthAvailability(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month))) return [];
    const [year, monthIndex] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
    const today = getTorontoToday();
    return Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, "0")}`;
      if (!isValidDate(date) || date < today) return { date, status: "past", availableSlots: 0 };
      const schedule = scheduleForDate(date);
      if (!schedule || !schedule.isOpen) return { date, status: "closed", availableSlots: 0 };
      const slots = availableTimes(date).length;
      const status = slots === 0 ? "full" : slots <= 4 ? "limited" : "available";
      return { date, status, availableSlots: slots };
    });
  }

  app.use(currentUser);

  app.get("/api/settings", (_req, res) => {
    res.json({ timezone: "America/Toronto", today: getTorontoToday() });
  });

  app.post("/api/auth/signup", authLimiter, async (req, res) => {
    const parsed = z.object({
      fullName: z.string().min(2),
      email: emailSchema,
      phone: phoneSchema,
      password: z.string().min(8),
      confirmPassword: z.string().min(8)
    }).safeParse(req.body);
    if (!parsed.success || parsed.data.password !== parsed.data.confirmPassword) {
      return res.status(400).json({ message: "Please enter a valid name, email, phone, and matching password." });
    }
    const data = parsed.data;
    if (store.get("SELECT id FROM users WHERE email=?", [data.email])) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }
    const hash = await bcrypt.hash(data.password, 12);
    store.run("INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'user')", [
      clean(data.fullName),
      data.email,
      clean(data.phone),
      hash
    ]);
    const user = store.get("SELECT id, full_name, email, phone, role FROM users WHERE email=?", [data.email]);
    setCookie(res, sign(user));
    res.status(201).json({ user: publicUser(user) });
  });

  app.post("/api/auth/signin", authLimiter, async (req, res) => {
    const parsed = z.object({ email: emailSchema, password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid email or password." });
    const user = store.get("SELECT * FROM users WHERE email=?", [parsed.data.email]);
    if (!user || !await bcrypt.compare(parsed.data.password, user.password_hash)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }
    setCookie(res, sign(user));
    res.json({ user: publicUser(user) });
  });

  app.get("/api/auth/google", authLimiter, (req, res) => {
    const config = googleConfig();
    if (!googleReady()) {
      return res.status(503).json({ message: "Google sign-in is not configured." });
    }
    const state = randomBytes(24).toString("hex");
    const next = redirectTarget(req.query.next);
    setGoogleStateCookie(res, `${state}:${Buffer.from(next).toString("base64url")}`);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account"
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get(GOOGLE_REDIRECT_PATH, authLimiter, async (req, res) => {
    const config = googleConfig();
    if (!googleReady()) return res.status(503).send("Google sign-in is not configured.");
    const stateCookie = req.cookies[GOOGLE_STATE_COOKIE] || "";
    const [expectedState, encodedNext = ""] = stateCookie.split(":");
    if (!req.query.state || req.query.state !== expectedState) {
      return res.status(400).send("Invalid Google sign-in state.");
    }
    if (!req.query.code) return res.status(400).send("Missing Google authorization code.");
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(req.query.code),
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code"
        })
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok || !tokens.access_token) throw new Error(tokens.error_description || "Google token exchange failed.");
      const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile = await profileRes.json();
      if (!profileRes.ok || !profile.email || !profile.sub) throw new Error("Could not read Google profile.");
      const email = String(profile.email).toLowerCase();
      const fullName = clean(profile.name || email.split("@")[0]);
      let user = store.get("SELECT id, full_name, email, phone, role FROM users WHERE google_id=? OR email=?", [profile.sub, email]);
      if (user) {
        store.run("UPDATE users SET google_id=?, full_name=COALESCE(NULLIF(full_name, ''), ?), updated_at=CURRENT_TIMESTAMP WHERE id=?", [profile.sub, fullName, user.id]);
      } else {
        const hash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
        store.run("INSERT INTO users (full_name, email, phone, password_hash, google_id, role) VALUES (?, ?, ?, ?, ?, 'user')", [
          fullName,
          email,
          "0000000000",
          hash,
          profile.sub
        ]);
      }
      user = store.get("SELECT id, full_name, email, phone, role FROM users WHERE google_id=? OR email=?", [profile.sub, email]);
      setCookie(res, sign(user));
      res.clearCookie(GOOGLE_STATE_COOKIE);
      let next = "/book";
      try {
        next = redirectTarget(Buffer.from(encodedNext, "base64url").toString("utf8"));
      } catch {
        next = "/book";
      }
      res.redirect(next);
    } catch (err) {
      console.error(err);
      res.status(502).send("Google sign-in failed. Please try again.");
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(JWT_COOKIE);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => res.json({ user: publicUser(req.user) }));

  app.get("/api/appointments/available", (req, res) => {
    const date = clean(req.query.date);
    res.json({ times: availableTimes(date) });
  });

  app.get("/api/appointments/month-availability", (req, res) => {
    const month = clean(req.query.month);
    res.json({ days: monthAvailability(month) });
  });

  app.post("/api/appointments", bookingLimiter, requireUser, (req, res) => {
    const parsed = z.object({
      date: dateSchema,
      time: timeSchema,
      fullName: z.string().min(2),
      phone: phoneSchema,
      notes: z.string().optional().default("")
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Please fill in date, time, name, and phone." });
    const data = parsed.data;
    if (data.date < getTorontoToday()) return res.status(400).json({ message: "Please choose a future appointment date." });
    const schedule = scheduleForDate(data.date);
    if (!schedule || !schedule.isOpen) return res.status(400).json({ message: "This day is closed. Please choose another day." });
    const endTime = minutesToTime(timeToMinutes(data.time) + SLOT_MINUTES);
    if (!availableTimes(data.date).includes(data.time) || hasConflict(data.date, data.time, endTime)) {
      return res.status(409).json({ message: "This time is no longer available. Please choose another time." });
    }
    let id;
    try {
      id = store.run(`
        INSERT INTO appointments (user_id, full_name, phone, date, start_time, end_time, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [req.user.id, clean(data.fullName), clean(data.phone), data.date, data.time, endTime, clean(data.notes).slice(0, 500)]);
    } catch (err) {
      if (String(err.message || err).includes("idx_appointments_booked_slot") || String(err.message || err).includes("UNIQUE constraint failed")) {
        return res.status(409).json({ message: "This time is no longer available. Please choose another time." });
      }
      throw err;
    }
    res.status(201).json({ message: "Your appointment is booked. Thank you for supporting Barber Mohamad.", appointment: appointmentRows("WHERE a.id=?", [id])[0] });
  });

  app.get("/api/appointments/mine", requireUser, (req, res) => {
    res.json({ appointments: appointmentRows("WHERE a.user_id=?", [req.user.id]) });
  });

  app.patch("/api/appointments/:id/cancel", requireUser, (req, res) => {
    const appt = store.get("SELECT * FROM appointments WHERE id=?", [req.params.id]);
    if (!appt || (appt.user_id !== req.user.id && req.user.role !== "admin")) return res.status(404).json({ message: "Appointment not found." });
    const editMessage = req.user.role === "admin" ? "" : appointmentEditMessage(appt);
    if (editMessage) {
      return res.status(400).json({ message: editMessage });
    }
    store.run("UPDATE appointments SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  });

  app.patch("/api/appointments/:id/reschedule", bookingLimiter, requireUser, (req, res) => {
    const parsed = z.object({
      date: dateSchema,
      time: timeSchema
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Please choose a valid date and time." });
    const appt = store.get("SELECT * FROM appointments WHERE id=?", [req.params.id]);
    if (!appt || appt.user_id !== req.user.id) return res.status(404).json({ message: "Appointment not found." });
    const editMessage = appointmentEditMessage(appt);
    if (editMessage) return res.status(400).json({ message: editMessage });
    const data = parsed.data;
    if (data.date < getTorontoToday()) return res.status(400).json({ message: "Please choose a future appointment date." });
    const schedule = scheduleForDate(data.date);
    if (!schedule || !schedule.isOpen) return res.status(400).json({ message: "This day is closed. Please choose another day." });
    const endTime = minutesToTime(timeToMinutes(data.time) + SLOT_MINUTES);
    const sameSlot = appt.date === data.date && appt.start_time === data.time;
    if (!sameSlot && (!availableTimes(data.date).includes(data.time) || hasConflict(data.date, data.time, endTime, appt.id))) {
      return res.status(409).json({ message: "This time is no longer available. Please choose another time." });
    }
    try {
      store.run(`
        UPDATE appointments
        SET date=?, start_time=?, end_time=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=? AND status='booked'
      `, [data.date, data.time, endTime, appt.id, req.user.id]);
    } catch (err) {
      if (String(err.message || err).includes("idx_appointments_booked_slot") || String(err.message || err).includes("UNIQUE constraint failed")) {
        return res.status(409).json({ message: "This time is no longer available. Please choose another time." });
      }
      throw err;
    }
    res.json({ message: "Your appointment has been rescheduled.", appointment: appointmentRows("WHERE a.id=?", [appt.id])[0] });
  });

  app.get("/api/admin/appointments", requireAdmin, (req, res) => {
    const date = req.query.date ? clean(req.query.date) : null;
    res.json({ appointments: date ? appointmentRows("WHERE a.date=?", [date]) : appointmentRows() });
  });

  app.patch("/api/admin/appointments/:id/status", requireAdmin, (req, res) => {
    const parsed = z.object({ status: statusSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid appointment status." });
    store.run("UPDATE appointments SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [parsed.data.status, req.params.id]);
    res.json({ ok: true });
  });

  app.patch("/api/admin/appointments/:id/complete", requireAdmin, (req, res) => {
    store.run("UPDATE appointments SET status='completed', updated_at=CURRENT_TIMESTAMP WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  });

  app.get("/api/admin/schedule", requireAdmin, (_req, res) => {
    res.json({ timezone: "America/Toronto", slotMinutes: SLOT_MINUTES, weeklyAvailability: weeklySchedule(), blockedTimes: blockedTimes("WHERE date >= ?", [getTorontoToday()]) });
  });

  app.put("/api/admin/schedule/weekly", requireAdmin, (req, res) => {
    const parsed = z.object({
      days: z.array(z.object({
        dayOfWeek: z.coerce.number().int().min(0).max(6),
        isOpen: z.boolean(),
        startTime: timeSchema,
        endTime: timeSchema
      })).length(7)
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Please enter a valid weekly schedule." });
    const seen = new Set();
    for (const day of parsed.data.days) {
      if (seen.has(day.dayOfWeek) || timeToMinutes(day.startTime) >= timeToMinutes(day.endTime)) {
        return res.status(400).json({ message: "Please enter a valid weekly schedule." });
      }
      seen.add(day.dayOfWeek);
    }
    parsed.data.days.forEach((day) => {
      store.run(`
        INSERT INTO weekly_availability (day_of_week, is_open, start_time, end_time, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(day_of_week) DO UPDATE SET
          is_open=excluded.is_open,
          start_time=excluded.start_time,
          end_time=excluded.end_time,
          updated_at=CURRENT_TIMESTAMP
      `, [day.dayOfWeek, day.isOpen ? 1 : 0, day.startTime, day.endTime]);
    });
    res.json({ weeklyAvailability: weeklySchedule() });
  });

  app.get("/api/admin/blocked-times", requireAdmin, (_req, res) => {
    res.json({ blockedTimes: blockedTimes() });
  });

  app.post("/api/admin/blocked-times", requireAdmin, (req, res) => {
    const parsed = z.object({
      date: dateSchema,
      startTime: timeSchema,
      endTime: timeSchema,
      reason: z.string().optional().default("")
    }).safeParse(req.body);
    if (!parsed.success || timeToMinutes(parsed.data.startTime) >= timeToMinutes(parsed.data.endTime)) {
      return res.status(400).json({ message: "Please enter a valid blocked time." });
    }
    const id = store.run("INSERT INTO blocked_times (date, start_time, end_time, reason) VALUES (?, ?, ?, ?)", [
      parsed.data.date,
      parsed.data.startTime,
      parsed.data.endTime,
      clean(parsed.data.reason)
    ]);
    res.status(201).json({ id });
  });

  app.delete("/api/admin/blocked-times/:id", requireAdmin, (req, res) => {
    store.run("DELETE FROM blocked_times WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  });

  return app;
}
