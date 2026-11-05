// Firebase web config. These values are public by design (they only name the project);
// access is controlled by firestore.rules. Never put a service-account / admin key here.
// Replace with the values from Firebase console > Project settings > Your apps > Web app.
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
// Must match the owner email in firestore.rules.
export const OWNER_EMAIL = "work.harshsheth@gmail.com";
