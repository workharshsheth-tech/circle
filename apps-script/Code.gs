// Circle intake. BUILD 3
// Runs as Harsh (web app, "Execute as: me"). Takes a biodata PDF from the Seema Aunty bot or from
// Circle's "Upload biodata PDF", saves it in Harsh's Drive folder and adds or updates the profile in Circle.
// Nobody gets in without either the bot secret or Harsh's own signed-in Circle session.
//
// Script properties (Project settings > Script properties), never in code or chat:
//   PROJECT_ID     Firebase project id
//   API_KEY        Firebase web apiKey (public; used only to check Harsh's sign-in)
//   FOLDER_ID      Drive folder id for the PDFs
//   BOT_SECRET     long random text; the same text goes into the bot's settings
//   OWNER_EMAIL    work.harshsheth@gmail.com
//   FIRESTORE_BASE, IDTK_BASE (tests only) overrides for the Firestore and sign-in check addresses

var STAGES = ["New", "In review", "Shortlist", "Shared", "Talking", "Meeting", "On hold", "Pass"];
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
  var source = who === "bot" ? "Seema Aunty bot" : "Uploaded in Circle";
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
    .replace(/\b(bio ?data|biodata|resume|profile|pdf|final|new|\d{4}|\(\d+\))\b/ig, " ").replace(/\s+/g, " ").trim();
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
  opt.headers = { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
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
