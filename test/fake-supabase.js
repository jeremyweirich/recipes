// In-browser stand-in for the parts of supabase-js the app uses. Loaded only by test/e2e.mjs.
(() => {
  const db = { picks: [], list_items: [], section_overrides: [] };
  const handlers = [];
  let offline = false;
  const now = () => new Date().toISOString();
  const res = (data = null, status = 200) => Promise.resolve({ data, error: null, status });
  const fail = (message, status, code = "") => Promise.resolve({ data: null, error: { message, code }, status });
  const net = () => fail("TypeError: Failed to fetch", 0);
  const notify = (table) => setTimeout(() => handlers.filter((h) => h.table === table).forEach((h) => h.cb({ table })), 10);

  function from(table) {
    return {
      select: () => (offline ? net() : res(structuredClone(db[table]))),
      upsert(rows, { onConflict = "id" } = {}) {
        if (offline) return net();
        for (const r of rows) {
          if (table === "picks" && db.picks.some((p) => p.recipe_slug === r.recipe_slug && p.id !== r.id)) return fail("duplicate key", 409, "23505");
          if (table === "list_items" && r.pick_id && !db.picks.some((p) => p.id === r.pick_id)) return fail("foreign key", 409, "23503");
        }
        for (const r of rows) {
          const i = db[table].findIndex((x) => x[onConflict] === r[onConflict]);
          if (i >= 0) db[table][i] = { ...db[table][i], ...r, updated_at: now() };
          else db[table].push({ created_at: now(), updated_at: now(), ...r });
        }
        notify(table);
        return res(null, 201);
      },
      update(patch) {
        return {
          in(col, ids) {
            if (offline) return net();
            for (const r of db[table]) if (ids.includes(r[col])) Object.assign(r, patch, { updated_at: now() });
            notify(table);
            return res(null, 204);
          },
        };
      },
      delete() {
        return {
          in(col, ids) {
            if (offline) return net();
            db[table] = db[table].filter((r) => !ids.includes(r[col]));
            if (table === "picks") { db.list_items = db.list_items.filter((r) => !ids.includes(r.pick_id)); notify("list_items"); }
            notify(table);
            return res(null, 204);
          },
        };
      },
    };
  }

  let session = JSON.parse(localStorage.getItem("fake.session") || "null");
  const authListeners = [];
  const auth = {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: (cb) => { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      if (password !== "pw") return { data: {}, error: { message: "Invalid login credentials" } };
      session = { user: { email } };
      localStorage.setItem("fake.session", JSON.stringify(session));
      return { data: { session }, error: null };
    },
    async signOut() { session = null; localStorage.removeItem("fake.session"); authListeners.forEach((cb) => cb("SIGNED_OUT", null)); return { error: null }; },
  };

  window.__fake = {
    get db() { return db; },
    setOffline(v) { offline = v; },
    otherPhone(table, row) { db[table].push({ created_at: now(), updated_at: now(), ...row }); notify(table); },
  };
  window.__FAKE_SUPABASE__ = {
    from,
    auth,
    rpc: async (fn) => (fn === "is_member" ? { data: session?.user.email !== "stranger@example.com", error: null } : { data: null, error: { message: "no fn" } }),
    channel() {
      return {
        on(_evt, filter, cb) { handlers.push({ table: filter.table, cb }); return this; },
        subscribe() { return this; },
      };
    },
    removeChannel() {},
  };
})();
