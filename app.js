"use strict";

(() => {
  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const clock = (m) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
  const timeHtml = (m) => clock(m) + (m >= 1440 ? '<sup class="nextday" title="Next day">+1</sup>' : "");
  const dur = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`);
  const rs = (n) => "Rs. " + n.toLocaleString("en-US");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => isoOf(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00"); d.setDate(d.getDate() + n); return isoOf(d); };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const prettyDate = (iso) => new Date(iso + "T00:00").toLocaleDateString("en-GB",
    { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  // Deterministic pseudo-random numbers so a given bus shows the same occupied seats every time.
  const hashStr = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const mulberry32 = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
  }

  // Animate every [data-count] element in `root` from data-from to data-count (rupee amounts).
  function animateCounts(root) {
    for (const el of $$("[data-count]", root)) {
      const to = Number(el.dataset.count);
      const from = Number(el.dataset.from || 0);
      if (reduceMotion || from === to) { el.textContent = rs(to); continue; }
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / 650);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = rs(Math.round(from + (to - from) * eased));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  // ---------- Data model ----------
  const ROUTE_BY_ID = Object.fromEntries(ROUTES.map((r) => [r.id, r]));
  const CLASS_KEYS = Object.keys(SERVICE_CLASSES);

  function dirStops(route, dir) {
    const total = route.stops[route.stops.length - 1][1];
    const list = route.stops.map(([name, km]) => ({ name, km }));
    return dir === "out" ? list : list.reverse().map((s) => ({ name: s.name, km: total - s.km }));
  }
  const dirLabel = (route, dir) => {
    const s = dirStops(route, dir);
    return `${s[0].name} → ${s[s.length - 1].name}`;
  };

  function departuresFor(svc, dir) {
    const p = dir === "in" && svc.inbound ? svc.inbound : svc;
    if (p.times) return p.times.map(toMin);
    const out = [];
    for (let t = toMin(p.first); t <= toMin(p.last); t += p.every) out.push(t);
    return out;
  }

  const TRIPS = [];
  for (const route of ROUTES) {
    for (const dir of ["out", "in"]) {
      const stops = dirStops(route, dir);
      const total = stops[stops.length - 1].km;
      for (const [cls, svc] of Object.entries(route.services)) {
        for (const dep of departuresFor(svc, dir)) {
          TRIPS.push({
            key: `${route.id}|${dir}|${cls}|${dep}`,
            route, dir, cls, dep, stops,
            times: stops.map((s) => dep + Math.round((svc.duration * s.km) / total)),
          });
        }
      }
    }
  }
  const TRIP_BY_KEY = new Map(TRIPS.map((t) => [t.key, t]));
  const ALL_STOPS = [...new Set(ROUTES.flatMap((r) => r.stops.map((s) => s[0])))].sort();

  function fare(cls, km) {
    const c = SERVICE_CLASSES[cls];
    return Math.ceil(Math.max(c.minFare, km * c.ratePerKm) / 5) * 5;
  }
  const legKm = (trip, i, j) => trip.stops[j].km - trip.stops[i].km;
  const legFare = (trip, i, j) => fare(trip.cls, legKm(trip, i, j));

  const classBadge = (cls) => `<span class="badge cls-${cls}">${SERVICE_CLASSES[cls].label}</span>`;
  const routeBadge = (route) => `<span class="route-no">${esc(route.id)}</span>`;
  const routeOptions = (selected) => ROUTES.map((r) =>
    `<option value="${r.id}" ${r.id === selected ? "selected" : ""}>${esc(r.id)} · ${esc(r.name)}</option>`).join("");
  const stopOptions = (names, selected) => names.map((n) =>
    `<option ${n === selected ? "selected" : ""}>${esc(n)}</option>`).join("");

  // ---------- Bookings ----------
  const BOOKINGS_KEY = "gamana.bookings.v1";
  let bookings = store.get(BOOKINGS_KEY, []);

  function saveBookings() {
    store.set(BOOKINGS_KEY, bookings);
    updateBookingCount();
  }
  function updateBookingCount() {
    const n = bookings.filter((b) => b.status === "confirmed" && !isPastBooking(b)).length;
    const el = $("#bookingCount");
    el.textContent = n;
    el.hidden = n === 0;
  }
  const isPastBooking = (b) => b.date < todayISO() || (b.date === todayISO() && b.depTime < nowMin());

  function takenSeats(tripKey, date) {
    const rand = mulberry32(hashStr(`${tripKey}@${date}`));
    const ratio = 0.15 + rand() * 0.5;
    const taken = new Set();
    for (let n = 1; n <= SEATS_PER_BUS; n++) if (rand() < ratio) taken.add(n);
    for (const b of bookings) {
      if (b.tripKey === tripKey && b.date === date && b.status === "confirmed") b.seats.forEach((s) => taken.add(s));
    }
    return taken;
  }
  const seatsLeft = (tripKey, date) => SEATS_PER_BUS - takenSeats(tripKey, date).size;

  function newRef() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let ref;
    do {
      ref = "GM-" + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    } while (bookings.some((b) => b.ref === ref));
    return ref;
  }

  // ---------- UI state ----------
  const roundedNow = () => clock(Math.floor(nowMin() / 15) * 15);
  const ui = {
    tt: { from: "Colombo (Pettah)", to: "Kandy", cls: "all", date: todayISO(), open: null },
    fa: { routeId: "01", from: "Colombo (Pettah)", to: "Kandy" },
    pl: { from: "Colombo (Pettah)", to: "Nuwara Eliya", date: todayISO(), time: roundedNow(),
          classes: [...CLASS_KEYS], sort: "arrival", results: null },
    bk: null,
    lastBookingRef: null,
  };

  // Open the booking form pre-filled for a trip.
  function startBooking(tripKey, date, fromIdx, toIdx) {
    const t = TRIP_BY_KEY.get(tripKey);
    ui.bk = {
      routeId: t.route.id, dir: t.dir, cls: t.cls, dep: t.dep, date,
      from: fromIdx ?? 0, to: toIdx ?? t.stops.length - 1, seats: [],
      name: "", phone: "", email: "",
    };
    ui.lastBookingRef = null;
    location.hash = "#book";
  }

  // ---------- Timetable view ----------
  function routeStrip(stops) {
    return `<ol class="strip" aria-label="Stops">${stops.map((s, i) =>
      `<li class="${i === 0 || i === stops.length - 1 ? "end" : ""}"><span class="dot"></span>
        <span class="stop-name">${esc(s.name)}</span><span class="km">${s.km} km</span></li>`).join("")}</ol>`;
  }

  // Every stop you can reach from `from` without changing buses.
  const directStops = (from) => new Set(ROUTES
    .filter((r) => r.stops.some((x) => x[0] === from))
    .flatMap((r) => r.stops.map((x) => x[0]))
    .filter((n) => n !== from));
  const stopIndex = (t, name) => t.stops.findIndex((x) => x.name === name);

  // Jump to the trip planner with a search already run.
  function openPlanner(from, to, date) {
    const p = ui.pl;
    Object.assign(p, { from, to, date, time: date === todayISO() ? roundedNow() : "00:00", classes: [...CLASS_KEYS] });
    let after = toMin(p.time);
    if (date === todayISO()) after = Math.max(after, nowMin());
    p.results = planJourneys(from, to, after, p.classes);
    location.hash = "#planner";
  }

  function renderTimetable(el) {
    const s = ui.tt;
    if (!ALL_STOPS.includes(s.from)) s.from = "Colombo (Pettah)";
    const direct = directStops(s.from);
    if (!ALL_STOPS.includes(s.to) || s.to === s.from) s.to = [...direct].sort()[0];
    const isToday = s.date === todayISO();
    const now = nowMin();

    const matches = TRIPS
      .map((t) => ({ t, i: stopIndex(t, s.from), j: stopIndex(t, s.to) }))
      .filter((m) => m.i >= 0 && m.j > m.i);
    const classes = CLASS_KEYS.filter((c) => matches.some((m) => m.t.cls === c));
    if (s.cls !== "all" && !classes.includes(s.cls)) s.cls = "all";
    const list = matches
      .filter((m) => s.cls === "all" || m.t.cls === s.cls)
      .sort((a, b) => a.t.times[a.i] - b.t.times[b.i]);
    const nextIdx = isToday ? list.findIndex((m) => m.t.times[m.i] >= now) : -1;
    const next = list[nextIdx];

    // One strip per route that serves this pair, showing only the stops on the way.
    const segments = [];
    for (const m of matches) {
      if (segments.some((x) => x.route === m.t.route)) continue;
      const base = m.t.stops[m.i].km;
      segments.push({ route: m.t.route, stops: m.t.stops.slice(m.i, m.j + 1).map((x) => ({ name: x.name, km: x.km - base })) });
    }

    const rows = list.map(({ t, i, j }, idx) => {
      const dep = t.times[i];
      const past = isToday && dep < now;
      const bookable = SERVICE_CLASSES[t.cls].bookable && !past;
      const open = s.open === t.key;
      const seats = bookable ? seatsLeft(t.key, s.date) : null;
      return `<tr class="${past ? "past" : ""} ${idx === nextIdx ? "next" : ""}" style="--i:${Math.min(idx, 24)}">
          <td><strong>${timeHtml(dep)}</strong>${idx === nextIdx ? ' <span class="badge next-badge">Next bus</span>' : ""}</td>
          <td>${timeHtml(t.times[j])}</td>
          <td><span class="svc">${routeBadge(t.route)} ${classBadge(t.cls)}</span></td>
          <td class="hide-sm">${dur(t.times[j] - dep)}</td>
          <td>${rs(legFare(t, i, j))}</td>
          <td class="hide-sm">${seats === null ? '<span class="muted">—</span>' : `${seats} left`}</td>
          <td class="actions"><div>
            <button class="btn ghost sm" data-toggle="${t.key}" aria-expanded="${open}">${open ? "Hide" : "Stops"}</button>
            ${bookable ? `<button class="btn sm" data-book="${t.key}" data-i="${i}" data-j="${j}">Book</button>` : ""}
          </div></td>
        </tr>
        ${open ? `<tr class="stops-row"><td colspan="7"><ol class="stop-times">${t.stops.slice(i, j + 1).map((st, k) =>
          `<li><span>${timeHtml(t.times[i + k])}</span> ${esc(st.name)}</li>`).join("")}</ol></td></tr>` : ""}`;
    }).join("");

    const others = ALL_STOPS.filter((n) => n !== s.from && !direct.has(n));
    el.innerHTML = `
      <div class="page-head">
        <h1>Where are you travelling?</h1>
        <p>Choose your starting point and destination to see every direct bus, its fare and seats left.</p>
      </div>
      <div class="card controls journey-picker">
        <label class="field grow"><span>From</span><select id="ttFrom">${stopOptions(ALL_STOPS, s.from)}</select></label>
        <button type="button" class="btn ghost icon-btn" id="ttSwap" title="Swap" aria-label="Swap from and to">⇅</button>
        <label class="field grow"><span>To</span><select id="ttTo">
          <optgroup label="Direct buses">${stopOptions([...direct].sort(), s.to)}</optgroup>
          ${others.length ? `<optgroup label="With a change">${stopOptions(others, s.to)}</optgroup>` : ""}
        </select></label>
        <label class="field"><span>Date</span><input type="date" id="ttDate" value="${s.date}"></label>
      </div>
      ${!matches.length ? `
        <div class="card empty">
          <p>There's no direct bus from <strong>${esc(s.from)}</strong> to <strong>${esc(s.to)}</strong> — you'll need to change buses.</p>
          <button class="btn" data-plan>Find connections</button>
        </div>` : `
      <div class="chips" role="group" aria-label="Service class">
        ${["all", ...classes].map((c) =>
          `<button type="button" class="chip ${c === s.cls ? "on" : ""}" data-cls="${c}">${c === "all" ? "All services" : SERVICE_CLASSES[c].label}</button>`).join("")}
      </div>
      ${next ? `<div class="callout">Next bus from <strong>${esc(s.from)}</strong> at <strong>${clock(next.t.times[next.i])}</strong>
        (route ${esc(next.t.route.id)}, ${SERVICE_CLASSES[next.t.cls].label}) — in ${dur(next.t.times[next.i] - now)}.</div>` : ""}
      <div class="card">
        <h2 class="card-title">Stops on the way</h2>
        ${segments.map((g) => `<div class="segment">
          ${segments.length > 1 ? `<div class="segment-head">${routeBadge(g.route)} ${esc(g.route.name)}</div>` : ""}
          ${routeStrip(g.stops)}</div>`).join("")}
      </div>
      <div class="card flush">
        <div class="table-scroll">
          <table class="tt">
            <thead><tr><th>Departs</th><th>Arrives</th><th>Bus</th><th class="hide-sm">Duration</th>
              <th>Fare</th><th class="hide-sm">Seats</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty">No services.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`}`;

    $("#ttFrom", el).onchange = (e) => { s.from = e.target.value; s.open = null; render(true); };
    $("#ttTo", el).onchange = (e) => { s.to = e.target.value; s.open = null; render(true); };
    $("#ttSwap", el).onclick = () => { [s.from, s.to] = [s.to, s.from]; s.open = null; render(true); };
    $("#ttDate", el).onchange = (e) => { s.date = e.target.value || todayISO(); render(true); };
    el.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const date = s.date < todayISO() ? todayISO() : s.date;
      if (b.dataset.cls) { s.cls = b.dataset.cls; render(true); }
      else if (b.dataset.toggle) { s.open = s.open === b.dataset.toggle ? null : b.dataset.toggle; render(); }
      else if (b.dataset.book) startBooking(b.dataset.book, date, Number(b.dataset.i), Number(b.dataset.j));
      else if ("plan" in b.dataset) openPlanner(s.from, s.to, date);
    };
  }

  // ---------- Fares view ----------
  function renderFares(el) {
    const s = ui.fa;
    const r = ROUTE_BY_ID[s.routeId];
    const names = r.stops.map((x) => x[0]);
    if (!names.includes(s.from)) s.from = names[0];
    if (!names.includes(s.to) || s.to === s.from) {
      s.to = s.from === names[names.length - 1] ? names[0] : names[names.length - 1];
    }
    const kmOf = (n) => r.stops[names.indexOf(n)][1];
    const km = Math.abs(kmOf(s.to) - kmOf(s.from));
    const classes = Object.keys(r.services);

    el.innerHTML = `
      <div class="page-head">
        <h1>Bus fares</h1>
        <p>Work out the fare between any two stops on a route.</p>
      </div>
      <div class="card controls">
        <label class="field grow"><span>Route</span><select id="faRoute">${routeOptions(s.routeId)}</select></label>
        <label class="field grow"><span>From</span><select id="faFrom">${stopOptions(names, s.from)}</select></label>
        <button type="button" class="btn ghost icon-btn" id="faSwap" title="Swap stops" aria-label="Swap stops">⇅</button>
        <label class="field grow"><span>To</span><select id="faTo">${stopOptions(names, s.to)}</select></label>
      </div>
      <div class="fare-cards">
        ${classes.map((c) => `<div class="card fare-card">
            ${classBadge(c)}
            <div class="fare-amount" data-count="${fare(c, km)}" data-from="${s.last?.[c] ?? 0}">${rs(s.last?.[c] ?? 0)}</div>
            <div class="muted">${esc(s.from)} → ${esc(s.to)} · ${km} km</div>
          </div>`).join("")}
      </div>
      <div class="card flush">
        <h2 class="card-title pad">Fares from ${esc(s.from)}</h2>
        <div class="table-scroll">
          <table class="tt">
            <thead><tr><th>To</th><th>Distance</th>${classes.map((c) => `<th>${SERVICE_CLASSES[c].label}</th>`).join("")}</tr></thead>
            <tbody>${names.filter((n) => n !== s.from).map((n) => {
              const d = Math.abs(kmOf(n) - kmOf(s.from));
              return `<tr class="${n === s.to ? "hl" : ""}"><td>${esc(n)}</td><td>${d} km</td>${classes.map((c) => `<td>${rs(fare(c, d))}</td>`).join("")}</tr>`;
            }).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2 class="card-title">How fares are worked out</h2>
        <p class="muted">Fare = distance × rate per km, with a minimum fare, rounded up to the next Rs. 5.</p>
        <div class="table-scroll">
          <table class="tt compact">
            <thead><tr><th>Service</th><th>Rate per km</th><th>Minimum fare</th><th>Seat booking</th></tr></thead>
            <tbody>${CLASS_KEYS.map((c) => { const x = SERVICE_CLASSES[c]; return `<tr><td>${classBadge(c)}</td>
              <td>Rs. ${x.ratePerKm.toFixed(2)}</td><td>${rs(x.minFare)}</td><td>${x.bookable ? "Available" : "Pay on board"}</td></tr>`; }).join("")}</tbody>
          </table>
        </div>
      </div>`;

    $("#faRoute", el).onchange = (e) => { s.routeId = e.target.value; s.from = ""; s.to = ""; render(); };
    $("#faFrom", el).onchange = (e) => { s.from = e.target.value; render(); };
    $("#faTo", el).onchange = (e) => { s.to = e.target.value; render(); };
    $("#faSwap", el).onclick = () => { [s.from, s.to] = [s.to, s.from]; render(); };
    el.onclick = null;
    animateCounts(el);
    s.last = Object.fromEntries(classes.map((c) => [c, fare(c, km)]));
  }

  // ---------- Trip planner ----------
  function planJourneys(from, to, after, classes) {
    if (from === to) return [];
    const pool = TRIPS.filter((t) => classes.includes(t.cls));
    const pos = (t, name) => t.stops.findIndex((x) => x.name === name);

    // Every way to reach `to`, indexed by the stop you would board at.
    const finalLegs = new Map();
    for (const t of pool) {
      const j = pos(t, to);
      for (let x = 0; x < j; x++) {
        const name = t.stops[x].name;
        if (!finalLegs.has(name)) finalLegs.set(name, []);
        finalLegs.get(name).push({ trip: t, i: x, j });
      }
    }
    finalLegs.forEach((list) => list.sort((a, b) => a.trip.times[a.i] - b.trip.times[b.i]));

    const options = [];
    for (const t of pool) {
      const i = pos(t, from);
      if (i < 0 || i === t.stops.length - 1 || t.times[i] < after) continue;
      const j = pos(t, to);
      if (j > i) { options.push([{ trip: t, i, j }]); continue; }
      for (let x = i + 1; x < t.stops.length; x++) {
        const list = finalLegs.get(t.stops[x].name);
        if (!list) continue;
        const ready = t.times[x] + TRANSFER_MINUTES;
        const seenCls = new Set();
        for (const c of list) {
          if (c.trip.times[c.i] < ready || c.trip.route === t.route || seenCls.has(c.trip.cls)) continue;
          seenCls.add(c.trip.cls);
          options.push([{ trip: t, i, j: x }, c]);
        }
      }
    }

    // For each onward bus keep only the connection that leaves latest (least waiting).
    const best = new Map();
    for (const legs of options) {
      const lastLeg = legs[legs.length - 1];
      const key = legs.length === 1 ? legs[0].trip.key : `${lastLeg.trip.key}@${lastLeg.i}`;
      const dep = legs[0].trip.times[legs[0].i];
      const prev = best.get(key);
      if (!prev || dep > prev.dep) best.set(key, summarize(legs));
    }
    const all = [...best.values()];
    if (!all.length) return [];
    const firstDep = Math.min(...all.map((o) => o.dep));
    return all.filter((o) => o.dep <= firstDep + 240);
  }

  function summarize(legs) {
    const dep = legs[0].trip.times[legs[0].i];
    const lastLeg = legs[legs.length - 1];
    const arr = lastLeg.trip.times[lastLeg.j];
    return { legs, dep, arr, duration: arr - dep, fare: legs.reduce((sum, l) => sum + legFare(l.trip, l.i, l.j), 0) };
  }

  const SORTS = {
    arrival: { label: "Earliest arrival", fn: (a, b) => a.arr - b.arr || b.dep - a.dep },
    fare: { label: "Cheapest", fn: (a, b) => a.fare - b.fare || a.arr - b.arr },
    changes: { label: "Fewest changes", fn: (a, b) => a.legs.length - b.legs.length || a.arr - b.arr },
    duration: { label: "Shortest trip", fn: (a, b) => a.duration - b.duration || a.arr - b.arr },
  };

  function renderPlanner(el) {
    const s = ui.pl;
    const results = s.results ? [...s.results].sort(SORTS[s.sort].fn).slice(0, 8) : null;

    const legHtml = (l, k, legs) => {
      const t = l.trip;
      const canBook = SERVICE_CLASSES[t.cls].bookable;
      const prev = legs[k - 1];
      const wait = prev ? t.times[l.i] - prev.trip.times[prev.j] : 0;
      return `${prev ? `<li class="transfer">Change at <strong>${esc(t.stops[l.i].name)}</strong> · ${dur(wait)} wait</li>` : ""}
        <li class="leg">
          <div class="leg-head">${routeBadge(t.route)} ${esc(t.route.name)} ${classBadge(t.cls)}</div>
          <div class="leg-times">
            <div><strong>${timeHtml(t.times[l.i])}</strong> ${esc(t.stops[l.i].name)}</div>
            <div><strong>${timeHtml(t.times[l.j])}</strong> ${esc(t.stops[l.j].name)}</div>
          </div>
          <div class="leg-foot">
            <span class="muted">${legKm(t, l.i, l.j)} km · ${dur(t.times[l.j] - t.times[l.i])} · ${rs(legFare(t, l.i, l.j))}</span>
            ${canBook ? `<button class="btn sm" data-book="${t.key}" data-i="${l.i}" data-j="${l.j}">Book this bus</button>`
                      : '<span class="muted">Pay on board</span>'}
          </div>
        </li>`;
    };

    el.innerHTML = `
      <div class="page-head">
        <h1>Trip planner</h1>
        <p>Find direct buses and connections between any two stops.</p>
      </div>
      <form class="card controls" id="plForm">
        <label class="field grow"><span>From</span><select id="plFrom">${stopOptions(ALL_STOPS, s.from)}</select></label>
        <button type="button" class="btn ghost icon-btn" id="plSwap" title="Swap" aria-label="Swap from and to">⇅</button>
        <label class="field grow"><span>To</span><select id="plTo">${stopOptions(ALL_STOPS, s.to)}</select></label>
        <label class="field"><span>Date</span><input type="date" id="plDate" value="${s.date}" min="${todayISO()}"></label>
        <label class="field"><span>Leave after</span><input type="time" id="plTime" value="${s.time}"></label>
        <fieldset class="field full"><legend>Services</legend>
          <div class="checks">${CLASS_KEYS.map((c) => `<label class="check"><input type="checkbox" value="${c}" ${s.classes.includes(c) ? "checked" : ""}> ${SERVICE_CLASSES[c].label}</label>`).join("")}</div>
        </fieldset>
        <div class="field full"><button class="btn primary" type="submit">Find buses</button></div>
      </form>
      ${results === null ? "" : `
        <div class="results-head">
          <h2>${results.length ? `${esc(s.from)} → ${esc(s.to)}` : "No journeys found"}</h2>
          ${results.length ? `<label class="field inline"><span>Sort by</span><select id="plSort">${Object.entries(SORTS).map(([k, v]) =>
            `<option value="${k}" ${k === s.sort ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>` : ""}
        </div>
        ${results.length ? "" : `<div class="card empty">No buses leave ${esc(s.from)} after ${s.time} that reach ${esc(s.to)} the same day.
          Try an earlier time or include more service types.</div>`}
        <div class="options">${results.map((o, i) => `
          <article class="card option" style="--i:${i}">
            <header class="opt-head">
              <div class="opt-times">${timeHtml(o.dep)} <span class="arrow">→</span> ${timeHtml(o.arr)}</div>
              <div class="opt-meta">
                <span>${dur(o.duration)}</span>
                <span>${o.legs.length === 1 ? "Direct" : `${o.legs.length - 1} change`}</span>
                <span class="opt-fare">${rs(o.fare)}</span>
              </div>
            </header>
            <ol class="legs">${o.legs.map(legHtml).join("")}</ol>
          </article>`).join("")}
        </div>`}`;

    $("#plSwap", el).onclick = () => { [s.from, s.to] = [s.to, s.from]; s.results = null; render(); };
    $("#plForm", el).onsubmit = (e) => {
      e.preventDefault();
      s.from = $("#plFrom", el).value;
      s.to = $("#plTo", el).value;
      s.date = $("#plDate", el).value || todayISO();
      s.time = $("#plTime", el).value || "00:00";
      s.classes = $$(".checks input:checked", el).map((x) => x.value);
      if (s.from === s.to) { toast("Choose two different stops."); return; }
      if (!s.classes.length) { toast("Pick at least one service type."); return; }
      let after = toMin(s.time);
      if (s.date === todayISO()) after = Math.max(after, nowMin());
      s.results = planJourneys(s.from, s.to, after, s.classes);
      render();
    };
    const sortSel = $("#plSort", el);
    if (sortSel) sortSel.onchange = (e) => { s.sort = e.target.value; render(); };
    el.onclick = (e) => {
      const b = e.target.closest("button[data-book]");
      if (b) startBooking(b.dataset.book, s.date, Number(b.dataset.i), Number(b.dataset.j));
    };
  }

  // ---------- Booking view ----------
  function defaultBooking() {
    const r = ROUTES.find((x) => Object.keys(x.services).some((c) => SERVICE_CLASSES[c].bookable));
    return { routeId: r.id, dir: "out", cls: null, dep: null, date: todayISO(), from: 0, to: null,
             seats: [], name: "", phone: "", email: "" };
  }

  function seatMap(taken, chosen, picked, fresh) {
    const seat = (n) => {
      const isTaken = taken.has(n);
      const isMine = chosen.includes(n);
      return `<button type="button" class="seat ${isTaken ? "taken" : ""} ${isMine ? "mine" : ""} ${n === picked ? "just-picked" : ""}" data-seat="${n}"
        ${isTaken ? "disabled" : ""} aria-pressed="${isMine}" aria-label="Seat ${n}${isTaken ? " (taken)" : ""}">${n}</button>`;
    };
    let html = `<div class="bus ${fresh ? "fresh" : ""}"><div class="driver" aria-hidden="true">Driver ⎈</div><div class="seat-grid">`;
    const rows = (SEATS_PER_BUS - 5) / 4;
    for (let r = 0; r < rows; r++) {
      const n = r * 4 + 1;
      html += seat(n) + seat(n + 1) + '<span class="aisle"></span>' + seat(n + 2) + seat(n + 3);
    }
    html += '</div><div class="seat-grid back-row">';
    for (let n = rows * 4 + 1; n <= SEATS_PER_BUS; n++) html += seat(n);
    return html + "</div></div>";
  }

  function renderBook(el) {
    if (!ui.bk) ui.bk = defaultBooking();
    const s = ui.bk;

    if (ui.lastBookingRef) {
      const b = bookings.find((x) => x.ref === ui.lastBookingRef);
      el.innerHTML = `
        <div class="page-head success">
          <div class="success-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg></div>
          <div><h1>Booking confirmed</h1><p>Show this ticket to the conductor when you board.</p></div>
        </div>
        ${ticketHtml(b)}
        <div class="row-actions">
          <a class="btn primary" href="#bookings">View my bookings</a>
          <button class="btn ghost" id="bkAnother">Book another seat</button>
        </div>`;
      $("#bkAnother", el).onclick = () => { ui.lastBookingRef = null; ui.bk = defaultBooking(); render(); };
      el.onclick = ticketActions;
      return;
    }

    const bookableRoutes = ROUTES.filter((r) => Object.keys(r.services).some((c) => SERVICE_CLASSES[c].bookable));
    let r = ROUTE_BY_ID[s.routeId];
    if (!bookableRoutes.includes(r)) { r = bookableRoutes[0]; s.routeId = r.id; }
    const classes = Object.keys(r.services).filter((c) => SERVICE_CLASSES[c].bookable);
    if (!classes.includes(s.cls)) s.cls = classes[0];
    const stops = dirStops(r, s.dir);
    if (s.to === null || s.to >= stops.length) s.to = stops.length - 1;
    if (s.from >= s.to) s.from = 0;

    const isToday = s.date === todayISO();
    const now = nowMin();
    const trips = TRIPS.filter((t) => t.route === r && t.dir === s.dir && t.cls === s.cls)
      .filter((t) => !isToday || t.times[s.from] > now)
      .sort((a, b) => a.dep - b.dep);
    let trip = trips.find((t) => t.dep === s.dep);
    if (!trip) { trip = trips[0]; s.dep = trip ? trip.dep : null; s.seats = []; }

    const taken = trip ? takenSeats(trip.key, s.date) : new Set();
    s.seats = s.seats.filter((n) => !taken.has(n));
    const perSeat = trip ? legFare(trip, s.from, s.to) : 0;
    const total = perSeat * s.seats.length;
    const tripId = trip ? `${trip.key}@${s.date}` : null;
    const fresh = tripId !== s.shownTrip;
    s.shownTrip = tripId;

    el.innerHTML = `
      <div class="page-head">
        <h1>Book a seat</h1>
        <p>Reserve seats on Semi-Luxury, A/C and Expressway buses. Normal buses don't take reservations — pay on board.</p>
      </div>
      <div class="book-layout">
        <div class="book-main">
          <div class="card controls">
            <label class="field grow"><span>Route</span><select id="bkRoute">${bookableRoutes.map((x) =>
              `<option value="${x.id}" ${x === r ? "selected" : ""}>${esc(x.id)} · ${esc(x.name)}</option>`).join("")}</select></label>
            <div class="field grow"><span>Direction</span>
              <div class="seg">${["out", "in"].map((d) =>
                `<button type="button" data-dir="${d}" class="${d === s.dir ? "on" : ""}">${esc(dirLabel(r, d))}</button>`).join("")}</div>
            </div>
            <label class="field"><span>Date</span><input type="date" id="bkDate" value="${s.date}" min="${todayISO()}" max="${addDays(todayISO(), BOOKING_DAYS_AHEAD)}"></label>
            <label class="field"><span>Service</span><select id="bkClass">${classes.map((c) =>
              `<option value="${c}" ${c === s.cls ? "selected" : ""}>${SERVICE_CLASSES[c].label}</option>`).join("")}</select></label>
            <label class="field grow"><span>Boarding at</span><select id="bkFrom">${stops.slice(0, -1).map((x, i) =>
              `<option value="${i}" ${i === s.from ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
            <label class="field grow"><span>Getting off at</span><select id="bkTo">${stops.map((x, i) => i <= s.from ? "" :
              `<option value="${i}" ${i === s.to ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
            <label class="field full"><span>Departure</span>
              ${trips.length ? `<select id="bkDep">${trips.map((t) =>
                `<option value="${t.dep}" ${t === trip ? "selected" : ""}>Leaves ${esc(t.stops[s.from].name)} ${clock(t.times[s.from])} → arrives ${clock(t.times[s.to])}${t.times[s.to] >= 1440 ? " (+1)" : ""} · ${seatsLeft(t.key, s.date)} seats left</option>`).join("")}</select>`
                : '<div class="empty-inline">No more departures on this date. Pick another day.</div>'}
            </label>
          </div>
          ${trip ? `<div class="card">
            <h2 class="card-title">Choose seats <span class="muted">(up to ${MAX_SEATS_PER_BOOKING})</span></h2>
            <div class="legend">
              <span><i class="seat-key"></i> Available</span>
              <span><i class="seat-key mine"></i> Your pick</span>
              <span><i class="seat-key taken"></i> Taken</span>
            </div>
            ${seatMap(taken, s.seats, s.lastSeat, fresh)}
          </div>` : ""}
        </div>
        <aside class="book-side">
          <form class="card" id="bkForm" novalidate>
            <h2 class="card-title">Passenger details</h2>
            <label class="field"><span>Full name</span><input id="bkName" autocomplete="name" value="${esc(s.name)}" required></label>
            <label class="field"><span>Mobile number</span><input id="bkPhone" type="tel" autocomplete="tel" placeholder="07X XXX XXXX" value="${esc(s.phone)}" required></label>
            <label class="field"><span>Email <span class="muted">(optional)</span></span><input id="bkEmail" type="email" autocomplete="email" value="${esc(s.email)}"></label>
            <div class="summary">
              ${trip ? `
                <div class="sum-row"><span>Bus</span><span>${esc(r.id)} · ${SERVICE_CLASSES[s.cls].label}</span></div>
                <div class="sum-row"><span>Date</span><span>${prettyDate(s.date)}</span></div>
                <div class="sum-row"><span>Journey</span><span>${esc(stops[s.from].name)} ${clock(trip.times[s.from])} → ${esc(stops[s.to].name)} ${timeHtml(trip.times[s.to])}</span></div>
                <div class="sum-row"><span>Seats</span><span>${s.seats.length ? [...s.seats].sort((a, b) => a - b).join(", ") : "None selected"}</span></div>
                <div class="sum-row"><span>Fare per seat</span><span>${rs(perSeat)}</span></div>
                <div class="sum-row total"><span>Total</span><span data-count="${total}" data-from="${s.lastTotal ?? 0}">${rs(s.lastTotal ?? 0)}</span></div>`
                : '<p class="muted">Pick a departure to see the price.</p>'}
            </div>
            <button class="btn primary block" type="submit" ${trip && s.seats.length ? "" : "disabled"}>Confirm booking</button>
            <p class="fine">Demo only: no payment is taken. Pay the conductor when you board.</p>
          </form>
        </aside>
      </div>`;

    animateCounts(el);
    s.lastTotal = total;
    s.lastSeat = null;

    const keepForm = () => {
      s.name = $("#bkName", el).value;
      s.phone = $("#bkPhone", el).value;
      s.email = $("#bkEmail", el).value;
    };
    const change = (fn) => (e) => { keepForm(); fn(e.target.value); render(); };
    $("#bkRoute", el).onchange = change((v) => { s.routeId = v; s.from = 0; s.to = null; s.dep = null; });
    $("#bkDate", el).onchange = change((v) => { s.date = v && v >= todayISO() ? v : todayISO(); });
    $("#bkClass", el).onchange = change((v) => { s.cls = v; s.dep = null; });
    $("#bkFrom", el).onchange = change((v) => { s.from = Number(v); if (s.to <= s.from) s.to = stops.length - 1; });
    $("#bkTo", el).onchange = change((v) => { s.to = Number(v); });
    const depSel = $("#bkDep", el);
    if (depSel) depSel.onchange = change((v) => { s.dep = Number(v); s.seats = []; });

    el.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.dir) { keepForm(); s.dir = b.dataset.dir; s.from = 0; s.to = null; s.dep = null; render(); }
      else if (b.dataset.seat) {
        keepForm();
        const n = Number(b.dataset.seat);
        if (s.seats.includes(n)) s.seats = s.seats.filter((x) => x !== n);
        else if (s.seats.length >= MAX_SEATS_PER_BOOKING) { toast(`You can book up to ${MAX_SEATS_PER_BOOKING} seats at once.`); return; }
        else { s.seats.push(n); s.lastSeat = n; }
        render();
      }
    };

    $("#bkForm", el).onsubmit = (e) => {
      e.preventDefault();
      keepForm();
      const name = s.name.trim();
      const phone = s.phone.replace(/[\s-]/g, "");
      const email = s.email.trim();
      if (!trip || !s.seats.length) { toast("Choose at least one seat."); return; }
      if (name.length < 2) { toast("Enter the passenger's name."); $("#bkName", el).focus(); return; }
      if (!/^(?:\+94|0)7\d{8}$/.test(phone)) { toast("Enter a Sri Lankan mobile number, e.g. 0771234567."); $("#bkPhone", el).focus(); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("That email address doesn't look right."); $("#bkEmail", el).focus(); return; }
      const nowTaken = takenSeats(trip.key, s.date);
      if (s.seats.some((n) => nowTaken.has(n))) { toast("One of those seats was just taken. Please pick again."); render(); return; }

      const booking = {
        ref: newRef(), status: "confirmed", createdAt: new Date().toISOString(),
        tripKey: trip.key, routeId: r.id, routeName: r.name, cls: s.cls, date: s.date,
        fromName: stops[s.from].name, toName: stops[s.to].name,
        depTime: trip.times[s.from], arrTime: trip.times[s.to], km: legKm(trip, s.from, s.to),
        seats: [...s.seats].sort((a, b) => a - b), farePerSeat: perSeat, total: perSeat * s.seats.length,
        name, phone, email,
      };
      bookings.push(booking);
      saveBookings();
      ui.lastBookingRef = booking.ref;
      ui.bk = { ...defaultBooking(), name, phone: s.phone, email };
      render(true);
      toast(`Booked! Reference ${booking.ref}`);
    };
  }

  // ---------- My bookings ----------
  function ticketHtml(b, i = 0) {
    const past = isPastBooking(b);
    const status = b.status === "cancelled" ? "Cancelled" : past ? "Completed" : "Confirmed";
    return `<article class="ticket card ${b.status}" data-ref="${b.ref}" style="--i:${i}">
      <header class="ticket-head">
        <div><span class="muted">Booking reference</span><div class="ref">${b.ref}</div></div>
        <span class="status status-${status.toLowerCase()}">${status}</span>
      </header>
      <div class="ticket-route">
        <div><div class="t-time">${timeHtml(b.depTime)}</div><div>${esc(b.fromName)}</div></div>
        <div class="t-line"><span>${dur(b.arrTime - b.depTime)}</span></div>
        <div class="t-right"><div class="t-time">${timeHtml(b.arrTime)}</div><div>${esc(b.toName)}</div></div>
      </div>
      <dl class="ticket-grid">
        <div><dt>Date</dt><dd>${prettyDate(b.date)}</dd></div>
        <div><dt>Bus</dt><dd>${esc(b.routeId)} · ${esc(b.routeName)}</dd></div>
        <div><dt>Service</dt><dd>${SERVICE_CLASSES[b.cls].label}</dd></div>
        <div><dt>Seats</dt><dd>${b.seats.join(", ")}</dd></div>
        <div><dt>Passenger</dt><dd>${esc(b.name)}</dd></div>
        <div><dt>Mobile</dt><dd>${esc(b.phone)}</dd></div>
        <div><dt>Total</dt><dd><strong>${rs(b.total)}</strong> <span class="muted">(${b.seats.length} × ${rs(b.farePerSeat)})</span></dd></div>
      </dl>
      <footer class="ticket-actions">
        <button class="btn ghost sm" data-print="${b.ref}">Print ticket</button>
        ${b.status === "confirmed" && !past ? `<button class="btn danger sm" data-cancel="${b.ref}">Cancel booking</button>` : ""}
      </footer>
    </article>`;
  }

  function ticketActions(e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.print) {
      const card = b.closest(".ticket");
      document.body.classList.add("printing");
      card.classList.add("print-me");
      window.print();
      document.body.classList.remove("printing");
      card.classList.remove("print-me");
    } else if (b.dataset.cancel) {
      const bk = bookings.find((x) => x.ref === b.dataset.cancel);
      if (bk && confirm(`Cancel booking ${bk.ref}? Your seats will be released.`)) {
        bk.status = "cancelled";
        bk.cancelledAt = new Date().toISOString();
        saveBookings();
        render();
        toast(`Booking ${bk.ref} cancelled.`);
      }
    }
  }

  function renderBookings(el) {
    const order = (a, b) => a.date.localeCompare(b.date) || a.depTime - b.depTime;
    const upcoming = bookings.filter((b) => b.status === "confirmed" && !isPastBooking(b)).sort(order);
    const others = bookings.filter((b) => !upcoming.includes(b)).sort((a, b) => order(b, a));
    el.innerHTML = `
      <div class="page-head">
        <h1>My bookings</h1>
        <p>Bookings are saved in this browser.</p>
      </div>
      ${upcoming.length ? `<h2 class="section-title">Upcoming</h2><div class="tickets">${upcoming.map(ticketHtml).join("")}</div>`
        : `<div class="card empty">You have no upcoming trips. <a href="#book">Book a seat</a> or <a href="#planner">plan a journey</a>.</div>`}
      ${others.length ? `<h2 class="section-title">Past and cancelled</h2><div class="tickets">${others.map(ticketHtml).join("")}</div>` : ""}`;
    el.onclick = ticketActions;
  }

  // ---------- Router ----------
  const VIEWS = { timetable: renderTimetable, fares: renderFares, planner: renderPlanner, book: renderBook, bookings: renderBookings };
  let current = null;
  let enterTimer;

  // Replay the staggered entrance animation on a view.
  function playEnter(el) {
    if (reduceMotion) return;
    el.classList.remove("enter");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("enter");
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => el.classList.remove("enter"), 1300);
  }

  function render(animate = false) {
    const el = $(`#view-${current}`);
    const scrollY = window.scrollY;
    VIEWS[current](el);
    window.scrollTo(0, scrollY);
    if (animate) playEnter(el);
  }

  // Slide the pill behind the active tab.
  function moveIndicator() {
    const a = $("#tabs a.active");
    const ind = $("#tabIndicator");
    if (!a || !ind) return;
    ind.style.width = `${a.offsetWidth}px`;
    ind.style.height = `${a.offsetHeight}px`;
    ind.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
  }

  function navigate() {
    const name = location.hash.slice(1);
    const next = VIEWS[name] ? name : "timetable";
    const changed = next !== current;
    current = next;
    const el = $(`#view-${current}`);
    $$(".view").forEach((v) => { v.hidden = v !== el; });
    $$("#tabs a").forEach((a) => {
      const on = a.dataset.view === current;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    VIEWS[current](el);
    moveIndicator();
    if (changed) {
      window.scrollTo({ top: 0, behavior: "instant" });
      playEnter(el);
      const tabs = $("#tabs");
      if (tabs.scrollWidth > tabs.clientWidth) {
        $("#tabs a.active").scrollIntoView({ inline: "center", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
      }
    }
  }

  // Material-style ripple on buttons.
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".btn, .chip, .seg button, .seat");
    if (!b || b.disabled || reduceMotion) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    b.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });

  const topbar = $(".topbar");
  const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", moveIndicator);
  window.addEventListener("hashchange", navigate);

  updateBookingCount();
  navigate();
  onScroll();
  document.fonts?.ready.then(moveIndicator);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(moveIndicator);
    $$("#tabs a").forEach((a) => ro.observe(a));
  }
  requestAnimationFrame(() => $("#tabIndicator").classList.add("ready"));
})();
