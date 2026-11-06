// End-to-end check against the local emulators (npm run dev in another terminal).
// node tests/e2e.mjs  -> screenshots in shots/
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { post as intake, driveFiles } from "./gas-harness.mjs";
import { readFileSync, mkdirSync } from "node:fs";
const BASE = "http://localhost:5000/", AUTH = "http://127.0.0.1:9099";
const OWNER = "work.harshsheth@gmail.com", MUM = "mum@example.com";
mkdirSync("shots", { recursive: true });
// Start clean: wipe emulator data from earlier runs.
await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-family-review/databases/(default)/documents", { method: "DELETE" });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/demo-family-review/accounts`, { method: "DELETE" });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ proxy });
// Wait up to 10 s for something to appear (the app updates live, so checks must not race it).
const seen = async (loc) => { try { await loc.first().waitFor({ timeout: 15000 }); return true; } catch { return false; } };
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
await o.locator(".hmini.fail", { hasText: "5′8″" }).waitFor(); ok(true, "Kavya (5′8″) shows height fail, small and last");
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
ok(await seen(o.getByText("Height not known").first()), "Upload PDF of a new girl makes a new profile in New");
await o.goto(BASE + "#/");
await o.locator('details.grp[data-stage="Mothers in touch"] summary').click();
await o.getByText("Asha Mehta").click();
ok(await seen(o.getByText("All family (1) can see her")), "every profile is shared with all family by default");
await o.click('a:has-text("Edit")');
await o.fill('input[name="pdfUrl"]', "https://example.com/x.pdf");
await o.click('button:has-text("Save")');
await o.getByText("must be a Google Drive link").waitFor();
await o.fill('input[name="pdfUrl"]', "https://drive.google.com/file/d/TEST_FILE_ID_000000000000/view?usp=sharing");
await o.click('button:has-text("Save")');
await o.locator("a.pdf").waitFor();
ok(true, "owner attaches a Drive PDF (non-Drive links refused)");
// Photo from biodata: the intake script pulls the pictures out of her PDF; Harsh picks one and crops it.
driveFiles.push({ id: "TEST_FILE_ID_000000000000", name: "Asha.pdf", mimeType: "application/pdf", bytes: readFileSync("tests/fixtures/biodata-with-photo.pdf") });
await o.click('a:has-text("Edit")');
await o.click('[data-act="frombio"]');
await o.locator(".pick button").first().waitFor();
ok((await o.locator(".pick button").count()) === 3, "From biodata shows the 3 pictures inside her PDF");
await o.locator(".pick button").first().click();
await o.locator(".crop .sq").waitFor();
await o.waitForTimeout(300);
await o.screenshot({ path: "shots/11-crop-412.png" });
await o.click("[data-ok]");
await o.locator("#pv img").waitFor();
await o.click('button:has-text("Save")');
await o.locator(".hero .ph-img img").waitFor();
ok(true, "Harsh crops her face and it becomes her profile photo");
await o.fill("#f-cm textarea", "Good family, met them at Lakhtar samaj event.");
await o.click('#f-cm button[type="submit"]');
await o.getByText("Good family, met them").waitFor();
ok(true, "owner comments");
// Harsh hides one profile: only that one stays private.
await o.goto(BASE + "#/");
await o.locator('details.grp[data-stage="Pass"]').evaluate((x) => (x.open = true));
await o.getByText("Kavya Doshi").click();
await o.click('[data-act="hide"]');
await o.getByText("Hidden from family").first().waitFor();
ok(true, "Harsh hides Kavya from family");

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
await m.getByText("Profiles Harsh shared").waitFor();
await m.locator("details.grp").first().waitFor();
await m.locator("details.grp").evaluateAll((ds) => ds.forEach((x) => (x.open = true)));
ok((await m.locator(".cr").count()) >= 5 && !(await m.getByText("Kavya Doshi").count()), "Mummy sees every profile except the hidden one");
ok(await seen(m.getByText("All biodata PDFs in Drive")), "reviewer sees the Drive folder link");
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
ok(await seen(m.getByText("@mum").first()), "reviewer comment shows name + handle");
// Family's part: Mummy records the call with her mother, kundli, and feedback.
await m.locator('#f-fam .tick', { hasText: "Spoke to her mother" }).click();
await m.locator('#f-fam .tick', { hasText: "Biodatas exchanged" }).click();
await m.fill('#f-fam input[name="birthName"]', "Asha");
await m.fill('#f-fam input[name="birthPlace"]', "Ghatkopar, Mumbai");
await m.fill('#f-fam input[name="birthDate"]', "1993-12-23");
await m.fill('#f-fam input[name="birthTime"]', "05:48");
// Send Janmakshar to the Kundli group: preview, WhatsApp opens with the text, Circle marks it sent and waiting.
await m.evaluate(() => { window.open = (u) => { window.__wa = u; }; }); // capture instead of leaving the app
await m.click('[data-act="wa"]'); await m.locator(".wa-preview").waitFor();
ok((await m.locator(".wa-preview").textContent()).includes("Birth time: 5:48 am"), "WhatsApp message shows birth date, time and place before sending");
await m.screenshot({ path: "shots/12-wa-preview-412.png" }); await m.click("[data-go]");
const waUrl = await m.evaluate(() => window.__wa);
ok(waUrl.startsWith("https://wa.me/?text=") && decodeURIComponent(waUrl).includes("Kundli matching for Harsh"), "WhatsApp opens with the Kundli message ready");
await m.getByText("Saved").first().waitFor();
ok(await seen(m.locator(".hero .tag", { hasText: "Waiting for Harshaben" })), "stage moves to Waiting for Harshaben");
await m.locator('#f-fam .seg label', { hasText: /^Match$/ }).click();
await m.fill('#f-fam textarea[name="harshabenNotes"]', "Good match, 28 gun.");
await m.fill('#f-fam textarea[name="familyFeedback"]', "Very warm family, father runs a textile business.");
await m.click('#f-fam button[type="submit"]');
await m.getByText("Last by Mummy").waitFor();
ok(true, "Mummy fills in Family's part: mother, biodatas, Janmakshar, Harshaben's match, feedback");
await m.screenshot({ path: "shots/9-family-part-412.png", fullPage: true });
ok(!(await m.getByText("Against my criteria").isVisible()) && !(await m.getByText("Only you see this").isVisible()), "family never sees Harsh's criteria or private notes");
await m.screenshot({ path: "shots/2-reviewer-detail-412.png", fullPage: true });
// Harshaben says no match for Riya: she is parked under "Failed by Harshaben", not Pass, with a re-check button.
await m.goto(BASE + "#/");
await m.locator('details.grp[data-stage="Waiting for Harshaben"]').evaluate((x) => (x.open = true));
await m.getByText("Riya Kapadia").click();
await m.locator('#f-fam .seg label', { hasText: /^No match$/ }).click();
await m.fill('#f-fam textarea[name="harshabenNotes"]', "Nadi dosh. Birth time may be off.");
await m.click('#f-fam button[type="submit"]');
await m.getByText("Saved").first().waitFor();
ok(await seen(m.locator(".hero .tag", { hasText: "Failed by Harshaben" })), "No match parks Riya under Failed by Harshaben (not Pass)");
ok(await seen(m.locator('[data-act="recheck"]')), "a Send again for a re-check button appears");
await m.screenshot({ path: "shots/17-hb-failed-412.png", fullPage: true });
await m.goto(BASE + "#/");
await m.locator('details.grp[data-stage="Failed by Harshaben"]').evaluate((x) => (x.open = true));
ok(await seen(m.locator('details.grp[data-stage="Failed by Harshaben"] .cr', { hasText: "Riya Kapadia" })), "list shows a Failed by Harshaben group with Riya in it");
await m.screenshot({ path: "shots/18-hb-failed-list-412.png" });
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
await d.locator('details.grp[data-stage="Harshaben matched"] summary').click();
await d.locator('details.grp[data-stage="Failed by Harshaben"] summary').click();
ok(await seen(d.locator('details.grp[data-stage="Failed by Harshaben"] .tag.bad', { hasText: "Harshaben: no match" })), "Harsh's list: Failed by Harshaben group, red dot, no-match tag");
await d.screenshot({ path: "shots/3-owner-list-1280.png" });
// Re-check: Harsh corrects the birth time and sends the Janmakshar again. Round 1's verdict stays on record.
await d.getByText("Riya Kapadia").click();
await d.locator('[data-act="recheck"]').waitFor();
await d.click('[data-act="recheck"]');
await d.getByText("Fill birth date, time and place first").waitFor();
await d.fill('#f-fam input[name="birthPlace"]', "Rajkot");
await d.fill('#f-fam input[name="birthDate"]', "1994-02-11");
await d.fill('#f-fam input[name="birthTime"]', "06:20");
await d.evaluate(() => { window.open = (u) => { window.__wa = u; }; });
await d.click('[data-act="recheck"]'); await d.locator(".wa-preview").waitFor();
ok((await d.locator(".wa-preview").textContent()).includes("re-check, round 2"), "re-check message says round 2");
await d.screenshot({ path: "shots/19-recheck-preview-1280.png" });
await d.click("[data-go]");
await d.getByText("Saved").first().waitFor();
ok(await seen(d.locator(".rounds .tag.bad", { hasText: "Round 1: No match" })), "round 1's No match is kept on record");
ok(await seen(d.locator("#f-fam .tag", { hasText: "Round 2" })) && (await d.locator('select[data-act="stage"]').inputValue()) === "Waiting for Harshaben", "Riya is back in Waiting for Harshaben as round 2");
await d.screenshot({ path: "shots/20-recheck-round2-1280.png", fullPage: true });
await d.goto(BASE + "#/");
await d.locator('details.grp[data-stage="Waiting for Harshaben"]').evaluate((x) => (x.open = true));
ok(await seen(d.locator(".cr", { hasText: "Riya Kapadia" }).locator(".tag.blue", { hasText: "Re-check · Waiting" })), "list shows Re-check · Waiting for Riya");
await d.screenshot({ path: "shots/21-recheck-list-1280.png" });
await d.getByText("Asha Mehta").click();
await d.getByText("Ask about her work hours").waitFor();
ok(await seen(d.getByText("Mummy").first()), "owner sees reviewer rating and comment");
ok(await seen(d.getByText("Very warm family")), "Harsh sees Family's part filled by Mummy");
ok(await d.locator('select[data-act="stage"]').inputValue() === "Harshaben matched", "Mummy's ticks moved Asha to Harshaben matched");
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
await d.locator('details.grp[data-stage="Harshaben matched"]').evaluate((e) => (e.open = true));
ok(await seen(d.getByText("Harshaben: match").first()), "list shows Harshaben: match");
await d.getByText("Asha Mehta").click();
await d.getByText("Against my criteria").waitFor();
ok(await seen(d.locator(".fits li", { hasText: "Age 30-36" }).locator(".fit.ok")), "Asha (32) fits the age range");
await d.screenshot({ path: "shots/7-owner-detail-criteria-1280.png", fullPage: true });
await d.goto(BASE + "#/sources");
await d.locator('details.grp[data-src="Seema Aunty"]').waitFor();
ok((await d.locator('details.grp[data-src="Seema Aunty"] .n').textContent()) === "2", "Sources shows Seema Aunty with 2 biodatas");
await d.locator('details.grp summary').first().click();
await d.screenshot({ path: "shots/8-sources-1280.png" });
await d.screenshot({ path: "shots/4-owner-detail-1280.png", fullPage: true });
// Main view filters: source, Harshaben, Jain grouping, language multi-select; height shown last and small.
await d.goto(BASE + "#/");
await d.selectOption('select[data-filter="source"]', "Seema Aunty");
ok((await d.locator(".cr").count()) === 2, "Source filter: Seema Aunty shows her 2 biodatas");
await d.selectOption('select[data-filter="source"]', "");
await d.selectOption('select[data-filter="hb"]', "Passed");
ok((await d.locator(".cr").count()) === 1 && await d.getByText("Asha Mehta").isVisible(), "Harshaben: passed shows only Asha");
await d.click('[data-act="clear"]');
await d.locator("details.ms summary").click();
await d.locator('[data-lang="Gujarati"]').check();
ok((await d.locator(".cr").count()) >= 1, "Language multi-select filters (Gujarati)");
await d.screenshot({ path: "shots/10-main-view-1280.png" });

// A sister added later sees everything at once (no per-profile sharing needed).
await d.goto(BASE + "#/people");
await d.fill('#f-add input[name="name"]', "Didi");
await d.fill('#f-add input[name="email"]', "didi@example.com");
await d.click('#f-add button[type="submit"]');
await d.getByText("Didi added").waitFor();
await d.screenshot({ path: "shots/13-family-1280.png", fullPage: true });
const dc2 = await ctx(412), di = await dc2.newPage();
await signIn(di, "didi@example.com");
await di.locator("details.grp").first().waitFor();
await di.locator("details.grp").evaluateAll((ds) => ds.forEach((x) => (x.open = true)));
ok((await di.locator(".cr").count()) >= 5 && !(await di.getByText("Kavya Doshi").count()), "a sister added later sees every profile except hidden ones");
await di.screenshot({ path: "shots/14-family-phone-412.png" });
// Harsh can switch to choosing per profile; then "Share all" per person brings everything back.
await d.locator('[data-act="auto-share"]').uncheck();
await d.getByText("You now choose who sees each profile").waitFor();
await d.goto(BASE + "#/new");
await d.fill('input[name="name"]', "Zara Manual");
await d.click('button:has-text("Add profile")');
await d.getByRole("heading", { name: "Zara Manual" }).waitFor();
await di.reload(); await di.locator("details.grp").first().waitFor();
await di.waitForTimeout(1500);
ok(!(await di.getByText("Zara Manual").count()), "with sharing set to per-profile, a new profile stays private");
await d.goto(BASE + "#/people");
await d.click('[data-share-one="didi@example.com"]');
await d.getByText(/Shared \d+ profile/).waitFor();
await di.reload(); await di.locator("details.grp").first().waitFor();
await di.fill('input[data-filter="q"]', "Zara"); // a search opens the matching groups
ok(await seen(di.locator(".cr", { hasText: "Zara Manual" })), "Share all gives her every open profile");
// Native place and place of birth lead the biodata; Janmakshar can be filled from it in one tap.
await d.goto(BASE + "#/");
await d.locator('details.grp[data-stage="Mothers in touch"]').evaluate((x) => (x.open = true));
await d.getByText("Pooja Vora").first().click();
ok((await d.locator("dl.facts dt").first().textContent()) === "Native" && await seen(d.locator("dl.facts dd", { hasText: "Ghatkopar, Mumbai" })), "biodata shows Native and Place of birth first");
await d.click('[data-act="use-bio"]');
ok((await d.inputValue('#f-fam input[name="birthPlace"]')) === "Ghatkopar, Mumbai" && (await d.inputValue('#f-fam input[name="birthTime"]')) === "07:41"
  && (await d.inputValue('#f-fam input[name="birthDate"]')) === "1992-04-28", "Use these fills Janmakshar from her biodata");
await d.screenshot({ path: "shots/15-native-birthplace-1280.png", fullPage: true });
// Sources › Bina: one tap starts a check of her folder (runs in the background; the card shows progress).
await o.goto(BASE + "#/sources");
await o.locator('[data-act="bina-update"]').click();
await o.getByText("Checking Bina's folder").first().waitFor();
ok(await seen(o.getByText("Checking now")), "Check Bina's folder starts and the Sources card shows it is running");
await o.screenshot({ path: "shots/16-bina-check-412.png" });
await browser.close();
console.log("ALL OK");
