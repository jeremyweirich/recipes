// End-to-end run of the built app against test/fake-supabase.js on a phone-sized viewport.
// Usage: npm run build && node test/e2e.mjs   (needs Playwright + Chrome; writes screenshots to test/shots/)
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const shots = new URL("./shots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

const server = spawn("python3", ["-m", "http.server", "8765", "-d", "dist"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
await ctx.addInitScript({ content: readFileSync(new URL("./fake-supabase.js", import.meta.url), "utf8") });
// Pin the test to the two pork stews so adding recipes doesn't change what it expects.
const built = JSON.parse(readFileSync(new URL("../dist/recipes.json", import.meta.url), "utf8"));
const fixture = { ...built, recipes: built.recipes.filter((r) => r.slug.includes("pork-stew")) };
assert.equal(fixture.recipes.length, 2, "test fixture needs both pork stew recipes");
await ctx.route(/recipes\.json$/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) }));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/fonts|ERR_FAILED/.test(m.text())) errors.push(m.text()); });

const db = () => page.evaluate(() => structuredClone(window.__fake.db));
const step = (name) => console.log(`- ${name}`);

try {
  await page.goto("http://localhost:8765/");

  step("sign in rejects a wrong password, then accepts the right one");
  await page.fill("#auth-email", "jeremy@example.com");
  await page.fill("#auth-password", "nope");
  await page.click("#auth-form button");
  await page.waitForFunction(() => document.getElementById("auth-error").textContent.includes("don't match"));
  await page.fill("#auth-password", "pw");
  await page.click("#auth-form button");
  await page.waitForSelector("#app:not([hidden]) .card.top");
  const photoWidth = await page.$eval(".card.top .card-photo", (el) => el.getBoundingClientRect().width);
  assert.ok(photoWidth > 300, `top card picture should span the card (was ${photoWidth}px)`);
  await page.screenshot({ path: `${shots}1-plan.png` });

  step("swipe right on the top card adds it to the week");
  const firstSlug = await page.getAttribute(".card.top", "data-slug");
  const box = await page.locator(".card.top").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + i * 22, box.y + box.height / 2 + i * 2);
  await page.screenshot({ path: `${shots}2-swiping.png` });
  await page.mouse.up();
  await page.waitForFunction(() => window.__fake.db.picks.length === 1 && window.__fake.db.list_items.length === 18);
  assert.equal((await db()).picks[0].recipe_slug, firstSlug);
  await page.waitForSelector(".week-list li");

  step("skip button skips the next card and shows the empty deck");
  await page.click("#skip-btn");
  await page.waitForSelector(".deck-empty");
  await page.screenshot({ path: `${shots}3-deck-done.png` });

  step("tapping a recipe in This week opens it");
  await page.click(".week-title");
  await page.waitForSelector("#recipe-sheet[open] .ingredients li");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}4-recipe.png` });
  await page.click("#recipe-sheet [data-close]");

  step("list is grouped in store order with staples separate");
  await page.click("#tab-list");
  const headings = await page.$$eval(".aisle h2", (hs) => hs.map((h) => h.textContent));
  assert.deepEqual(headings, ["Produce", "Meat & Seafood", "Canned & Jarred", "Beer & Wine", "Check you have these"]);
  assert.equal(await page.textContent('.item[data-key="n|pork shoulder"] .item-qty'), "3 lb");
  assert.equal(await page.textContent("#list-count"), "10");
  await page.screenshot({ path: `${shots}5-list.png`, fullPage: true });

  step("checking an item saves it");
  await page.click('.item[data-key="n|celery"] [data-toggle]');
  await page.waitForFunction(() => window.__fake.db.list_items.filter((r) => r.name === "celery").every((r) => r.checked));

  step("manual add guesses the section");
  await page.fill("#add-input", "2 lb chicken thighs");
  await page.press("#add-input", "Enter");
  await page.waitForSelector('.item[data-key="n|chicken thighs"]');
  const chickenSection = await page.$eval('.item[data-key="n|chicken thighs"]', (li) => li.closest(".aisle").querySelector("h2").textContent);
  assert.equal(chickenSection, "Meat & Seafood");

  step("Need it moves a staple onto the list");
  await page.click('.item[data-key="s|kosher salt"] [data-need]');
  await page.waitForSelector('.item[data-key="n|kosher salt"]');

  step("changes made offline queue up and sync when back online");
  await page.evaluate(() => window.__fake.setOffline(true));
  await page.click('.item[data-key="n|garlic"] [data-toggle]');
  await page.waitForFunction(() => document.getElementById("sync").textContent.startsWith("Offline. 1 change"));
  assert.equal(await page.getAttribute('.item[data-key="n|garlic"] [data-toggle]', "aria-checked"), "true");
  await page.screenshot({ path: `${shots}6-offline.png` });
  await page.evaluate(() => { window.__fake.setOffline(false); window.dispatchEvent(new Event("online")); });
  await page.waitForFunction(() => window.__fake.db.list_items.filter((r) => r.name === "garlic").every((r) => r.checked));
  await page.waitForFunction(() => document.getElementById("sync").textContent === "");

  step("the other phone's additions show up live");
  await page.evaluate(() => window.__fake.otherPhone("list_items", { id: crypto.randomUUID(), name: "milk", section: "dairy", qty: null, unit: null, note: null, pick_id: null, recipe_slug: null, is_staple: false, checked: false }));
  await page.waitForSelector('.item[data-key="n|milk"]');

  step("changing an item's section is remembered");
  await page.click('.item[data-key="n|pork shoulder"] [data-more]');
  await page.selectOption("#item-section", "deli");
  await page.waitForFunction(() => window.__fake.db.section_overrides.some((o) => o.item === "pork shoulder" && o.section === "deli"));
  await page.click("#item-sheet [data-close]");

  step("clear checked removes only checked rows");
  await page.click("#clear-checked");
  await page.waitForFunction(() => !window.__fake.db.list_items.some((r) => r.checked));
  assert.equal(await page.locator('.item[data-key="n|celery"]').count(), 0);

  step("new week clears recipes and their ingredients, keeps hand-added items");
  await page.click("#menu-btn");
  await page.click("#new-week");
  await page.waitForFunction(() => window.__fake.db.picks.length === 0);
  const left = (await db()).list_items.map((r) => r.name).sort();
  assert.deepEqual(left, ["chicken thighs", "milk"]);

  step("picking the same recipe on both phones offline keeps one copy");
  await page.click("#tab-plan");
  await page.waitForSelector(".card.top");
  await page.evaluate(() => window.__fake.setOffline(true));
  const slug = await page.getAttribute(".card.top", "data-slug");
  await page.click("#pick-btn");
  await page.waitForFunction(() => document.getElementById("sync").textContent.startsWith("Offline"));
  await page.evaluate((s) => { window.__fake.db.picks.push({ id: crypto.randomUUID(), recipe_slug: s, servings: 6 }); }, slug);
  await page.evaluate(() => { window.__fake.setOffline(false); window.dispatchEvent(new Event("online")); });
  await page.waitForFunction(() => document.getElementById("sync").textContent === "");
  const after = await db();
  assert.equal(after.picks.length, 1);
  assert.equal(after.list_items.filter((r) => r.pick_id).length, 0, "orphan rows from the rejected pick were dropped");
  assert.equal(await page.locator(".week-list li").count(), 1);

  assert.deepEqual(errors, [], "no console errors");
  console.log("E2E OK");
} catch (e) {
  await page.screenshot({ path: `${shots}failure.png`, fullPage: true });
  console.error("E2E FAILED:", e.message, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
