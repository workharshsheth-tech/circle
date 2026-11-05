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
test("owner can do everything", async () => {
  const db = as(OWNER);
  await assertSucceeds(getDocs(collection(db, "candidates")));
  await assertSucceeds(getDoc(doc(db, "candidates", "a", "private", "notes")));
  await assertSucceeds(getDocs(collection(db, "candidates", "a", "reviews")));
  await assertSucceeds(setDoc(doc(db, "members", OUT), { name: "x", role: "reviewer", active: true }));
});
