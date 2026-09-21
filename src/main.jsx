import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Link, Navigate, Route, BrowserRouter as Router, Routes, useLocation, useNavigate } from "react-router-dom";
import { Calendar, CalendarDays, Clock, Instagram, LogOut, Menu, Scissors, Shield, User } from "lucide-react";
import "./styles.css";

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function useAuth() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    api("/auth/me").then((data) => setUser(data.user)).catch(() => setUser(null));
  }, []);
  return { user, setUser };
}

function Layout({ user, setUser, children }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  function closeMenu() {
    setOpen(false);
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    closeMenu();
    navigate("/");
  }
  function navClass(path) {
    return location.pathname === path ? "active" : "";
  }
  return (
    <>
      <div className="app-shell">
        <header className="site-header">
          <Link className="brand" to="/" onClick={closeMenu}><Scissors size={22} /> Barber Mohamad</Link>
          <Link className="header-book gold-button small" to="/book" onClick={closeMenu}><Calendar size={16} /> Book</Link>
          <button className="icon-button mobile-only" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}><Menu /></button>
          <nav className={open ? "nav open" : "nav"}>
            <Link className={navClass("/")} to="/" onClick={closeMenu}>Home</Link>
            <Link className={navClass("/book")} to="/book" onClick={closeMenu}>Book</Link>
            <Link className={navClass("/about")} to="/about" onClick={closeMenu}>About</Link>
            {user && <Link className={navClass("/appointments")} to="/appointments" onClick={closeMenu}>My Appointments</Link>}
            {!user && <Link className={navClass("/signin")} to="/signin" onClick={closeMenu}>Sign In / Sign Up</Link>}
            {user?.role === "admin" && <Link className={navClass("/admin")} to="/admin" onClick={closeMenu}>Admin</Link>}
            {user && <button className="nav-button" onClick={logout}><LogOut size={16} /> Logout</button>}
            <Link className="gold-button small" to="/book" onClick={closeMenu}>Book Now</Link>
          </nav>
        </header>
        <main className="site-main" onClick={closeMenu}>{children}</main>
        <ContactFooter />
      </div>
    </>
  );
}

function FeatureRow({ compact = false }) {
  const items = [
    { icon: <Scissors />, title: "Clean Cuts", text: "Simple cuts and fresh style." },
    { icon: <CalendarDays />, title: "Easy Booking", text: "Pick a date and time online." },
    { icon: <User />, title: "Friendly Service", text: "Comfortable, respectful, and beginner-friendly." }
  ];
  return (
    <section className={compact ? "features compact" : "features"}>
      {items.map((item) => (
        <div key={item.title}>
          {item.icon}
          <span><strong>{item.title}</strong><small>{item.text}</small></span>
        </div>
      ))}
    </section>
  );
}

function ContactFooter() {
  return (
    <footer className="footer">
      <div>
        <Link className="footer-brand" to="/"><Scissors size={20} /> Barber Mohamad</Link>
        <p>Simple cuts. Clean style. Easy booking.</p>
      </div>
      <div>
        <strong>Contact</strong>
        <a href="tel:+1971501234567">+971 50 123 4567</a>
        <a href="https://www.instagram.com/barber.mohamad" target="_blank" rel="noreferrer"><Instagram size={18} /> @barber.mohamad</a>
      </div>
      <div>
        <strong>Hours</strong>
        <span><Clock size={18} /> Mon - Sat: 10:00 AM - 7:00 PM</span>
        <span>Sunday: Closed</span>
      </div>
      <div>
        <strong>Pages</strong>
        <Link to="/book">Book Appointment</Link>
        <Link to="/about">About Mohamad</Link>
      </div>
    </footer>
  );
}

function Home() {
  return (
    <>
      <section className="hero home-hero">
        <div className="hero-media" />
        <div className="hero-content">
          <h1>Good Cut. Good Day.</h1>
          <p>Book a simple appointment with Mohamad. Pick a time, come in, and talk about the cut you need.</p>
          <div className="actions">
            <Link className="gold-button" to="/book"><Calendar size={16} /> Book Appointment</Link>
            <Link className="text-link" to="/book">View Schedule <span>→</span></Link>
          </div>
        </div>
      </section>
      <section className="home-section">
        <div className="section-title">
          <h2>Why Book With Mohamad?</h2>
          <p>Simple booking, clean style, and friendly service.</p>
        </div>
        <FeatureRow />
      </section>
      <section className="home-section appointment-info-section">
        <div className="section-title">
          <h2>Simple Appointments</h2>
          <p>Choose an open day and time. Mohamad will talk with you about the haircut when you arrive.</p>
        </div>
        <div className="appointment-info-grid">
          <article>
            <CalendarDays />
            <h3>Calendar First</h3>
            <p>Start by choosing an available day and time.</p>
          </article>
          <article>
            <Scissors />
            <h3>Talk There</h3>
            <p>Not sure what cut you need? You can explain it when you arrive.</p>
          </article>
          <article>
            <Clock />
            <h3>Clear Schedule</h3>
            <p>Available, limited, full, and closed days are shown before any booking details.</p>
          </article>
        </div>
      </section>
      <section className="home-cta">
        <h2>Ready for a fresh cut?</h2>
        <p>Book your appointment with Mohamad in a few simple steps.</p>
        <Link className="gold-button" to="/book"><Calendar size={16} /> Book Appointment</Link>
      </section>
    </>
  );
}

function Book({ user }) {
  const navigate = useNavigate();
  const [times, setTimes] = useState([]);
  const [availabilityByDate, setAvailabilityByDate] = useState({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [today, setToday] = useState("");
  const [form, setForm] = useState({ date: "", time: "", fullName: user?.fullName || "", phone: user?.phone || "", notes: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [availabilityRefreshKey, setAvailabilityRefreshKey] = useState(0);
  const bookingRequestRef = useRef(false);
  useEffect(() => {
    api("/settings").then((data) => {
      setToday(data.today);
      setCalendarMonth(data.today.slice(0, 7));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (user) setForm((old) => ({ ...old, fullName: old.fullName || user.fullName, phone: old.phone || user.phone }));
  }, [user]);
  useEffect(() => {
    let cancelled = false;
    if (!form.date) return setTimes([]);
    api(`/appointments/available?date=${form.date}`).then((data) => {
      if (!cancelled) setTimes(data.times);
    }).catch(() => {
      if (!cancelled) setTimes([]);
    });
    return () => {
      cancelled = true;
    };
  }, [form.date, availabilityRefreshKey]);
  useEffect(() => {
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError("");
    api(`/appointments/month-availability?month=${calendarMonth}`)
      .then((data) => {
        if (cancelled) return;
        const next = {};
        if (Array.isArray(data.days)) {
          data.days.forEach((day) => {
            next[day.date] = day.status;
          });
        } else {
          Object.assign(next, data);
        }
        setAvailabilityByDate(next);
      })
      .catch(() => {
        if (!cancelled) {
          setAvailabilityByDate({});
          setAvailabilityError("Could not load live availability. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarMonth, availabilityRefreshKey]);
  function change(event) {
    const value = event.target.value;
    setForm((old) => ({ ...old, [event.target.name]: value, ...(event.target.name === "date" ? { time: "" } : {}) }));
    setFieldErrors((old) => ({ ...old, [event.target.name]: "" }));
  }
  function selectDate(date) {
    setForm((old) => ({ ...old, date, time: "" }));
    setFieldErrors((old) => ({ ...old, date: "", time: "" }));
  }
  function selectTime(time) {
    setForm((old) => ({ ...old, time }));
    setFieldErrors((old) => ({ ...old, time: "" }));
  }
  function validateBooking() {
    const next = {};
    if (!form.date) next.date = "Choose a date.";
    if (!form.time) next.time = "Choose a time.";
    if (!form.fullName.trim()) next.fullName = "Enter your full name.";
    if (!/^[+]?[\d\s().-]{7,20}$/.test(form.phone.trim())) next.phone = "Enter a valid phone number.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }
  async function submit(event) {
    event.preventDefault();
    if (bookingRequestRef.current || bookingSubmitting || bookingComplete) return;
    setError("");
    if (!bookingComplete) setMessage("");
    if (!validateBooking()) return;
    if (!user) {
      sessionStorage.setItem("pendingBooking", JSON.stringify(form));
      navigate(`/signin?next=${encodeURIComponent("/book")}`);
      return;
    }
    bookingRequestRef.current = true;
    setBookingSubmitting(true);
    try {
      const data = await api("/appointments", { method: "POST", body: JSON.stringify(form) });
      setMessage(data.message || "Your appointment is booked.");
      setBookingComplete(true);
      setAvailabilityRefreshKey((key) => key + 1);
    } catch (err) {
      setError(err.message);
      setAvailabilityRefreshKey((key) => key + 1);
    } finally {
      bookingRequestRef.current = false;
      setBookingSubmitting(false);
    }
  }
  useEffect(() => {
    const pending = sessionStorage.getItem("pendingBooking");
    if (user && pending) {
      setForm((old) => ({ ...old, ...JSON.parse(pending) }));
      sessionStorage.removeItem("pendingBooking");
    }
  }, [user]);
  const summaryDate = form.date ? formatDateLabel(form.date) : "";
  const summaryTime = form.time ? formatTime(form.time) : "";
  const selectedStatus = form.date ? availabilityByDate[form.date] || "closed" : "";
  const availabilityText = selectedStatus ? availabilityLabel(selectedStatus) : "Choose a date";

  return (
    <section className="page book-page">
      <div className="page-title left">
        <h1>Book<br />Appointment</h1>
        <p>Pick a date and time. You can tell Mohamad what you need when you arrive.</p>
      </div>
      {!user && (
        <div className="auth-required-card">
          <User />
          <div>
            <strong>Sign in before booking</strong>
            <p>Please sign in or create an account before choosing a date and time.</p>
          </div>
          <div className="auth-required-actions">
            <Link className="gold-button small" to={`/signin?next=${encodeURIComponent("/book")}`}>Sign In</Link>
            <Link className="ghost-button small" to={`/signup?next=${encodeURIComponent("/book")}`}>Create Account</Link>
          </div>
        </div>
      )}
      <div className="booking-layout">
        <form className={user ? "booking-form" : "booking-form disabled-form"} onSubmit={submit} noValidate aria-disabled={!user}>
          <BookingCalendar
            month={calendarMonth}
            today={today}
            availabilityByDate={availabilityByDate}
            loading={availabilityLoading}
            error={availabilityError}
            selectedDate={form.date}
            canSelect={Boolean(user) && !bookingSubmitting && !bookingComplete}
            onMonthChange={setCalendarMonth}
            onSelectDate={selectDate}
          />
          {fieldErrors.date && <span className="field-error" id="date-error">{fieldErrors.date}</span>}
          <div className="time-section" aria-describedby="time-error">
            <strong>Available time slots</strong>
            {form.date ? (
              <div className="time-slots">
                {times.length ? times.map((time) => (
                  <button className={form.time === time ? "time-slot selected" : "time-slot"} type="button" key={time} onClick={() => selectTime(time)} disabled={!user || bookingSubmitting || bookingComplete}>{formatTime(time)}</button>
                )) : <p>No times available for this date.</p>}
              </div>
            ) : <p>Choose a date to see available times.</p>}
            {fieldErrors.time && <span className="field-error" id="time-error">{fieldErrors.time}</span>}
          </div>
          <label>Full Name<input name="fullName" placeholder="Enter your full name" value={form.fullName} onChange={change} onInput={change} required aria-describedby="fullName-error" disabled={!user || bookingSubmitting || bookingComplete} />{fieldErrors.fullName && <span className="field-error" id="fullName-error">{fieldErrors.fullName}</span>}</label>
          <label>Phone Number<input name="phone" placeholder="Enter your phone number" value={form.phone} onChange={change} onInput={change} required aria-describedby="phone-error" disabled={!user || bookingSubmitting || bookingComplete} />{fieldErrors.phone && <span className="field-error" id="phone-error">{fieldErrors.phone}</span>}</label>
          <label>Notes (optional)<textarea name="notes" placeholder="Tell Mohamad what kind of cut you want, or write “not sure”." value={form.notes} onChange={change} onInput={change} rows="3" disabled={!user || bookingSubmitting || bookingComplete} /></label>
          <div className="booking-summary" aria-live="polite">
            <strong>Booking Summary</strong>
            <span>Cost: Ask Mohamad</span>
            <span>Date: {summaryDate || "Not selected"}</span>
            <span>Time: {summaryTime || "Not selected"}</span>
            <span>Availability: {availabilityText}</span>
          </div>
          {error && <p className="error">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button className="gold-button" type="submit" disabled={!user || bookingSubmitting || bookingComplete}>
            <Calendar size={18} /> {bookingComplete ? "Booked" : bookingSubmitting ? "Booking..." : "Confirm Booking"}
          </button>
          <p className="secure-note">Your information is secure and will only be used for booking.</p>
        </form>
        <aside className="booking-panel">
          <Scissors />
          <h2>Barber Mohamad</h2>
          <p>Choose a time that works for you. Appointment details stay private.</p>
          <div className="side-summary">
            <span>Cost: Ask Mohamad</span>
            <span>Date: {summaryDate || "Not selected"}</span>
            <span>Time: {summaryTime || "Not selected"}</span>
            <span>Availability: {availabilityText}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function availabilityLabel(status) {
  return ({ available: "Available", limited: "Few slots", full: "Full", closed: "Closed", past: "Past date" })[status] || "Choose a date";
}

function formatTime(time) {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function addMonths(month, amount) {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year * 12 + (monthNumber - 1) + amount;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDateLabel(date) {
  const [, month, day] = date.split("-").map(Number);
  return `${monthNames[month - 1]} ${day}`;
}

function dayOfWeek(year, month, day) {
  let y = year;
  let m = month;
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h = (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  return (h + 6) % 7;
}

function BookingCalendar({ month, today, availabilityByDate, loading, error, selectedDate, canSelect = true, onMonthChange, onSelectDate }) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = dayOfWeek(year, monthNumber, 1);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthName = `${monthNames[monthNumber - 1]} ${year}`;
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${month}-${String(dayNumber).padStart(2, "0")}`;
    const fallbackStatus = date < today ? "past" : "closed";
    return { date, status: availabilityByDate[date] || fallbackStatus };
  });
  const cells = [...Array(firstDay).fill(null), ...days];
  return (
    <section className="calendar-card" aria-label="Booking calendar">
      <div className="calendar-header">
        <button type="button" className="ghost-button" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="Previous month">‹</button>
        <strong>{monthName}</strong>
        <button type="button" className="ghost-button" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="Next month">›</button>
      </div>
      {loading && <p className="calendar-hint">Checking live availability...</p>}
      {error && <p className="calendar-error">{error}</p>}
      <div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {cells.map((day, index) => day ? (
          <button
            type="button"
            key={day.date}
            className={`calendar-day ${day.status} ${selectedDate === day.date ? "selected" : ""} ${today === day.date ? "today" : ""}`}
            disabled={!canSelect || ["past", "closed", "full"].includes(day.status)}
            onClick={() => onSelectDate(day.date)}
            aria-label={`${day.date} ${availabilityLabel(day.status)}`}
          >
            <span>{Number(day.date.slice(-2))}</span>
            <small>{availabilityLabel(day.status)}</small>
          </button>
        ) : <span className="calendar-empty" key={`empty-${index}`} />)}
      </div>
      <div className="calendar-legend">
        <span><i className="dot available" />Available</span>
        <span><i className="dot limited" />Few slots</span>
        <span><i className="dot full" />Full</span>
        <span><i className="dot closed" />Closed</span>
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="about-page">
      <div className="about-intro">
        <div className="about-copy">
          <span className="eyebrow">About</span>
          <h1>About Mohamad<span>.</span></h1>
          <p>I care about every cut. For me, it’s not just about a haircut - it’s about helping you look good, feel confident, and leave with a smile.</p>
          <p>I focus on clean style, attention to detail, and friendly service. Every client matters, and I’ll always take the time to get it right.</p>
          <p>Thanks for supporting a local barber and this new journey.</p>
          <Link className="gold-button" to="/book"><Calendar size={16} /> Book Appointment</Link>
        </div>
      </div>
      <div className="about-image-section">
        <figure className="about-image-frame">
          <img src="/images/barber-cut-about.jpg" alt="Mohamad cutting hair" />
        </figure>
      </div>
      <div className="about-values-section">
        <FeatureRow compact />
      </div>
      <section className="about-cta">
        <h2>Ready for a fresh cut?</h2>
        <p>Book your appointment with Mohamad in a few simple steps.</p>
        <Link className="gold-button" to="/book"><Calendar size={16} /> Book Appointment</Link>
      </section>
    </section>
  );
}

function Auth({ setUser, mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const isSignup = mode === "signup";
  function change(event) { setForm({ ...form, [event.target.name]: event.target.value }); }
  function googleAuth() {
    window.location.href = `/api/auth/google?next=${encodeURIComponent(params.get("next") || "/book")}`;
  }
  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api(isSignup ? "/auth/signup" : "/auth/signin", { method: "POST", body: JSON.stringify(form) });
      setUser(data.user);
      navigate(params.get("next") || "/book");
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <section className="page form-page">
      <h1>{isSignup ? "Sign Up" : "Sign In"}</h1>
      <form className="booking-form" onSubmit={submit}>
        <button className="google-button" type="button" onClick={googleAuth} aria-label={isSignup ? "Sign up with Google" : "Sign in with Google"}>
          <span className="google-mark" aria-hidden="true">G</span>
          {isSignup ? "Sign up with Google" : "Sign in with Google"}
        </button>
        <div className="auth-divider"><span>Email</span></div>
        {isSignup && <label>Full name<input name="fullName" value={form.fullName} onChange={change} required /></label>}
        <label>Email<input name="email" type="email" value={form.email} onChange={change} required /></label>
        {isSignup && <label>Phone number<input name="phone" value={form.phone} onChange={change} required /></label>}
        <label>Password<input name="password" type="password" value={form.password} onChange={change} required /></label>
        {isSignup && <label>Confirm password<input name="confirmPassword" type="password" value={form.confirmPassword} onChange={change} required /></label>}
        {error && <p className="error">{error}</p>}
        <button className="gold-button" type="submit"><User size={18} /> {isSignup ? "Create Account" : "Sign In"}</button>
      </form>
      <p className="switch-auth">{isSignup ? <Link to="/signin">Already have an account?</Link> : <Link to="/signup">Create an account</Link>}</p>
    </section>
  );
}

function canManageAppointment(appt, today) {
  if (!appt || appt.status !== "booked" || !today || appt.date < today) return false;
  if (appt.date > today) return true;
  const [hour, minute] = appt.start_time.split(":").map(Number);
  const start = new Date();
  start.setHours(hour, minute, 0, 0);
  return start.getTime() - Date.now() > 120 * 60 * 1000;
}

function isTooCloseToEdit(appt, today) {
  return Boolean(appt && appt.status === "booked" && today && appt.date >= today && !canManageAppointment(appt, today));
}

function MyAppointments({ user }) {
  const [appointments, setAppointments] = useState([]);
  const [today, setToday] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reschedulingId, setReschedulingId] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleTimes, setRescheduleTimes] = useState([]);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [availabilityByDate, setAvailabilityByDate] = useState({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    api("/settings").then((data) => {
      setToday(data.today);
      setCalendarMonth(data.today.slice(0, 7));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    api("/appointments/mine").then((data) => setAppointments(data.appointments)).catch((err) => setError(err.message));
  }, [user, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setAvailabilityLoading(true);
    setAvailabilityError("");
    api(`/appointments/month-availability?month=${calendarMonth}`)
      .then((data) => {
        if (cancelled) return;
        const next = {};
        data.days.forEach((day) => {
          next[day.date] = day.status;
        });
        setAvailabilityByDate(next);
      })
      .catch(() => {
        if (!cancelled) setAvailabilityError("Could not load live availability. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarMonth, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!rescheduleDate) return setRescheduleTimes([]);
    api(`/appointments/available?date=${rescheduleDate}`).then((data) => {
      if (!cancelled) setRescheduleTimes(data.times);
    }).catch(() => {
      if (!cancelled) setRescheduleTimes([]);
    });
    return () => {
      cancelled = true;
    };
  }, [rescheduleDate, refreshKey]);

  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent("/appointments")}`} />;

  function openReschedule(appt) {
    setError("");
    setMessage("");
    setReschedulingId(appt.id);
    setRescheduleDate("");
    setRescheduleTime("");
  }

  async function cancelAppointment(id) {
    if (!window.confirm("Are you sure you want to cancel this appointment?")) return;
    setError("");
    setMessage("");
    setSavingId(id);
    try {
      await api(`/appointments/${id}/cancel`, { method: "PATCH" });
      setMessage("Appointment cancelled.");
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function submitReschedule(event, id) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!rescheduleDate || !rescheduleTime) {
      setError("Please choose a new date and time.");
      return;
    }
    setSavingId(id);
    try {
      const data = await api(`/appointments/${id}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ date: rescheduleDate, time: rescheduleTime })
      });
      setMessage(data.message || "Your appointment has been rescheduled.");
      setReschedulingId(null);
      setRescheduleDate("");
      setRescheduleTime("");
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setError(err.message);
      setRefreshKey((key) => key + 1);
    } finally {
      setSavingId(null);
    }
  }

  const upcoming = appointments.filter((appt) => appt.date >= today && appt.status === "booked");
  const history = appointments.filter((appt) => appt.date < today || appt.status !== "booked");
  const renderAppointment = (appt) => {
    const manageable = canManageAppointment(appt, today);
    const isRescheduling = reschedulingId === appt.id;
    const tooClose = isTooCloseToEdit(appt, today);
    return (
      <article className="appointment appointment-card" key={appt.id}>
        <div className="appointment-card-header">
          <strong>{formatDateLabel(appt.date)}</strong>
          <span className={`status-pill ${appt.status}`}>Status: {appt.status}</span>
        </div>
        <span><Calendar size={16} /> Time: {formatTime(appt.start_time)}</span>
        <span>Notes: {appt.notes || "None"}</span>
        {tooClose && <p className="edit-warning">This appointment is too close to edit online. Please contact Mohamad.</p>}
        {manageable && (
          <div className="appointment-actions">
            <button className="ghost-button small" type="button" onClick={() => openReschedule(appt)} disabled={savingId === appt.id}>Reschedule</button>
            <button className="ghost-button small" type="button" onClick={() => cancelAppointment(appt.id)} disabled={savingId === appt.id}>Cancel</button>
          </div>
        )}
        {isRescheduling && (
          <form className="reschedule-panel" onSubmit={(event) => submitReschedule(event, appt.id)}>
            <BookingCalendar
              month={calendarMonth}
              today={today}
              availabilityByDate={availabilityByDate}
              loading={availabilityLoading}
              error={availabilityError}
              selectedDate={rescheduleDate}
              onMonthChange={setCalendarMonth}
              onSelectDate={(date) => {
                setRescheduleDate(date);
                setRescheduleTime("");
              }}
            />
            <div className="time-section">
              <strong>New time</strong>
              {rescheduleDate ? (
                <div className="time-slots">
                  {rescheduleTimes.length ? rescheduleTimes.map((time) => (
                    <button className={rescheduleTime === time ? "time-slot selected" : "time-slot"} type="button" key={time} onClick={() => setRescheduleTime(time)} disabled={savingId === appt.id}>{formatTime(time)}</button>
                  )) : <p>No times available for this date.</p>}
                </div>
              ) : <p>Choose a date to see available times.</p>}
            </div>
            <div className="appointment-actions">
              <button className="gold-button small" type="submit" disabled={savingId === appt.id}>{savingId === appt.id ? "Saving..." : "Save New Time"}</button>
              <button className="ghost-button small" type="button" onClick={() => setReschedulingId(null)} disabled={savingId === appt.id}>Close</button>
            </div>
          </form>
        )}
      </article>
    );
  };

  return (
    <section className="page appointments-page">
      <div className="page-title left">
        <h1>My Appointments</h1>
        <p>View, reschedule, or cancel your own appointments.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <h2>Upcoming</h2>
      <div className="list">{upcoming.length ? upcoming.map(renderAppointment) : <p>No upcoming appointments.</p>}</div>
      <h2>Past</h2>
      <div className="list">{history.length ? history.map(renderAppointment) : <p>No past appointments.</p>}</div>
    </section>
  );
}

const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Admin({ user }) {
  const [tab, setTab] = useState("schedule");
  const [appointments, setAppointments] = useState([]);
  const [date, setDate] = useState("");
  const [schedule, setSchedule] = useState([]);
  const [blockedTimes, setBlockedTimes] = useState([]);
  const [block, setBlock] = useState({ date: "", startTime: "10:00", endTime: "10:30", reason: "" });
  const [adminMessage, setAdminMessage] = useState("");
  const [adminError, setAdminError] = useState("");
  const isAdmin = user?.role === "admin";
  const refreshAppointments = () => isAdmin ? api(`/admin/appointments${date ? `?date=${date}` : ""}`).then((data) => setAppointments(data.appointments)) : Promise.resolve();
  const refreshSchedule = () => isAdmin ? api("/admin/schedule").then((data) => {
    setSchedule(data.weeklyAvailability);
    setBlockedTimes(data.blockedTimes);
  }) : Promise.resolve();
  useEffect(() => { refreshAppointments(); }, [date, isAdmin]);
  useEffect(() => { refreshSchedule(); }, [isAdmin]);
  if (!user) return <Navigate to="/signin" />;
  if (user.role !== "admin") return <Navigate to="/book" />;
  function updateSchedule(dayOfWeek, field, value) {
    setSchedule((old) => old.map((day) => day.dayOfWeek === dayOfWeek ? { ...day, [field]: value } : day));
  }
  async function saveSchedule(event) {
    event.preventDefault();
    setAdminError("");
    setAdminMessage("");
    try {
      const data = await api("/admin/schedule/weekly", { method: "PUT", body: JSON.stringify({ days: schedule }) });
      setSchedule(data.weeklyAvailability);
      setAdminMessage("Schedule saved.");
    } catch (err) {
      setAdminError(err.message);
    }
  }
  async function addBlock(event) {
    event.preventDefault();
    setAdminError("");
    setAdminMessage("");
    try {
      await api("/admin/blocked-times", { method: "POST", body: JSON.stringify(block) });
      setBlock({ date: "", startTime: "10:00", endTime: "10:30", reason: "" });
      await refreshSchedule();
      setAdminMessage("Blocked time added.");
    } catch (err) {
      setAdminError(err.message);
    }
  }
  async function deleteBlock(id) {
    await api(`/admin/blocked-times/${id}`, { method: "DELETE" });
    await refreshSchedule();
  }
  async function setAppointmentStatus(id, status) {
    await api(`/admin/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await refreshAppointments();
  }
  return (
    <section className="page admin-page">
      <div className="page-title left">
        <h1><Shield size={24} /> Admin Dashboard</h1>
        <p>Manage Barber Mohamad’s public schedule and bookings.</p>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="Admin pages">
        <button className={tab === "schedule" ? "time-slot selected" : "time-slot"} type="button" onClick={() => setTab("schedule")}>Schedule</button>
        <button className={tab === "appointments" ? "time-slot selected" : "time-slot"} type="button" onClick={() => setTab("appointments")}>Appointments</button>
      </div>
      {adminError && <p className="error">{adminError}</p>}
      {adminMessage && <p className="success">{adminMessage}</p>}
      {tab === "schedule" ? (
        <div className="admin-section">
          <form className="schedule-grid" onSubmit={saveSchedule}>
            {schedule.map((day) => (
              <article className="schedule-day" key={day.dayOfWeek}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={day.isOpen} onChange={(event) => updateSchedule(day.dayOfWeek, "isOpen", event.target.checked)} />
                  <span>{weekdayLabels[day.dayOfWeek]}</span>
                </label>
                <label>Start<input type="time" step="1800" value={day.startTime} onChange={(event) => updateSchedule(day.dayOfWeek, "startTime", event.target.value)} disabled={!day.isOpen} /></label>
                <label>End<input type="time" step="1800" value={day.endTime} onChange={(event) => updateSchedule(day.dayOfWeek, "endTime", event.target.value)} disabled={!day.isOpen} /></label>
              </article>
            ))}
            <button className="gold-button" type="submit">Save Weekly Schedule</button>
          </form>
          <form className="admin-tools block-form" onSubmit={addBlock}>
            <label>Date<input type="date" value={block.date} onChange={(event) => setBlock({ ...block, date: event.target.value })} required /></label>
            <label>Start<input type="time" step="1800" value={block.startTime} onChange={(event) => setBlock({ ...block, startTime: event.target.value })} required /></label>
            <label>End<input type="time" step="1800" value={block.endTime} onChange={(event) => setBlock({ ...block, endTime: event.target.value })} required /></label>
            <label>Reason<input placeholder="Reason" value={block.reason} onChange={(event) => setBlock({ ...block, reason: event.target.value })} /></label>
            <button className="gold-button small">Block Time</button>
          </form>
          <div className="list">
            {blockedTimes.length ? blockedTimes.map((item) => (
              <article className="appointment" key={item.id}>
                <strong>{item.date}</strong>
                <span>{item.startTime} - {item.endTime}</span>
                {item.reason && <small>{item.reason}</small>}
                <button className="ghost-button small" type="button" onClick={() => deleteBlock(item.id)}>Remove</button>
              </article>
            )) : <p>No blocked times.</p>}
          </div>
        </div>
      ) : (
        <div className="admin-section">
          <label>Filter date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="list">
            {appointments.length ? appointments.map((appt) => (
              <article className="appointment" key={appt.id}>
                <strong>{appt.full_name}</strong>
                <span>{appt.phone}</span>
                <span>{appt.date} at {appt.start_time}</span>
                {appt.notes && <small>Notes: {appt.notes}</small>}
                <small>Status: {appt.status}</small>
                <div className="appointment-actions">
                  <button className="ghost-button small" type="button" onClick={() => setAppointmentStatus(appt.id, "cancelled")}>Cancel</button>
                  <button className="ghost-button small" type="button" onClick={() => setAppointmentStatus(appt.id, "completed")}>Completed</button>
                  <button className="ghost-button small" type="button" onClick={() => setAppointmentStatus(appt.id, "no_show")}>No-show</button>
                </div>
              </article>
            )) : <p>No appointments.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function App() {
  const { user, setUser } = useAuth();
  const value = useMemo(() => ({ user, setUser }), [user]);
  if (user === undefined) return <div className="loading">Barber Mohamad</div>;
  return (
    <Router>
      <Layout {...value}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book" element={<Book user={user} />} />
          <Route path="/about" element={<About />} />
          <Route path="/appointments" element={<MyAppointments user={user} />} />
          <Route path="/signin" element={<Auth mode="signin" setUser={setUser} />} />
          <Route path="/signup" element={<Auth mode="signup" setUser={setUser} />} />
          <Route path="/dashboard" element={<Navigate to="/book" />} />
          <Route path="/admin" element={<Admin user={user} />} />
        </Routes>
      </Layout>
    </Router>
  );
}

createRoot(document.getElementById("root")).render(<App />);
