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
// Fake Drive folder for scanFolder(): { id, name, mimeType, text, thumb }
export const driveFiles = [];
// Optional folder tree for recursive lanes: { id: { name, files: [fileId], folders: [folderId] } }
export const driveFolders = {};
export const triggers = [];
const iter = (a) => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
const folderObj = (id) => { const d = driveFolders[id]; return { getName: () => d.name,
  getFiles: () => iter(d.files.map((fid) => fileObj(driveFiles.find((x) => x.id === fid)))),
  getFolders: () => iter((d.folders || []).map(folderObj)) }; };
const fileObj = (f) => ({ isTrashed: () => !!f.trashed, getId: () => f.id, getName: () => f.name, getMimeType: () => f.mimeType,
  getBlob: () => ({ fileId: f.id, getBytes: () => [...(f.bytes || [])] }), getThumbnail: () => (f.thumb ? { getBytes: () => Buffer.from(f.thumb) } : null) });
function curl(url, opt = {}) {
  const ex = url.match(/drive\/v3\/files\/ocr_(.+)\/export/);
  if (ex) { const f = driveFiles.find((x) => x.id === ex[1]); return { getResponseCode: () => 200, getContentText: () => f?.text || "" }; }
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
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  UrlFetchApp: { fetch: curl },
  ScriptApp: { getOAuthToken: () => "owner", getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: (fn) => { const b = { timeBased: () => b, after: () => b, everyMinutes: () => b, create: () => triggers.push({ getHandlerFunction: () => fn }) }; return b; } },
  Utilities: { base64Decode: (b) => Buffer.from(b, "base64"), base64Encode: (b) => Buffer.from(b).toString("base64"), newBlob: blob },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Drive: { Files: { create: (meta, blob) => ({ id: "ocr_" + blob.fileId }), remove() {} } },
  console: { log() {}, warn() {} },
  DriveApp: { getFileById: (id) => fileObj(driveFiles.find((x) => x.id === id)), getFolderById: (id) => driveFolders[id] ? folderObj(id) : ({ getName: () => "From chat", getFiles: () => { let i = 0; return { hasNext: () => i < driveFiles.length, next: () => fileObj(driveFiles[i++]) }; }, createFile: (b) => { saved.push({ folder: id, name: b.getName() }); const fid = "FILE" + saved.length + "_abcdefghijklmnopqrstuvwxyz"; driveFiles.push({ id: fid, name: b.getName(), mimeType: "application/pdf" }); return { getId: () => fid, getName: () => b.getName() }; } }) },
});
vm.runInContext(readFileSync("apps-script/Code.gs", "utf8"), ctx);
export const props_ = props;
export const run = (fn) => vm.runInContext(fn + "()", ctx);
export const parse = (t) => JSON.parse(JSON.stringify(vm.runInContext("parseBiodata_", ctx)(t)));
export const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
