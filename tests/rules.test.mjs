// Firestore rules tests. Run: npm test (starts the Firestore emulator).
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, addDoc, updateDoc, collection, query, where } from "firebase/firestore";

const OWNER = "work.harshsheth@gmail.com", MUM = "mum@example.com", SIS = "sis@example.com", OUT = "stranger@example.com";
let env;
const as = (email) => env.authenticatedContext(email.split("@")[0], { email, email_verified: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-family-review",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "members", MUM), { name: "Mummy", role: "reviewer", active: true });
    await setDoc(doc(db, "members", SIS), { name: "Didi", role: "reviewer", active: false });
    await setDoc(doc(db, "candidates", "a"), { name: "A", sharedWith: [MUM, SIS], viewers: [MUM, SIS] });
    await setDoc(doc(db, "candidates", "b"), { name: "B", sharedWith: [], viewers: [] });
    await setDoc(doc(db, "candidates", "a", "private", "notes"), { contact: "x" });
    await setDoc(doc(db, "candidates", "a", "reviews", "other@example.com"), { stars: 2, name: "O" });
  });
});

test("stranger and unverified users get nothing", async () => {
  await assertFails(getDoc(doc(as(OUT), "candidates", "a")));
  const unverified = env.authenticatedContext("u", { email: MUM, email_verified: false }).firestore();
  await assertFails(getDoc(doc(unverified, "candidates", "a")));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "candidates", "a")));
});
test("reviewer sees only shared profiles, and cannot list all", async () => {
  const db = as(MUM);
  await assertSucceeds(getDoc(doc(db, "candidates", "a")));
  await assertFails(getDoc(doc(db, "candidates", "b")));
  await assertFails(getDocs(collection(db, "candidates")));
  await assertSucceeds(getDocs(query(collection(db, "candidates"), where("viewers", "array-contains", MUM))));
});
test("paused reviewer sees nothing", async () => {
  await assertFails(getDoc(doc(as(SIS), "candidates", "a")));
});
test("reviewer cannot read private notes or edit profiles or members", async () => {
  const db = as(MUM);
  await assertFails(getDoc(doc(db, "candidates", "a", "private", "notes")));
  await assertFails(updateDoc(doc(db, "candidates", "a"), { stage: "Talking" }));
  await assertFails(updateDoc(doc(db, "candidates", "a"), { viewers: [MUM, OUT] }));
  await assertFails(setDoc(doc(db, "members", OUT), { name: "x", role: "reviewer", active: true }));
  await assertFails(getDocs(collection(db, "members")));
});
test("rating is blind until you rate, one per person, 1-5 only", async () => {
  const db = as(MUM);
  await assertFails(getDocs(collection(db, "candidates", "a", "reviews")));
  await assertFails(setDoc(doc(db, "candidates", "a", "reviews", "other@example.com"), { stars: 5, name: "Mummy" }));
  await assertFails(setDoc(doc(db, "candidates", "a", "reviews", MUM), { stars: 6, name: "Mummy" }));
  await assertFails(setDoc(doc(db, "candidates", "b", "reviews", MUM), { stars: 4, name: "Mummy" }));
  await assertSucceeds(setDoc(doc(db, "candidates", "a", "reviews", MUM), { stars: 4, name: "Mummy" }));
  await assertSucceeds(getDocs(collection(db, "candidates", "a", "reviews")));
});
test("comments: as yourself only, edit own only", async () => {
  const db = as(MUM);
  await assertFails(addDoc(collection(db, "candidates", "a", "comments"), { email: OWNER, name: "Harsh", text: "fake", createdAt: 1 }));
  await assertFails(addDoc(collection(db, "candidates", "b", "comments"), { email: MUM, name: "Mummy", text: "hi", createdAt: 1 }));
  const ref = await assertSucceeds(addDoc(collection(db, "candidates", "a", "comments"), { email: MUM, name: "Mummy", text: "Nice family", createdAt: 1 }));
  await assertSucceeds(updateDoc(ref, { text: "Very nice family", editedAt: 2 }));
  await assertFails(updateDoc(doc(as(OWNER), "candidates", "a", "comments", ref.id), { text: "changed by Harsh" }));
  await assertFails(updateDoc(ref, { email: OUT }));
});
test("intake settings are owner-only", async () => {
  await assertFails(getDoc(doc(as(MUM), "admin", "settings")));
  await assertFails(setDoc(doc(as(MUM), "admin", "settings"), { intakeUrl: "https://evil.example" }));
  await assertSucceeds(setDoc(doc(as(OWNER), "admin", "settings"), { intakeUrl: "https://script.google.com/macros/s/x/exec" }));
});
test("family's part: shared family can fill it, nobody else, only known fields", async () => {
  const ok = { motherContacted: true, contactedOn: "2026-11-05", biodataExchanged: false, kundli: "Pending", familyFeedback: "Warm family", updatedBy: "Mummy", updatedAt: 1 };
  await assertSucceeds(setDoc(doc(as(MUM), "candidates", "a", "progress", "family"), ok));
  await assertSucceeds(getDoc(doc(as(MUM), "candidates", "a", "progress", "family")));
  await assertFails(setDoc(doc(as(MUM), "candidates", "b", "progress", "family"), ok));
  await assertFails(setDoc(doc(as(OUT), "candidates", "a", "progress", "family"), ok));
  await assertFails(setDoc(doc(as(MUM), "candidates", "a", "progress", "family"), { ...ok, kundli: "Maybe" }));
  await assertFails(setDoc(doc(as(MUM), "candidates", "a", "progress", "family"), { ...ok, stage: "Going ahead" }));
  await assertFails(getDoc(doc(as(MUM), "admin", "criteria")));
  const jm = { ...ok, birthName: "A", birthDate: "1993-12-23", birthTime: "05:48", birthPlace: "Mumbai", sentToHarshaben: true, sentOn: "2026-11-06", harshabenNotes: "Good match" };
  await assertSucceeds(setDoc(doc(as(MUM), "candidates", "a", "progress", "family"), jm));
  // A re-check: round 2, with round 1's "No match" kept on record. Rounds are capped and must be a list.
  const rc = { ...jm, kundli: "Pending", harshabenNotes: "", round: 2, rounds: [{ round: 1, sentOn: "2026-11-06", result: "No match", notes: "Nadi dosh" }] };
  await assertSucceeds(setDoc(doc(as(MUM), "candidates", "a", "progress", "family"), rc));
  await assertFails(setDoc(doc(as(MUM), "candidates", "a", "progress", "family"), { ...rc, round: 0 }));
  await assertFails(setDoc(doc(as(MUM), "candidates", "a", "progress", "family"), { ...rc, rounds: "round 1 no match" }));
});
test("family can move the stage along their part only, never Harsh's fields", async () => {
  await assertSucceeds(updateDoc(doc(as(MUM), "candidates", "a"), { familyStage: "Waiting for Harshaben", harshaben: "", sentOn: "2026-11-05" }));
  await assertFails(updateDoc(doc(as(MUM), "candidates", "a"), { familyStage: "Going ahead" }));
  // Harshaben's "No match" parks her under Harshaben: no match; a re-check brings her back to Waiting with the round count.
  await assertSucceeds(updateDoc(doc(as(MUM), "candidates", "a"), { familyStage: "Harshaben: no match", harshaben: "No match", sentOn: "2026-11-05", hbRound: 1 }));
  await assertSucceeds(updateDoc(doc(as(MUM), "candidates", "a"), { familyStage: "Waiting for Harshaben", harshaben: "Pending", sentOn: "2026-11-12", hbRound: 2 }));
  await assertFails(updateDoc(doc(as(MUM), "candidates", "a"), { familyStage: "Pass" }));
  await assertFails(updateDoc(doc(as(MUM), "candidates", "a"), { familyStage: "Waiting for Harshaben", hbRound: "two" }));
  await assertFails(updateDoc(doc(as(MUM), "candidates", "a"), { stage: "Pass" }));
  await assertFails(updateDoc(doc(as(MUM), "candidates", "a"), { familyStage: "Harshaben matched", viewers: [MUM, OUT] }));
  await assertFails(updateDoc(doc(as(MUM), "candidates", "b"), { familyStage: "Mothers in touch" }));
});
test("owner can do everything", async () => {
  const db = as(OWNER);
  await assertSucceeds(getDocs(collection(db, "candidates")));
  await assertSucceeds(getDoc(doc(db, "candidates", "a", "private", "notes")));
  await assertSucceeds(getDocs(collection(db, "candidates", "a", "reviews")));
  await assertSucceeds(setDoc(doc(db, "members", OUT), { name: "x", role: "reviewer", active: true }));
});
