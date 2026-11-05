// Intake (apps-script/Code.gs) tests against the local emulators (npm run dev must be running).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { P, FS, AU, SECRET, saved, post } from "./gas-harness.mjs";
const getDoc = async (path) => (await fetch(`${FS}/v1/projects/${P}/databases/(default)/documents/${path}`, { headers: { Authorization: "Bearer owner" } })).json();
async function tokenFor(email, verified) {
  const k = "?key=demo-key", base = `${AU}/identitytoolkit.googleapis.com/v1`;
  const r = await (await fetch(`${base}/accounts:signUp${k}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "pw123456", returnSecureToken: true }) })).json();
  if (verified) await fetch(`${base}/projects/${P}/accounts:update`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify({ localId: r.localId, emailVerified: true }) });
  const s = await (await fetch(`${base}/accounts:signInWithPassword${k}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "pw123456", returnSecureToken: true }) })).json();
  return s.idToken;
}
const PDF = Buffer.from("%PDF-1.4 test").toString("base64");

before(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AU}/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
});

test("wrong or missing secret is refused, nothing saved", () => {
  assert.equal(post({ secret: "nope", fields: { name: "X" } }).ok, false);
  assert.equal(post({ fields: { name: "X" } }).ok, false);
  assert.equal(saved.length, 0);
});
test("bot sends a PDF with fields: profile is created, filed, and sorted", async () => {
  const r = post({ secret: SECRET, source: "WhatsApp from Seema Aunty", file: { name: "Shivani Malik Biodata.pdf", base64: PDF },
    fields: { name: "Shivani Malik", height: "5 ft 7 in", city: "Delhi", community: "Jain", contact: "Father 98xxxxxx" } });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.created, true); assert.equal(r.heightFit, "fail"); assert.equal(r.stage, "New");
  assert.equal(saved[0].folder, "folder1");
  const d = (await getDoc(`candidates/${r.id}`)).fields;
  assert.equal(d.heightIn.integerValue, "67"); assert.equal(d.stage.stringValue, "New");
  assert.match(d.pdfUrl.stringValue, /^https:\/\/drive\.google\.com\/file\/d\/FILE1/);
  assert.equal(d.viewers.arrayValue.values, undefined); // shared with no one
  const p = (await getDoc(`candidates/${r.id}/private/notes`)).fields;
  assert.match(p.source.stringValue, /Seema Aunty bot/); assert.equal(p.contact.stringValue, "Father 98xxxxxx");
});
test("same name again fills gaps only and attaches the new PDF", async () => {
  const r = post({ secret: SECRET, file: { name: "shivani-v2.pdf", base64: PDF }, fields: { name: "shivani malik", city: "Mumbai", education: "MBA" } });
  assert.equal(r.updated, true);
  const d = (await getDoc(`candidates/${r.id}`)).fields;
  assert.equal(d.city.stringValue, "Delhi"); // not overwritten
  assert.equal(d.education.stringValue, "MBA");
  assert.match(d.pdfUrl.stringValue, /FILE2/);
});
test("PDF only, no fields: name comes from the file name", () => {
  const r = post({ secret: SECRET, file: { name: "Tanvi_G_Shah_Biodata_2024.pdf", base64: PDF } });
  assert.equal(r.ok, true); assert.equal(r.name, "Tanvi G Shah"); assert.equal(r.heightFit, "unknown");
});
test("Circle upload: only Harsh's verified sign-in is accepted", async () => {
  const mum = await tokenFor("mum@example.com", true);
  assert.equal(post({ idToken: mum, file: { name: "a.pdf", base64: PDF }, fields: { name: "A" } }).ok, false);
  const fake = await tokenFor("work.harshsheth@gmail.com", false);
  assert.equal(post({ idToken: fake, file: { name: "a.pdf", base64: PDF }, fields: { name: "A" } }).ok, false);
  await fetch(`${AU}/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
  const harsh = await tokenFor("work.harshsheth@gmail.com", true);
  const r = post({ idToken: harsh, file: { name: "Mansi Panchamia.pdf", base64: PDF }, fields: { height: "5'3\"" } });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.name, "Mansi Panchamia"); assert.equal(r.heightFit, "pass");
});
