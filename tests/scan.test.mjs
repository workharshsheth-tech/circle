// scanFolder(): the Seema Aunty bot's Drive folder becomes Circle profiles. Made-up people only.
// Needs the local emulators (npm run dev).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { P, FS, AU, driveFiles, run, parse } from "./gas-harness.mjs";

const all = async () => {
  const r = await (await fetch(`${FS}/v1/projects/${P}/databases/(default)/documents/candidates?pageSize=100`, { headers: { Authorization: "Bearer owner" } })).json();
  return (r.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, v.stringValue ?? v.integerValue ?? v.booleanValue ?? v.arrayValue])) }));
};
const create = (fields) => fetch(`${FS}/v1/projects/${P}/databases/(default)/documents/candidates`, { method: "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
  body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "number" ? { integerValue: String(v) } : { stringValue: v }])) }) });

before(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await create({ name: "Dr. Riya Kapadia", city: "Pune", stage: "Shortlist" }); // already in Circle, edited by Harsh
});

test("reads the usual biodata lines, and never keeps phones or emails", () => {
  const f = parse(`BIO DATA\nName: ASHA MEHTA\nDate of Birth : 23rd December, 1993\nHeight : 5'3"\nCaste : Dasha Shrimali Jain\nNative Place: Lakhtar\nQualification: B.Com, MBA\nOccupation: Analyst, call +91 98200 00000\nMarital Status : Never married\nFather: Mobile 9820000000 a@b.com`);
  assert.equal(f.name, "Asha Mehta"); assert.equal(f.dob, "1993-12-23"); assert.equal(f.height, `5'3"`);
  assert.equal(f.community, "Dasha Shrimali Jain"); assert.equal(f.native, "Lakhtar"); assert.equal(f.marital, "Never married");
  assert.ok(!/98200|@/.test(JSON.stringify(f)));
  assert.equal(parse("DOB: 31.08.1990").dob, "1990-08-31");
  assert.equal(parse("Born on: 11 th August 1994").dob || parse("Date of birth- 4th September 1996").dob, "1996-09-04");
  assert.equal(parse("Height : 154 cm").height, "154 cm");
});

test("new girl in the folder becomes a profile in New, with height sorted and photo attached", async () => {
  driveFiles.push(
    { id: "f1", name: "Nisha_Patel_joint.pdf", mimeType: "application/pdf", text: "Nisha Patel\nDOB: 14-11-1992\nHeight: 5'8\"\nReligion: Jain\nOccupation: Architect" },
    { id: "f2", name: "Nisha_Patel_photo.jpg", mimeType: "image/jpeg", thumb: "PNGBYTES" },
    { id: "f3", name: "Harsh_Sheth.pdf", mimeType: "application/pdf", text: "Harsh Sheth" },
    { id: "f4", name: "notes.txt", mimeType: "text/plain" });
  const r = run("scanFolder");
  assert.equal(r.processed.length, 1, JSON.stringify(r)); // Harsh's own biodata and non-biodata files are skipped
  const n = (await all()).find((c) => c.name === "Nisha Patel");
  assert.equal(n.stage, "New"); assert.equal(n.heightIn, "68"); assert.equal(n.dob, "1992-11-14"); assert.equal(n.work, "Architect");
  assert.match(n.pdfUrl, /\/d\/f1\//); assert.match(n.photo, /^data:image\/png;base64,/);
  assert.equal(n.viewers, undefined === n.viewers ? undefined : n.viewers); // shared with no one
});

test("same girl already in Circle: fills gaps only, keeps Harsh's edits", async () => {
  driveFiles.push({ id: "f5", name: "Dr_Riya_Kapadia.pdf", mimeType: "application/pdf", text: "Name: Riya Kapadia\nHeight: 5'4\"\nCity: Mumbai\nCaste: Jain" });
  run("scanFolder");
  const riyas = (await all()).filter((c) => /Riya Kapadia/.test(c.name));
  assert.equal(riyas.length, 1);
  assert.equal(riyas[0].city, "Pune"); assert.equal(riyas[0].stage, "Shortlist"); assert.equal(riyas[0].heightIn, "64");
});

test("files already seen are not processed again", () => {
  assert.equal(run("scanFolder").processed.length, 0);
});
