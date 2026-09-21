import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import bcrypt from "bcryptjs";

const DEFAULT_DB = path.join(process.cwd(), "data", "barber.sqlite");

export async function createDatabase({ file = DEFAULT_DB, persist = true } = {}) {
  const SQL = await initSqlJs();
  let db;
  if (persist && fs.existsSync(file)) {
    db = new SQL.Database(fs.readFileSync(file));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      google_id TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','completed','cancelled','no_show')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS weekly_availability (
      day_of_week INTEGER PRIMARY KEY CHECK(day_of_week BETWEEN 0 AND 6),
      is_open INTEGER NOT NULL DEFAULT 0 CHECK(is_open IN (0,1)),
      start_time TEXT NOT NULL DEFAULT '10:00',
      end_time TEXT NOT NULL DEFAULT '19:00',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS blocked_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_booked_slot
      ON appointments(date, start_time)
      WHERE status='booked';
  `);

  migrateAppointments(db);
  migrateUsers(db);

  const scheduleCount = db.exec("SELECT COUNT(*) AS total FROM weekly_availability")[0]?.values?.[0]?.[0] ?? 0;
  if (!scheduleCount) {
    const stmt = db.prepare("INSERT INTO weekly_availability (day_of_week, is_open, start_time, end_time) VALUES (?, ?, ?, ?)");
    for (let day = 0; day <= 6; day += 1) stmt.run([day, day === 0 ? 0 : 1, "10:00", "19:00"]);
    stmt.free();
  }

  const adminCount = db.exec("SELECT COUNT(*) AS total FROM users WHERE role='admin'")[0]?.values?.[0]?.[0] ?? 0;
  if (!adminCount) {
    if (process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD) {
      throw new Error("ADMIN_PASSWORD is required before creating a production admin account.");
    }
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || "AdminPass123!", 12);
    db.run("INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')", [
      "Mohamad",
      process.env.ADMIN_EMAIL || "admin@barbermohamad.local",
      "0000000000",
      hash
    ]);
  }

  function persistDb() {
    if (!persist) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(db.export()));
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function get(sql, params = []) {
    return all(sql, params)[0] || null;
  }

  function run(sql, params = []) {
    db.run(sql, params);
    persistDb();
    return get("SELECT last_insert_rowid() AS id").id;
  }

  persistDb();
  return { db, all, get, run, persist: persistDb };
}

function tableColumns(db, tableName) {
  const result = db.exec(`PRAGMA table_info(${tableName})`)[0]?.values || [];
  return result.map((row) => row[1]);
}

function migrateUsers(db) {
  const columns = tableColumns(db, "users");
  if (!columns.includes("google_id")) {
    db.run("ALTER TABLE users ADD COLUMN google_id TEXT");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)");
  }
}

function migrateAppointments(db) {
  const table = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='appointments'")[0]?.values?.[0]?.[0] || "";
  if (!table || (!table.includes("service_id") && table.includes("'no_show'"))) return;
  db.run(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE IF NOT EXISTS appointments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','completed','cancelled','no_show')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO appointments_new (id, user_id, full_name, phone, date, start_time, end_time, notes, status, created_at, updated_at)
    SELECT id, user_id, full_name, phone, date, start_time, end_time, notes,
      CASE WHEN status IN ('booked','completed','cancelled','no_show') THEN status ELSE 'booked' END,
      created_at, updated_at
    FROM appointments;
    DROP TABLE appointments;
    ALTER TABLE appointments_new RENAME TO appointments;
    PRAGMA foreign_keys = ON;
  `);
}
