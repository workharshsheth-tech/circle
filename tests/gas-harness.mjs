// Runs apps-script/Code.gs in Node with small stand-ins for Apps Script services,
// writing to the local Firestore + Auth emulators. Shared by intake.test.mjs and e2e.mjs.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
export const P = "demo-family-review";
export const FS = "http://127.0.0.1:8080", AU = "http://127.0.0.1:9099";
export const SECRET = "test-secret-0123456789abcdefghij";
const props = { PROJECT_ID: P, API_KEY: "demo-key", FOLDER_ID: "folder1", BOT_SECRET: SECRET, OWNER_EMAIL: "work.harshsheth@gmail.com",
  FIRESTORE_BASE: FS, IDTK_BASE: AU + "/identitytoolkit.googleapis.com" };
export const saved = [];
function curl(url, opt = {}) {
  const args = ["-s", "-L", "-w", "\n%{http_code}", "-X", (opt.method || "get").toUpperCase(), url];
  for (const [k, v] of Object.entries(opt.headers || {})) args.push("-H", `${k}: ${v}`);
  if (opt.payload != null) args.push("-H", `Content-Type: ${opt.contentType || "application/json"}`, "--data-binary", opt.payload);
  const out = execFileSync("curl", args, { encoding: "utf8" });
  const i = out.lastIndexOf("\n");
  const text = out.slice(0, i), code = +out.slice(i + 1);
  return { getResponseCode: () => code, getContentText: () => text, getBlob: () => blob(Buffer.from(text), "application/pdf", "") };
}
function blob(bytes, type, name) { let n = name; return { bytes, type, getName: () => n, setName: (x) => { n = x; } }; }
const ctx = vm.createContext({
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  UrlFetchApp: { fetch: curl },
  ScriptApp: { getOAuthToken: () => "owner" },
  Utilities: { base64Decode: (b) => Buffer.from(b, "base64"), newBlob: blob },
  DriveApp: { getFolderById: (id) => ({ createFile: (b) => { saved.push({ folder: id, name: b.getName() }); const fid = "FILE" + saved.length + "_abcdefghijklmnopqrstuvwxyz"; return { getId: () => fid, getName: () => b.getName() }; } }) },
});
vm.runInContext(readFileSync("apps-script/Code.gs", "utf8"), ctx);
export const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
