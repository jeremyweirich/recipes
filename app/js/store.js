// Shared state backed by Supabase, with an offline outbox.
// Every change is applied locally first, queued in localStorage, then sent in order.
// A fresh copy from the server always has the still-unsent changes replayed on top.

const SNAPSHOT_KEY = "rb.snapshot";
const OUTBOX_KEY = "rb.outbox";
const TABLES = ["picks", "list_items", "section_overrides"];

const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ }
};

export function createStore(client) {
  let server = load(SNAPSHOT_KEY, { picks: [], list_items: [], section_overrides: [] });
  let outbox = load(OUTBOX_KEY, []);
  let state = replay(server, outbox);
  let status = { online: navigator.onLine, syncing: false, lastError: null };
  let channel = null;
  let flushing = false;
  let refreshTimer = null;
  const listeners = new Set();

  const emit = () => listeners.forEach((fn) => fn(state, { ...status, pending: outbox.length }));

  function setServer(next) {
    server = next;
    save(SNAPSHOT_KEY, server);
    state = replay(server, outbox);
    emit();
  }

  async function refresh() {
    let results;
    try {
      results = await Promise.all(TABLES.map((t) => client.from(t).select("*")));
    } catch (e) {
      results = [{ error: e }];
    }
    const failed = results.find((r) => r.error);
    if (failed) {
      status.online = false;
      status.lastError = failed.error.message;
      emit();
      return false;
    }
    status.online = true;
    status.lastError = null;
    setServer(Object.fromEntries(TABLES.map((t, i) => [t, results[i].data ?? []])));
    return true;
  }

  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (!flushing) refresh(); }, 250);
  }

  function enqueue(op) {
    outbox.push(op);
    save(OUTBOX_KEY, outbox);
    state = applyOp(state, op);
    emit();
    flush();
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    status.syncing = true;
    emit();
    let changed = false;
    try {
      while (outbox.length) {
        const op = outbox[0];
        let res;
        try { res = await send(client, op); } catch (e) { res = { error: e, status: 0 }; }
        const { error, status: http } = res;
        if (error) {
          // 4xx other than auth: the change can never succeed (e.g. both of you picked
          // the same recipe offline). Drop it; the refresh below shows the real state.
          if (http >= 400 && http < 500 && http !== 401) {
            console.warn("Dropped change", op, error);
          } else {
            status.online = false;
            status.lastError = error.message;
            break;
          }
        } else {
          status.online = true;
        }
        outbox.shift();
        save(OUTBOX_KEY, outbox);
        changed = true;
      }
    } finally {
      flushing = false;
      status.syncing = false;
      emit();
    }
    if (changed && outbox.length === 0) await refresh();
  }

  function connect() {
    channel = client.channel("household");
    for (const table of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refreshSoon);
    }
    channel.subscribe();
    window.addEventListener("online", () => { status.online = true; flush().then(refresh); });
    window.addEventListener("offline", () => { status.online = false; emit(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") flush().then(refresh);
    });
    flush().then(refresh);
  }

  function disconnect() {
    if (channel) client.removeChannel(channel);
    channel = null;
  }

  return {
    get state() { return state; },
    subscribe(fn) { listeners.add(fn); fn(state, { ...status, pending: outbox.length }); return () => listeners.delete(fn); },
    connect,
    disconnect,
    refresh,
    upsert: (table, rows) => enqueue({ kind: "upsert", table, rows }),
    update: (table, ids, patch) => enqueue({ kind: "update", table, ids, patch }),
    remove: (table, ids) => enqueue({ kind: "delete", table, ids }),
    clearLocal() { localStorage.removeItem(SNAPSHOT_KEY); localStorage.removeItem(OUTBOX_KEY); },
  };
}

function send(client, op) {
  const t = client.from(op.table);
  if (op.kind === "upsert") return t.upsert(op.rows, { onConflict: op.table === "section_overrides" ? "item" : "id" });
  if (op.kind === "update") return t.update(op.patch).in("id", op.ids);
  if (op.kind === "delete") return t.delete().in("id", op.ids);
  return Promise.resolve({ error: null });
}

function replay(base, ops) {
  return ops.reduce(applyOp, structuredClone(base));
}

function applyOp(state, op) {
  const next = { ...state };
  const rows = [...(state[op.table] ?? [])];
  const key = op.table === "section_overrides" ? "item" : "id";
  if (op.kind === "upsert") {
    for (const r of op.rows) {
      const i = rows.findIndex((x) => x[key] === r[key]);
      if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push(r);
    }
    next[op.table] = rows;
  } else if (op.kind === "update") {
    const ids = new Set(op.ids);
    next[op.table] = rows.map((r) => (ids.has(r.id) ? { ...r, ...op.patch } : r));
  } else if (op.kind === "delete") {
    const ids = new Set(op.ids);
    next[op.table] = rows.filter((r) => !ids.has(r.id));
    if (op.table === "picks") next.list_items = state.list_items.filter((r) => !ids.has(r.pick_id));
  }
  return next;
}
