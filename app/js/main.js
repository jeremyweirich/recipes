import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";
import { createStore } from "./store.js";
import { buildList, parseEntry, guessSection, itemKey, formatQty } from "./combine.js";
import { renderMarkdown } from "./markdown.js";
import { attachSwipe, fling } from "./deck.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uuid = () => crypto.randomUUID();
const SKIPPED_KEY = "rb.skipped";

if ("serviceWorker" in navigator && !window.__FAKE_SUPABASE__) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

await new Promise((r) => (window.supabase || window.__FAKE_SUPABASE__ ? r() : addEventListener("DOMContentLoaded", r)));
const client = window.__FAKE_SUPABASE__ ?? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const { sections: sectionData, recipes } = await fetch("recipes.json").then((r) => r.json());
const recipeBySlug = Object.fromEntries(recipes.map((r) => [r.slug, r]));
const titles = Object.fromEntries(recipes.map((r) => [r.slug, r.title]));
const sectionName = Object.fromEntries(sectionData.sections.map((s) => [s.id, s.name]));

let store = null;
let state = { picks: [], list_items: [], section_overrides: [] };
let currentList = { sections: [], staples: [] };
let skipped = new Set(JSON.parse(localStorage.getItem(SKIPPED_KEY) || "[]"));
let deckSignature = "";

// ---------- auth ----------

const { data: { session } } = await client.auth.getSession();
client.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") showAuth(); });
if (session) start(session); else showAuth();

function showAuth(message = "") {
  $("app").hidden = true;
  $("auth-view").hidden = false;
  $("auth-error").textContent = message;
}

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  $("auth-error").textContent = "";
  const { data, error } = await client.auth.signInWithPassword({
    email: $("auth-email").value.trim(),
    password: $("auth-password").value,
  });
  btn.disabled = false;
  if (error) {
    $("auth-error").textContent = /invalid/i.test(error.message)
      ? "That email and password don't match. Check them and try again."
      : `Couldn't sign in: ${error.message}`;
    return;
  }
  start(data.session);
});

async function start(session) {
  const { data: isMember, error } = await client.rpc("is_member");
  if (!error && isMember === false) {
    await client.auth.signOut();
    showAuth("This account isn't on the household list yet. Add its email to the members table in Supabase, then sign in again.");
    return;
  }
  $("signed-in").textContent = `Signed in as ${session.user.email}`;
  $("auth-view").hidden = true;
  $("app").hidden = false;
  store = createStore(client);
  store.subscribe(render);
  store.connect();
}

// ---------- rendering ----------

function render(next, status) {
  state = next;
  renderStatus(status);
  renderDeck();
  renderWeek();
  renderList();
}

function renderStatus({ online, pending, syncing }) {
  const el = $("sync");
  if (!online) el.textContent = pending ? `Offline. ${pending} ${pending === 1 ? "change" : "changes"} will sync later` : "Offline";
  else if (syncing || pending) el.textContent = "Saving";
  else el.textContent = "";
  el.dataset.state = online ? "online" : "offline";
}

const pickedSlugs = () => new Set(state.picks.map((p) => p.recipe_slug));
const overrides = () => Object.fromEntries(state.section_overrides.map((o) => [o.item, o.section]));

function candidates() {
  const picked = pickedSlugs();
  return recipes.filter((r) => !picked.has(r.slug) && !skipped.has(r.slug));
}

function formatTime(min) {
  if (!min) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ");
}

function cardHtml(r, top) {
  const time = formatTime(r.time_minutes);
  return `
    <article class="card${top ? " top" : ""}" data-slug="${esc(r.slug)}" ${top ? 'tabindex="0"' : 'aria-hidden="true"'}
      aria-label="${esc(r.title)}. Swipe right or press the right arrow to add to this week; left to skip; Enter to open.">
      ${r.photo ? `<div class="card-photo" style="background-image:url('${esc(r.photo)}')"></div>` : ""}
      <h3 class="card-title">${esc(r.title)}</h3>
      <div class="card-lines">
        ${r.summary ? `<p class="card-summary">${esc(r.summary)}</p>` : ""}
        <p class="card-facts">Serves ${esc(r.servings)}${time ? `, ${esc(time)}` : ""}</p>
        ${r.tags.length ? `<ul class="card-tags">${r.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      </div>
      <span class="stamp stamp-pick" aria-hidden="true">Add</span>
      <span class="stamp stamp-skip" aria-hidden="true">Skip</span>
    </article>`;
}

function renderDeck() {
  const list = candidates();
  const sig = list.slice(0, 2).map((r) => r.slug).join("|") + `#${list.length}`;
  if (sig === deckSignature) return;
  deckSignature = sig;

  const deck = $("deck");
  $("deck-actions").hidden = list.length === 0;
  if (!list.length) {
    const anySkipped = skipped.size > 0;
    deck.innerHTML = `
      <div class="deck-empty">
        <p class="deck-empty-title">${recipes.length ? "You've been through every recipe." : "No recipes yet."}</p>
        <p>${anySkipped ? "Go back through the ones you skipped, or head to the list." : "Add recipe files to the repo and they'll show up here."}</p>
        ${anySkipped ? `<button class="primary" id="reset-skipped">Show skipped recipes</button>` : ""}
      </div>`;
    $("reset-skipped")?.addEventListener("click", () => { setSkipped(new Set()); });
    return;
  }
  deck.innerHTML = list.slice(0, 2).reverse().map((r, i, arr) => cardHtml(r, i === arr.length - 1)).join("");
  const top = deck.querySelector(".card.top");
  const recipe = recipeBySlug[top.dataset.slug];
  attachSwipe(top, {
    onPick: () => pick(recipe),
    onSkip: () => skip(recipe),
    onOpen: () => openRecipe(recipe),
  });
}

function topCard() { return $("deck").querySelector(".card.top"); }

$("pick-btn").addEventListener("click", () => {
  const card = topCard();
  if (card) fling(card, 1, () => pick(recipeBySlug[card.dataset.slug]));
});
$("skip-btn").addEventListener("click", () => {
  const card = topCard();
  if (card) fling(card, -1, () => skip(recipeBySlug[card.dataset.slug]));
});

function setSkipped(next) {
  skipped = next;
  localStorage.setItem(SKIPPED_KEY, JSON.stringify([...skipped]));
  deckSignature = "";
  renderDeck();
}

function skip(recipe) {
  setSkipped(new Set([...skipped, recipe.slug]));
}

function pick(recipe) {
  deckSignature = "";
  if (pickedSlugs().has(recipe.slug)) { renderDeck(); return; }
  const pickId = uuid();
  const ov = overrides();
  store.upsert("picks", [{ id: pickId, recipe_slug: recipe.slug, servings: recipe.servings }]);
  store.upsert("list_items", recipe.ingredients.map((ing) => ({
    id: uuid(),
    name: ing.item,
    section: ov[ing.item] ?? ing.section,
    qty: ing.qty,
    unit: ing.unit,
    note: ing.note,
    pick_id: pickId,
    recipe_slug: recipe.slug,
    is_staple: ing.staple || ing.optional,
    checked: false,
  })));
}

function renderWeek() {
  const picks = [...state.picks].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  $("week-empty").hidden = picks.length > 0;
  $("week-list").innerHTML = picks.map((p) => {
    const r = recipeBySlug[p.recipe_slug];
    const title = r?.title ?? p.recipe_slug;
    return `<li>
      <button class="week-title" data-open="${esc(p.recipe_slug)}">${esc(title)}</button>
      <button class="icon-btn" data-unpick="${esc(p.id)}" aria-label="Remove ${esc(title)} from this week">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </li>`;
  }).join("");
}

$("week-list").addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  const unpick = e.target.closest("[data-unpick]");
  if (open && recipeBySlug[open.dataset.open]) openRecipe(recipeBySlug[open.dataset.open]);
  if (unpick) {
    deckSignature = "";
    store.remove("picks", [unpick.dataset.unpick]);
  }
});

// ---------- recipe sheet ----------

function openRecipe(r) {
  const time = formatTime(r.time_minutes);
  const picked = pickedSlugs().has(r.slug);
  $("recipe-content").innerHTML = `
    ${r.photo ? `<img class="recipe-photo" src="${esc(r.photo)}" alt="">` : ""}
    <h2 id="recipe-title" class="recipe-title">${esc(r.title)}</h2>
    <p class="recipe-facts">Serves ${esc(r.servings)}${time ? `, ${esc(time)}` : ""}</p>
    <h3>Ingredients</h3>
    <ul class="ingredients">
      ${r.ingredients.map((i) => `<li><span class="ing-qty">${esc(fmt(i))}</span> ${esc(i.item)}${i.note ? `<span class="ing-note">, ${esc(i.note)}</span>` : ""}${i.optional ? ' <span class="ing-note">(optional)</span>' : ""}</li>`).join("")}
    </ul>
    <div class="recipe-body">${renderMarkdown(r.body)}</div>
    ${picked ? "" : `<button class="primary wide" id="recipe-pick">Add to week</button>`}`;
  $("recipe-pick")?.addEventListener("click", () => { pick(r); $("recipe-sheet").close(); });
  $("recipe-sheet").showModal();
  $("recipe-sheet").querySelector(".sheet-body").scrollTop = 0;
}

const fmt = (i) => formatQty(i.qty, i.unit);

// ---------- grocery list ----------

function renderList() {
  currentList = buildList(state.list_items, sectionData.sections, titles);
  const { sections, staples } = currentList;
  const toBuy = sections.reduce((n, s) => n + s.groups.filter((g) => !g.checked).length, 0);
  $("list-count").textContent = toBuy;
  $("list-count").hidden = toBuy === 0;
  $("clear-checked").hidden = !state.list_items.some((r) => r.checked);

  if (!sections.length && !staples.length) {
    $("list").innerHTML = `<div class="list-empty"><p>Your list is empty.</p><p>Pick recipes on the Plan tab, or add an item above.</p></div>`;
    return;
  }

  const rowHtml = (g) => `
    <li class="item${g.checked ? " checked" : ""}" data-key="${esc(g.key)}">
      <button class="check" role="checkbox" aria-checked="${g.checked}" data-toggle>
        <span class="box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg></span>
        <span class="item-text">
          <span class="item-name">${esc(g.name)}</span>${g.qtyText ? ` <span class="item-qty">${esc(g.qtyText)}</span>` : ""}
          ${g.recipes.length ? `<span class="item-for">${esc(g.recipes.join(", "))}</span>` : ""}
        </span>
      </button>
      ${g.isStaple ? `<button class="need" data-need>Need it</button>` : ""}
      <button class="icon-btn more" data-more aria-label="Options for ${esc(g.name)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
      </button>
    </li>`;

  $("list").innerHTML =
    sections.map((s) => `
      <section class="aisle">
        <h2>${esc(s.name)}</h2>
        <ul>${s.groups.map(rowHtml).join("")}</ul>
      </section>`).join("") +
    (staples.length ? `
      <section class="aisle staples">
        <h2>Check you have these</h2>
        <p class="aisle-note">Pantry staples and optional ingredients from this week's recipes. Tap Need it to put one on the list.</p>
        <ul>${staples.map(rowHtml).join("")}</ul>
      </section>` : "");
}

const findGroup = (key) => [...currentList.sections.flatMap((s) => s.groups), ...currentList.staples].find((g) => g.key === key);

$("list").addEventListener("click", (e) => {
  const li = e.target.closest(".item");
  if (!li) return;
  const g = findGroup(li.dataset.key);
  if (!g) return;
  if (e.target.closest("[data-toggle]")) store.update("list_items", g.ids, { checked: !g.checked });
  else if (e.target.closest("[data-need]")) store.update("list_items", g.ids, { is_staple: false, checked: false });
  else if (e.target.closest("[data-more]")) openItem(g);
});

let openGroupKey = null;
$("item-section").innerHTML = sectionData.sections.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");

function openItem(g) {
  openGroupKey = g.key;
  $("item-title").textContent = g.name;
  const bits = [];
  if (g.qtyText) bits.push(g.qtyText);
  if (g.recipes.length) bits.push(`for ${g.recipes.join(", ")}`);
  if (g.manual) bits.push(g.recipes.length ? "plus added by hand" : "added by hand");
  const notes = g.notes.length ? ` Notes: ${g.notes.join("; ")}.` : "";
  $("item-detail").textContent = (bits.length ? bits.join(", ") + "." : "") + notes;
  $("item-section").value = sectionName[g.section] ? g.section : "other";
  $("item-need").hidden = !g.isStaple;
  $("item-sheet").showModal();
}

$("item-section").addEventListener("change", () => {
  const g = findGroup(openGroupKey);
  if (!g) return;
  const section = $("item-section").value;
  store.update("list_items", g.ids, { section });
  store.upsert("section_overrides", [{ item: itemKey(g.name), section }]);
  openGroupKey = `${g.isStaple ? "s" : "n"}|${itemKey(g.name)}`;
});
$("item-need").addEventListener("click", () => {
  const g = findGroup(openGroupKey);
  if (g) store.update("list_items", g.ids, { is_staple: false, checked: false });
  $("item-sheet").close();
});
$("item-remove").addEventListener("click", () => {
  const g = findGroup(openGroupKey);
  if (g) store.remove("list_items", g.ids);
  $("item-sheet").close();
});

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("add-input").value.trim();
  if (!text) return;
  const { name, qty, unit } = parseEntry(text);
  store.upsert("list_items", [{
    id: uuid(),
    name: name.toLowerCase(),
    section: guessSection(name, { overrides: overrides(), items: sectionData.items }),
    qty, unit, note: null, pick_id: null, recipe_slug: null, is_staple: false, checked: false,
  }]);
  $("add-input").value = "";
});

$("clear-checked").addEventListener("click", () => {
  const ids = state.list_items.filter((r) => r.checked).map((r) => r.id);
  if (ids.length) store.remove("list_items", ids);
});

// ---------- tabs, menu, sheets ----------

document.querySelector(".tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-view]");
  if (!tab) return;
  for (const t of document.querySelectorAll(".tabs [role=tab]")) {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    $(`${t.dataset.view}-view`).hidden = !on;
  }
  window.scrollTo(0, 0);
});

$("menu-btn").addEventListener("click", () => $("menu-sheet").showModal());
$("new-week").addEventListener("click", () => {
  const pickIds = state.picks.map((p) => p.id);
  if (pickIds.length) store.remove("picks", pickIds);
  const checked = state.list_items.filter((r) => r.checked && !pickIds.includes(r.pick_id)).map((r) => r.id);
  if (checked.length) store.remove("list_items", checked);
  setSkipped(new Set());
  $("menu-sheet").close();
});
$("sign-out").addEventListener("click", async () => {
  store?.disconnect();
  store?.clearLocal();
  localStorage.removeItem(SKIPPED_KEY);
  await client.auth.signOut();
  location.reload();
});

for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  });
}
