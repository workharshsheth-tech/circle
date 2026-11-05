// End-to-end check against the local emulators (npm run dev in another terminal).
// node tests/e2e.mjs  -> screenshots in shots/
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { post as intake } from "./gas-harness.mjs";
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
  await page.click('[data-act="use-email"]');
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
await o.fill("textarea", readFileSync("tests/fixture.json", "utf8"));
await o.getByText("Ready: 5 profiles").waitFor();
await o.click('[data-act="go"]');
await o.locator("details.grp").first().waitFor();
ok((await o.locator("details.grp[open]").count()) === 0, "groups start collapsed");
// Install: Chrome fires beforeinstallprompt when Circle can be installed; simulate it.
await o.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(e); });
await o.locator('[data-act="install"]').waitFor();
await o.screenshot({ path: "shots/6-install-card-412.png" });
await o.click('[data-act="install"]');
ok(await o.evaluate(() => window.__prompted === true), "Install Circle button opens the phone's install prompt");
for (const f of ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "sw.js"])
  ok((await fetch(BASE + f)).status === 200, "serves " + f);
await o.screenshot({ path: "shots/1-owner-list-412.png" });
await o.locator('details.grp[data-stage="Pass"] summary').click();
ok(await o.getByText("Height fail · 5′8″").isVisible(), "Kavya (5′8″) shows Height fail");
await o.goto(BASE + "#/people");
await o.fill('#f-add input[name="name"]', "Mummy");
await o.fill('#f-add input[name="email"]', MUM);
await o.click('#f-add button[type="submit"]');
await o.getByText(MUM).waitFor();
ok(true, "owner adds a family member");
await o.fill('#f-drive input[name="folder"]', "https://drive.google.com/drive/folders/TEST_FOLDER_ID_0000000000");
await o.fill('#f-drive input[name="intake"]', "https://script.google.com/macros/s/TEST/exec");
await o.click('#f-drive button[type="submit"]');
await o.getByText("Saved").first().waitFor();
ok(true, "owner saves the Drive folder and intake link");
// The intake web app runs here through the Node harness (real Code.gs, local database).
await o.route("https://script.google.com/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(intake(JSON.parse(route.request().postData()))) }));
await o.goto(BASE + "#/");
await o.setInputFiles('[data-act="upload"]', { name: "Nisha_Patel_Biodata.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
await o.getByRole("heading", { name: "Nisha Patel" }).waitFor();
await o.locator("a.pdf").waitFor();
ok(true, "Upload PDF attaches the file to the matching profile (Nisha)");
await o.goto(BASE + "#/");
await o.setInputFiles('[data-act="upload"]', { name: "Riya Doshi Biodata.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
await o.getByRole("heading", { name: "Riya Doshi" }).waitFor();
ok(await o.getByText("Height not known").first().isVisible(), "Upload PDF of a new girl makes a new profile in New");
await o.goto(BASE + "#/");
await o.locator('details.grp[data-stage="Mothers in touch"] summary').click();
await o.getByText("Asha Mehta").click();
await o.click('[data-act="share-all"]');
await o.locator('.share label.on').waitFor();
ok(true, "owner shares Asha with family");
await o.click('a:has-text("Edit")');
await o.fill('input[name="pdfUrl"]', "https://example.com/x.pdf");
await o.click('button:has-text("Save")');
await o.getByText("must be a Google Drive link").waitFor();
await o.fill('input[name="pdfUrl"]', "https://drive.google.com/file/d/TEST_FILE_ID_000000000000/view?usp=sharing");
await o.click('button:has-text("Save")');
await o.locator("a.pdf").waitFor();
ok(true, "owner attaches a Drive PDF (non-Drive links refused)");
await o.fill("#f-cm textarea", "Good family, met them at Lakhtar samaj event.");
await o.click('#f-cm button[type="submit"]');
await o.getByText("Good family, met them").waitFor();
ok(true, "owner comments");

// 2. Reviewer
const mc = await ctx(412), m = await mc.newPage();
m.on("pageerror", (e) => console.log("pageerror", e.message));
// Mummy uses "Continue with Google" (the emulator shows its own account picker in the popup).
await m.goto(BASE);
const [pop] = await Promise.all([m.waitForEvent("popup"), m.click('[data-act="google"]')]);
await pop.waitForLoadState();
await pop.getByText("Add new account").click();
await pop.fill("#email-input", MUM);
await pop.fill("#display-name-input", "Mummy");
await pop.getByText("Sign in with Google.com").click();
ok(true, "Mummy signs in with Continue with Google");
await m.locator("details.grp").first().waitFor();
await m.locator("details.grp summary").first().click();
ok((await m.locator(".cr").count()) === 1, "reviewer sees only the 1 shared profile");
ok(await m.getByText("All biodata PDFs in Drive").isVisible(), "reviewer sees the Drive folder link");
await m.getByText("Asha Mehta").click();
await m.locator("a.pdf").waitFor(); ok(true, "reviewer sees the Biodata PDF button");
await m.getByText("Give your stars first").waitFor();
ok(true, "rating is blind before rating");
await m.click('[data-star="4"]');
await m.getByText("family average from 1 person").waitFor();
ok(true, "reviewer rates 4 and then sees family average");
await m.fill("#f-cm textarea", "Looks sweet. Ask about her work hours.");
await m.click('#f-cm button[type="submit"]');
await m.getByText("Ask about her work hours").waitFor();
ok(await m.getByText("@mum").first().isVisible(), "reviewer comment shows name + handle");
// Family's part: Mummy records the call with her mother, kundli, and feedback.
await m.locator('#f-fam .tick', { hasText: "Spoke to her mother" }).click();
await m.locator('#f-fam .tick', { hasText: "Biodatas exchanged" }).click();
await m.fill('#f-fam input[name="birthName"]', "Asha");
await m.fill('#f-fam input[name="birthPlace"]', "Ghatkopar, Mumbai");
await m.fill('#f-fam input[name="birthDate"]', "1993-12-23");
await m.fill('#f-fam input[name="birthTime"]', "05:48");
await m.locator('#f-fam .tick', { hasText: "Sent to Harshaben" }).click();
await m.locator('#f-fam .seg label', { hasText: /^Match$/ }).click();
await m.fill('#f-fam textarea[name="harshabenNotes"]', "Good match, 28 gun.");
await m.fill('#f-fam textarea[name="familyFeedback"]', "Very warm family, father runs a textile business.");
await m.click('#f-fam button[type="submit"]');
await m.getByText("Last by Mummy").waitFor();
ok(true, "Mummy fills in Family's part: mother, biodatas, Janmakshar, Harshaben's match, feedback");
await m.screenshot({ path: "shots/9-family-part-412.png", fullPage: true });
ok(!(await m.getByText("Against my criteria").isVisible()) && !(await m.getByText("Only you see this").isVisible()), "family never sees Harsh's criteria or private notes");
await m.screenshot({ path: "shots/2-reviewer-detail-412.png", fullPage: true });
await m.goto(BASE + "#/harsh");
await m.getByText("Zalawadi Dashashrimali Sthanakvasi Jain").waitFor();
ok(true, "reviewer can read Harsh's biodata");

// iPhone: no install prompt in Safari, so the card explains Share > Add to Home Screen.
const ipc = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const iph = await ipc.newPage(); await signIn(iph, MUM);
await iph.getByText("Add to Home Screen").waitFor();
ok(true, "iPhone shows Add to Home Screen how-to");
await iph.click('[data-act="install-hide"]');
ok(!(await iph.getByText("Add to Home Screen").isVisible()), "how-to can be dismissed");

// 3. Stranger
const ic = await browser.newContext({ viewport: { width: 412, height: 900 }, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 WhatsApp/2.24" });
const ip = await ic.newPage(); await ip.goto(BASE);
await ip.getByText("Open in Chrome").waitFor(); ok(true, "inside WhatsApp it offers Open in Chrome");
await ip.screenshot({ path: "shots/5-whatsapp-signin-412.png" });
const sc = await ctx(412), s = await sc.newPage();
await signIn(s, "stranger@example.com");
await s.getByText("Not on the list yet").waitFor();
ok(true, "uninvited email is turned away");

// 4. Owner sees it all, desktop
const dc = await ctx(1280), d = await dc.newPage();
await signIn(d, OWNER);
await d.locator("details.grp").first().waitFor();
await d.locator('details.grp[data-stage="With Harshaben"] summary').click();
await d.screenshot({ path: "shots/3-owner-list-1280.png" });
await d.getByText("Asha Mehta").click();
await d.getByText("Ask about her work hours").waitFor();
ok(await d.getByText("Mummy").first().isVisible(), "owner sees reviewer rating and comment");
ok(await d.getByText("Very warm family").isVisible(), "Harsh sees Family's part filled by Mummy");
ok(await d.locator('select[data-act="stage"]').inputValue() === "With Harshaben", "Mummy's ticks moved Asha to With Harshaben");
await d.locator(".seg label", { hasText: "Yes" }).click();
await d.click('#f-priv button[type="submit"]');
await d.getByText("Notes saved").waitFor();
ok(true, "Harsh records his own call (Yes)");
await d.goto(BASE + "#/criteria");
await d.fill('#f-crit input[name="age"]', "30-36");
await d.selectOption('#f-crit select[name="imp-age"]', "Must");
await d.fill('#f-crit input[name="marital"]', "Never married only");
await d.fill('#f-crit textarea[name="thinking"]', "Not sure yet about living outside Mumbai.");
await d.click('#f-crit button[type="submit"]');
await d.getByText("Saved").first().waitFor();
ok(true, "Harsh saves his criteria");
await d.goto(BASE + "#/");
await d.locator('details.grp[data-stage="With Harshaben"]').evaluate((e) => (e.open = true));
ok(await d.getByText("Harshaben: match").first().isVisible(), "list shows Harshaben: match");
await d.getByText("Asha Mehta").click();
await d.getByText("Against my criteria").waitFor();
ok(await d.locator(".fits li", { hasText: "Age 30-36" }).locator(".fit.ok").isVisible(), "Asha (32) fits the age range");
await d.screenshot({ path: "shots/7-owner-detail-criteria-1280.png", fullPage: true });
await d.goto(BASE + "#/sources");
await d.locator('details.grp[data-src="Seema Aunty"]').waitFor();
ok((await d.locator('details.grp[data-src="Seema Aunty"] .n').textContent()) === "2", "Sources shows Seema Aunty with 2 biodatas");
await d.locator('details.grp summary').first().click();
await d.screenshot({ path: "shots/8-sources-1280.png" });
await d.screenshot({ path: "shots/4-owner-detail-1280.png", fullPage: true });
await browser.close();
console.log("ALL OK");
