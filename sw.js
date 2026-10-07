/* Abdu's Fintracker service worker: offline cache + notifications */
const VERSION = "fintracker-v1";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "fintracker-state").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the page (so updates arrive), cache as the offline fallback.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("./index.html")))
  );
});

/* ---- reading the copy of the data the app keeps for reminders ---- */
async function readState() {
  try {
    const c = await caches.open("fintracker-state");
    const r = await c.match("./__state.json");
    return r ? await r.json() : null;
  } catch (e) { return null; }
}
const gbp = (n) => "£" + (Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FIXED = new Set(["Subscriptions", "Bills", "Debt repayment"]);
function weeklySummary(st) {
  if (!st) return null;
  const now = new Date(); const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ws = new Date(t); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const from = iso(ws), to = iso(t);
  const tx = Object.values(st.months || {}).flat().filter((x) => x.kind === "spend" && x.d >= from && x.d <= to);
  const flex = tx.filter((x) => !FIXED.has(x.cat)).reduce((a, b) => a + b.amt, 0);
  const subs = (st.subs || []).filter((x) => x.active !== false)
    .reduce((a, x) => a + (x.cycle === "weekly" ? x.amount * 52 / 12 : x.cycle === "yearly" ? x.amount / 12 : x.amount), 0);
  const debts = (st.debts || []).filter((x) => x.balance > 0).reduce((a, x) => a + Math.min(x.monthly || 0, x.balance), 0);
  const budget = ((st.income || 0) - (st.bills || 0) - subs - debts - (st.goal || 0)) / (52 / 12);
  let body = `You spent ${gbp(flex)} on day-to-day things this week`;
  if (budget > 0) body += flex > budget ? `, ${gbp(flex - budget)} over your ${gbp(budget)} budget.` : `, ${gbp(budget - flex)} under your ${gbp(budget)} budget. Nice.`;
  else body += ".";
  return body;
}

/* ---- push from the reminder server ----
   Payload: {type:"due"|"weekly"|"payday"|"test", title?, body?}
   iOS requires a visible notification for every push, so one is always shown. */
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let p = {};
    try { p = e.data ? e.data.json() : {}; } catch (err) { p = { body: e.data ? e.data.text() : "" }; }
    let title = p.title || "Abdu's Fintracker";
    let body = p.body || "Open the app to check your money.";
    if (p.type === "weekly") {
      title = "Your week in money";
      body = weeklySummary(await readState()) || body;
    }
    await self.registration.showNotification(title, { body, tag: p.type || "fintracker", icon: "icon-192.png", badge: "icon-192.png" });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow("./");
  })());
});
