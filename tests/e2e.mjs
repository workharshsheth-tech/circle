// End-to-end check against the local emulators (npm run dev in another terminal).
// node tests/e2e.mjs  -> screenshots in shots/
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync, mkdirSync } from "node:fs";
const BASE = "http://localhost:5000/", AUTH = "http://127.0.0.1:9099";
const OWNER = "work.harshsheth@gmail.com", MUM = "mum@example.com";
mkdirSync("shots", { recursive: true });
// Start clean: wipe emulator data from earlier runs.
await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-family-review/databases/(default)/documents", { method: "DELETE" });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/demo-family-review/accounts`, { method: "DELETE" });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ proxy });
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); };

async function signIn(page, email) {
  await page.goto(BASE);
  await page.fill('input[name="email"]', email);
  await page.click('button[type="submit"]');
  await page.getByText("We sent a sign-in link").waitFor();
  const codes = await (await fetch(`${AUTH}/emulator/v1/projects/demo-family-review/oobCodes`)).json();
  const code = codes.oobCodes.filter((c) => c.email === email && c.requestType === "EMAIL_SIGNIN").pop();
  await page.goto(`${BASE}?apiKey=demo-key&oobCode=${code.oobCode}&mode=signIn&lang=en`);
}
const ctx = (w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 900 : 860 }, deviceScaleFactor: 2 });

// 1. Owner
const oc = await ctx(412), o = await oc.newPage();
o.on("pageerror", (e) => console.log("pageerror", e.message));
await signIn(o, OWNER);
await o.getByText("No profiles yet").waitFor();
ok(true, "owner signs in by email link");
await o.goto(BASE + "#/import");
await o.fill("textarea", readFileSync("seed/seed.json", "utf8"));
await o.getByText("Ready: 5 profiles").waitFor();
await o.click('[data-act="go"]');
await o.locator("details.grp").first().waitFor();
ok((await o.locator("details.grp[open]").count()) === 0, "groups start collapsed");
await o.screenshot({ path: "shots/1-owner-list-412.png" });
await o.locator('details.grp[data-stage="Pass"] summary').click();
ok(await o.getByText("Height fail · 5′8″").isVisible(), "Dhwani shows Height fail");
await o.goto(BASE + "#/people");
await o.fill('#f-add input[name="name"]', "Mummy");
await o.fill('#f-add input[name="email"]', MUM);
await o.click('#f-add button[type="submit"]');
await o.getByText(MUM).waitFor();
ok(true, "owner adds a family member");
await o.goto(BASE + "#/");
await o.locator('details.grp[data-stage="In review"] summary').click();
await o.getByText("Mansi Panchamia").click();
await o.click('[data-act="share-all"]');
await o.locator('.share label.on').waitFor();
ok(true, "owner shares Mansi with family");
await o.fill("#f-cm textarea", "Good family, met them at Lakhtar samaj event.");
await o.click('#f-cm button[type="submit"]');
await o.getByText("Good family, met them").waitFor();
ok(true, "owner comments");

// 2. Reviewer
const mc = await ctx(412), m = await mc.newPage();
m.on("pageerror", (e) => console.log("pageerror", e.message));
await signIn(m, MUM);
await m.locator("details.grp").first().waitFor();
await m.locator("details.grp summary").first().click();
ok((await m.locator(".cr").count()) === 1, "reviewer sees only the 1 shared profile");
await m.getByText("Mansi Panchamia").click();
await m.getByText("Give your stars first").waitFor();
ok(true, "rating is blind before rating");
await m.click('[data-star="4"]');
await m.getByText("family average from 1 person").waitFor();
ok(true, "reviewer rates 4 and then sees family average");
await m.fill("#f-cm textarea", "Looks sweet. Ask about her work hours.");
await m.click('#f-cm button[type="submit"]');
await m.getByText("Ask about her work hours").waitFor();
ok(await m.getByText("@mum").first().isVisible(), "reviewer comment shows name + handle");
await m.screenshot({ path: "shots/2-reviewer-detail-412.png", fullPage: true });
await m.goto(BASE + "#/harsh");
await m.getByText("Zalawadi Dashashrimali Sthanakvasi Jain").waitFor();
ok(true, "reviewer can read Harsh's biodata");

// 3. Stranger
const sc = await ctx(412), s = await sc.newPage();
await signIn(s, "stranger@example.com");
await s.getByText("Not on the list yet").waitFor();
ok(true, "uninvited email is turned away");

// 4. Owner sees it all, desktop
const dc = await ctx(1280), d = await dc.newPage();
await signIn(d, OWNER);
await d.locator("details.grp").first().waitFor();
await d.locator('details.grp[data-stage="In review"] summary').click();
await d.locator('details.grp[data-stage="Shortlist"] summary').click();
await d.screenshot({ path: "shots/3-owner-list-1280.png" });
await d.getByText("Mansi Panchamia").click();
await d.getByText("Ask about her work hours").waitFor();
ok(await d.getByText("Mummy").first().isVisible(), "owner sees reviewer rating and comment");
await d.screenshot({ path: "shots/4-owner-detail-1280.png", fullPage: true });
await browser.close();
console.log("ALL OK");
