// Circle intake. BUILD 7
// Runs as Harsh. Three ways a biodata reaches Circle:
//  1. scanFolder(): every 15 minutes it looks in the Drive folder where the Seema Aunty bot saves biodatas
//     ("From chat"), reads each new PDF / image, and adds or fills in the profile. No change to the bot needed.
//  2. Circle's "Upload PDF" button (web app, checked against Harsh's own sign-in).
//  3. Optional: the bot posts directly with BOT_SECRET (see docs/seema-bot.md).
// First time: run setupCheck(), then installTrigger(), from the Run menu.
//
// Script properties (Project settings > Script properties), never in code or chat:
//   PROJECT_ID     Firebase project id
//   API_KEY        Firebase web apiKey (public; used only to check Harsh's sign-in)
//   FOLDER_ID      Drive folder id for the PDFs
//   BOT_SECRET     optional; only if the bot should post directly. At least 24 random characters
//   OWNER_EMAIL    work.harshsheth@gmail.com
//   FIRESTORE_BASE, IDTK_BASE (tests only) overrides for the Firestore and sign-in check addresses

var STAGES = ["New", "Mothers in touch", "Biodatas exchanged", "Janmakshar received", "With Harshaben", "Families meet", "Harsh meets her", "Going ahead", "On hold", "Pass"];
var TEXT_FIELDS = ["name", "dob", "community", "native", "city", "education", "work", "family", "marital", "diet", "about"];
var HARSH_HEIGHT_IN = 66;

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ""; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() { return json_({ ok: true, app: "Circle intake" }); }

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var who = authorise_(body);
    if (!who) return json_({ ok: false, error: "not allowed" });
    return json_(intake_(body, who));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// Bot: matching secret. Circle: Harsh's Firebase ID token, checked with Google.
function authorise_(body) {
  var secret = prop_("BOT_SECRET");
  if (body.secret && secret && secret.length >= 24 && body.secret === secret) return "bot";
  if (body.idToken) {
    var r = UrlFetchApp.fetch((prop_("IDTK_BASE") || "https://identitytoolkit.googleapis.com") + "/v1/accounts:lookup?key=" + encodeURIComponent(prop_("API_KEY")), {
      method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: body.idToken }), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    var u = (JSON.parse(r.getContentText()).users || [])[0];
    if (u && u.emailVerified && String(u.email).toLowerCase() === prop_("OWNER_EMAIL").toLowerCase()) return "harsh";
  }
  return null;
}

function intake_(body, who) {
  var f = body.fields || {};
  var c = {};
  TEXT_FIELDS.forEach(function (k) { if (f[k] != null && String(f[k]).trim()) c[k] = String(f[k]).trim().slice(0, 2000); });
  if (f.age && +f.age) c.age = Math.round(+f.age);
  var h = parseHeight_(f.heightIn != null ? f.heightIn : f.height);
  if (h) c.heightIn = h;

  // 1. The PDF: a fresh upload, a public link (e.g. the bot's file link), or a file already in Drive.
  var file = null;
  if (body.file && body.file.base64) {
    var blob = Utilities.newBlob(Utilities.base64Decode(body.file.base64), body.file.mimeType || "application/pdf", body.file.name || "biodata.pdf");
    file = saveToFolder_(blob);
  } else if (body.fileUrl) {
    var res = UrlFetchApp.fetch(body.fileUrl, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) throw new Error("could not download the file");
    var b = res.getBlob(); if (!b.getName()) b.setName(body.fileName || "biodata.pdf");
    file = saveToFolder_(b);
  } else if (body.driveFileId) {
    file = { id: body.driveFileId, name: "" };
  }
  if (file) c.pdfUrl = "https://drive.google.com/file/d/" + file.id + "/view";
  if (!c.name) c.name = file && file.name ? nameFromFile_(file.name) : "";
  if (!c.name) throw new Error("no name and no file");

  // 2. Same name already in Circle? Fill in what's missing and attach the PDF; never overwrite Harsh's edits.
  var existing = findByName_(c.name);
  var heightFit = c.heightIn ? (c.heightIn <= HARSH_HEIGHT_IN ? "pass" : "fail") : "unknown";
  var source = { bot: "Seema Aunty bot", folder: "Seema Aunty · From chat folder", harsh: "Uploaded in Circle" }[who] || who;
  if (existing) {
    var patch = {};
    Object.keys(c).forEach(function (k) { if (existing.data[k] == null || existing.data[k] === "") patch[k] = c[k]; });
    if (c.pdfUrl) patch.pdfUrl = c.pdfUrl;
    patch.updatedAt = new Date();
    fsPatch_("candidates/" + existing.id, patch);
    return { ok: true, id: existing.id, updated: true, name: existing.data.name, heightFit: heightFit, filled: Object.keys(patch) };
  }

  // 3. New profile: stage New, shared with no one until Harsh ticks people.
  var stage = STAGES.indexOf(f.stage) >= 0 ? f.stage : "New";
  var doc = Object.assign({}, c, { stage: stage, photo: "", sharedWith: [], viewers: [], hidden: false, archived: false,
    createdAt: new Date(), updatedAt: new Date() });
  var id = fsCreate_("candidates", doc);
  var priv = { source: source + (body.source ? " · " + String(body.source).slice(0, 200) : "") };
  if (f.contact) priv.contact = String(f.contact).slice(0, 300);
  if (f.notes) priv.notes = String(f.notes).slice(0, 2000);
  fsPatch_("candidates/" + id + "/private/notes", priv);
  return { ok: true, id: id, created: true, name: c.name, heightFit: heightFit, stage: stage };
}

function saveToFolder_(blob) {
  var f = DriveApp.getFolderById(prop_("FOLDER_ID")).createFile(blob);
  return { id: f.getId(), name: f.getName() };
}
function nameFromFile_(n) {
  return String(n).replace(/\.[a-z0-9]+$/i, "").replace(/[_\-]+/g, " ")
    .replace(/\b(bio ?data|biodata|resume|profile|pdf|final|new|joint|photo|photos|pic|pics|scan|\d{4}|\(\d+\))\b/ig, " ").replace(/\s+/g, " ").trim();
}
function parseHeight_(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 100 ? Math.round(v / 2.54) : Math.round(v);
  var s = String(v).toLowerCase().trim(), m;
  if (/cm/.test(s) && (m = s.match(/(\d{3})/))) return Math.round(+m[1] / 2.54);
  if ((m = s.match(/(\d)\s*(?:ft|feet|foot|'|′|’|\.|\s)\s*(\d{1,2})?/))) return +m[1] * 12 + (+m[2] || 0);
  if (/^\d+$/.test(s)) return +s > 100 ? Math.round(+s / 2.54) : +s;
  return null;
}

// ---- Firestore REST, as Harsh (project owner), so security rules don't apply here ----
function fsBase_() {
  return (prop_("FIRESTORE_BASE") || "https://firestore.googleapis.com") + "/v1/projects/" + prop_("PROJECT_ID") + "/databases/(default)/documents";
}
function fsFetch_(path, opt) {
  // X-Goog-User-Project: count the calls against Circle's own Firebase project, where Firestore is switched on.
  opt.headers = { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Goog-User-Project": prop_("PROJECT_ID") };
  opt.muteHttpExceptions = true; opt.contentType = "application/json";
  var r = UrlFetchApp.fetch(fsBase_() + path, opt);
  if (r.getResponseCode() >= 300) throw new Error("Firestore " + r.getResponseCode() + ": " + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText() || "{}");
}
function fsCreate_(coll, obj) {
  var r = fsFetch_("/" + coll, { method: "post", payload: JSON.stringify({ fields: toFs_(obj) }) });
  return r.name.split("/").pop();
}
function fsPatch_(path, obj) {
  var mask = Object.keys(obj).map(function (k) { return "updateMask.fieldPaths=" + encodeURIComponent(k); }).join("&");
  return fsFetch_("/" + path + "?" + mask, { method: "patch", payload: JSON.stringify({ fields: toFs_(obj) }) });
}
function findByName_(name) {
  var all = fsFetch_(":runQuery", { method: "post", payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: "candidates" }], select: { fields: [{ fieldPath: "name" }].concat(TEXT_FIELDS.concat(["heightIn", "pdfUrl", "age"]).map(function (k) { return { fieldPath: k }; })) } } }) });
  var key = normName_(name);
  for (var i = 0; i < all.length; i++) {
    var d = all[i].document; if (!d) continue;
    var data = fromFs_(d.fields || {});
    if (normName_(data.name) === key) return { id: d.name.split("/").pop(), data: data };
  }
  return null;
}
function normName_(n) { return String(n || "").toLowerCase().replace(/^dr\.?\s+/, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim(); }

function toFs_(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { out[k] = val_(obj[k]); });
  return out;
}
function val_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val_) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function fromFs_(fields) {
  var out = {};
  Object.keys(fields).forEach(function (k) {
    var v = fields[k];
    out[k] = "stringValue" in v ? v.stringValue : "integerValue" in v ? +v.integerValue : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue : null;
  });
  return out;
}


// ===================== Folder watcher: the Seema Aunty bot's "From chat" folder =====================
var MAX_PER_RUN = 6; // stay well inside Apps Script's 6-minute limit

function scanFolder() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: "already running" };
  try {
    var props = PropertiesService.getScriptProperties();
    var owner = normName_(prop_("OWNER_NAME") || "Harsh Sheth");
    var groups = {}, it = DriveApp.getFolderById(prop_("FOLDER_ID")).getFiles();
    while (it.hasNext()) {
      var f = it.next(), mt = f.getMimeType();
      if (!/^application\/pdf$|^image\//.test(mt)) continue;
      var name = nameFromFile_(f.getName()), key = normName_(name);
      if (!key || key === owner) continue;
      (groups[key] = groups[key] || { name: name, files: [] }).files.push(f);
    }
    var done = [], keys = Object.keys(groups);
    for (var i = 0; i < keys.length && done.length < MAX_PER_RUN; i++) {
      var g = groups[keys[i]];
      var fresh = g.files.filter(function (f) { return !props.getProperty("seen:" + f.getId()); });
      if (!fresh.length) continue;
      done.push(intakeGroup_(g));
      g.files.forEach(function (f) { props.setProperty("seen:" + f.getId(), "1"); });
    }
    console.log("scanFolder: " + JSON.stringify(done));
    return { ok: true, processed: done };
  } finally { lock.releaseLock(); }
}

// One girl's files: the biodata (PDF first, else an image that isn't just a photo) and a photo if there is one.
function intakeGroup_(g) {
  var isPhoto = function (f) { return /photo|pic|img|dp/i.test(f.getName()) && /^image\//.test(f.getMimeType()); };
  var doc = g.files.filter(function (f) { return f.getMimeType() === "application/pdf"; })[0]
         || g.files.filter(function (f) { return !isPhoto(f); })[0] || g.files[0];
  var photo = g.files.filter(isPhoto)[0];
  var fields = {};
  try { fields = parseBiodata_(ocrText_(doc)); } catch (e) { console.warn("could not read " + doc.getName() + ": " + e); }
  fields.name = fields.name && normName_(fields.name) === normName_(g.name) ? fields.name : g.name;
  var r = intake_({ driveFileId: doc.getId(), fields: fields, source: doc.getName() }, "folder");
  if (photo && r.ok) {
    var cur = fsFetch_("/candidates/" + r.id, { method: "get" });
    var has = cur.fields && cur.fields.photo && cur.fields.photo.stringValue;
    if (!has) {
      var thumb = photo.getThumbnail();
      if (thumb) fsPatch_("candidates/" + r.id, { photo: "data:image/png;base64," + Utilities.base64Encode(thumb.getBytes()) });
    }
  }
  return { name: r.name, id: r.id, created: !!r.created, heightFit: r.heightFit };
}

// Text of a PDF or image, via Google Drive's own text recognition. The temporary Google Doc is deleted right away.
function ocrText_(file) {
  var tmp = Drive.Files.create({ name: "circle-ocr-tmp", mimeType: "application/vnd.google-apps.document" }, file.getBlob(), { ocrLanguage: "en", fields: "id" });
  try {
    var r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + tmp.id + "/export?mimeType=text/plain",
      { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    return r.getContentText();
  } finally { Drive.Files.remove(tmp.id); }
}

// Pull the usual biodata lines. Leaves out phones, emails and addresses on purpose.
var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseBiodata_(text) {
  var t = String(text || "").replace(/\r/g, "").replace(/[•⚫●▪]/g, "\n");
  // Some biodatas put several labels on one line: stop a value where the next label starts.
  var NEXT = /\s(?:address|native|religion|marital|profession|occupation|caste|cast|place|time|height|education|qualification|weight|email|contact)\b(?:\s+(?:status|place|details|no))?\s*[:\-]/i;
  var line = function (re) {
    var m = t.match(re); if (!m) return "";
    var v = m[1].split(NEXT)[0];
    return v.replace(/\s+/g, " ").replace(/[|,;.\s]+$/, "").trim();
  };
  var out = {};
  var nm = line(/^\s*name\s*[:\-]\s*([^\n]{3,60})/im); if (nm) out.name = titleCase_(nm);
  var h = line(/height\s*[:\-]?\s*([0-9][^\n]{0,20})/i); if (h) out.height = h;
  var dob = line(/(?:date of birth|d\.?o\.?b\.?|birth ?date|born on|birth details\s*:\s*date)\s*[:\-]?\s*([^\n|]{6,30})/i);
  var d = parseDate_(dob); if (d) out.dob = d;
  out.community = line(/(?:sub caste|caste|cast|religion|community)\s*[:\-]\s*([^\n]{3,60})/i);
  out.native = line(/native(?: place)?\s*[:\-]\s*([^\n]{2,50})/i);
  out.education = line(/(?:qualification|education)\s*[:\-]\s*([^\n]{3,120})/i);
  out.work = line(/(?:occupation|profession|current work|currently working)\s*[:\-]?\s*([^\n]{3,120})/i);
  out.marital = line(/marital status\s*[:\-]\s*([^\n]{3,60})/i);
  Object.keys(out).forEach(function (k) {
    if (k !== "dob" && k !== "height") out[k] = String(out[k]).replace(/\+?\d[\d\s\-]{8,}\d/g, "").replace(/\S+@\S+/g, "").trim(); // no phones/emails
    if (!out[k]) delete out[k];
  });
  return out;
}
function parseDate_(s) {
  if (!s) return "";
  var m = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (m) return m[3] + "-" + pad_(m[2]) + "-" + pad_(m[1]);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*,?\s+(\d{4})/i);
  if (m && MONTHS[m[2].toLowerCase()]) return m[3] + "-" + pad_(MONTHS[m[2].toLowerCase()]) + "-" + pad_(m[1]);
  m = s.match(/([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m && MONTHS[m[1].toLowerCase()]) return m[3] + "-" + pad_(MONTHS[m[1].toLowerCase()]) + "-" + pad_(m[2]);
  return "";
}
function pad_(n) { return ("0" + n).slice(-2); }
function titleCase_(s) { return s.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }

// ===================== One-time setup helpers (Run menu) =====================
function setupCheck() {
  var need = ["PROJECT_ID", "API_KEY", "FOLDER_ID", "OWNER_EMAIL"], miss = need.filter(function (k) { return !prop_(k); });
  if (miss.length) { console.log("Missing script properties: " + miss.join(", ")); return; }
  console.log("Folder: " + DriveApp.getFolderById(prop_("FOLDER_ID")).getName());
  var r = fsFetch_(":runQuery", { method: "post", payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: "candidates" }], limit: 50 } }) });
  console.log("Circle profiles found: " + r.filter(function (x) { return x.document; }).length);
  console.log("All good. Now run installTrigger.");
}
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "scanFolder") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("scanFolder").timeBased().everyMinutes(15).create();
  console.log("Circle now checks the folder every 15 minutes.");
}
