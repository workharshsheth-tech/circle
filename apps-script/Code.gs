// Circle intake. BUILD 18
// Runs as Harsh. Three ways a biodata reaches Circle:
//  1. scanFolder(): every 15 minutes it looks in the Drive folder where the Seema Aunty bot saves biodatas
//     ("From chat"), reads each new PDF / image, and adds or fills in the profile. No change to the bot needed.
//  2. Circle's "Upload PDF" button (web app, checked against Harsh's own sign-in).
//  3. Optional: the bot posts directly with BOT_SECRET (see docs/seema-bot.md).
//  5. readAllBiodatas(): one-time re-read of every profile's biodata for birth date, time, place and native
//     (fills only empty fields). Runs in rounds by itself; readAllReport() prints what it found.
//  6. Bina's list refreshes about every 10 days: Circle's Sources tab has "Check Bina's folder" (updateBina), and a
//     daily check runs by itself (installTrigger). Only new files are read; repeats merge into the girl already there.
//  4. importBina(): one-time batch of Bina's "Divorced Brides 1990-1998" folder (year subfolders). It runs in
//     5-minute rounds by itself until every file is in Circle, then stops. binaReport() prints the counts.
// All lanes link each profile to the existing Drive file (no copies), remember every file id (seen:<id>), and
// merge by name: same girl → only empty fields are filled, never Harsh's edits.
// First time: run setupCheck(), then installTrigger(), from the Run menu.
//
// Script properties (Project settings > Script properties), never in code or chat:
//   PROJECT_ID     Firebase project id
//   API_KEY        Firebase web apiKey (public; used only to check Harsh's sign-in)
//   FOLDER_ID      Drive folder id of "From chat" (the live lane; Seema Aunty saves new biodatas only here)
//   BOT_SECRET     optional; only if the bot should post directly. At least 24 random characters
//   OWNER_EMAIL    work.harshsheth@gmail.com
//   FIRESTORE_BASE, IDTK_BASE (tests only) overrides for the Firestore and sign-in check addresses

var STAGES = ["New", "Mothers in touch", "Biodatas exchanged", "Janmakshar received", "Waiting for Harshaben", "Harshaben matched", "Families meet", "Harsh meets her", "Going ahead", "Harshaben: no match", "On hold", "Pass"];
var TEXT_FIELDS = ["name", "dob", "birthTime", "birthPlace", "community", "native", "city", "education", "work", "family", "marital", "diet", "about"];
var HARSH_HEIGHT_IN = 66;

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ""; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() { return json_({ ok: true, app: "Circle intake" }); }

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var who = authorise_(body);
    if (!who) return json_({ ok: false, error: "not allowed" });
    if (body.action === "updateBina") return json_(who === "harsh" ? updateBina_(true) : { ok: false, error: "not allowed" });
    if (body.action === "photos") return who === "harsh" ? json_(photoChoices_(body.fileId)) : json_({ ok: false, error: "not allowed" });
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

  var source = body.sourceLabel || { bot: "Seema Aunty", folder: "Seema Aunty", harsh: "Uploaded in Circle" }[who] || who;
  c.source = source;
  // 2. Same name already in Circle? Fill in what's missing and attach the PDF; never overwrite Harsh's edits.
  var existing = findByName_(c.name);
  var fit = function (h) { return h ? (h <= HARSH_HEIGHT_IN ? "pass" : "fail") : "unknown"; };
  var heightFit = fit(c.heightIn || (existing && existing.data.heightIn));
  if (existing) {
    var patch = {};
    Object.keys(c).forEach(function (k) { if (existing.data[k] == null || existing.data[k] === "") patch[k] = c[k]; });
    // A PDF Harsh uploads himself replaces the link; from folders and the bot it only fills an empty one.
    if (c.pdfUrl && who === "harsh") patch.pdfUrl = c.pdfUrl;
    // Her old file was deleted or trashed (e.g. Bina's list refreshed): point to the new copy instead.
    if (c.pdfUrl && existing.data.pdfUrl && c.pdfUrl !== existing.data.pdfUrl && !driveFileAlive_(existing.data.pdfUrl)) patch.pdfUrl = c.pdfUrl;
    patch.updatedAt = new Date();
    fsPatch_("candidates/" + existing.id, patch);
    return { ok: true, id: existing.id, updated: true, name: existing.data.name, heightFit: heightFit,
      filled: Object.keys(patch).filter(function (k) { return k !== "updatedAt"; }) };
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

function driveFileAlive_(url) {
  var m = String(url || "").match(/\/d\/([\w-]{20,})/);
  if (!m) return false;
  try { return !DriveApp.getFileById(m[1]).isTrashed(); } catch (e) { return false; }
}
function saveToFolder_(blob) {
  var f = DriveApp.getFolderById(prop_("FOLDER_ID")).createFile(blob);
  return { id: f.getId(), name: f.getName() };
}
function nameFromFile_(n) {
  n = String(n).replace(/\.[a-z0-9]+$/i, "");
  // Form uploads are named "Girl's name - original file name - who sent it": the girl's name comes first.
  if (/ - /.test(n)) n = n.split(" - ")[0];
  return n.replace(/[_\-]+/g, " ")
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
    from: [{ collectionId: "candidates" }], select: { fields: [{ fieldPath: "name" }].concat(TEXT_FIELDS.concat(["heightIn", "pdfUrl", "age", "source"]).map(function (k) { return { fieldPath: k }; })) } } }) });
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
  if (typeof v === "object") return { mapValue: { fields: toFs_(v) } };
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

// The live lane: "From chat", every 15 minutes.
function scanFolder() {
  return scanLane_({ folderId: prop_("FOLDER_ID"), source: "Seema Aunty", recurse: false, maxGroups: MAX_PER_RUN });
}

// Walk a folder (and its subfolders if asked), group files per girl, and send each new group to intake.
// Stops early when the time budget is used, so a big folder is done over several runs.
function scanLane_(o) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: "already running" };
  var t0 = Date.now(), budget = o.budgetMs || 270000;
  try {
    var props = PropertiesService.getScriptProperties();
    var owner = normName_(prop_("OWNER_NAME") || "Harsh Sheth");
    var groups = {};
    var walk = function (folder, path) {
      var it = folder.getFiles();
      while (it.hasNext()) {
        var f = it.next(), mt = f.getMimeType();
        if (!/^application\/pdf$|^image\//.test(mt) || (f.isTrashed && f.isTrashed())) continue;
        var name = nameFromFile_(f.getName()), key = normName_(name);
        if (!key || key === owner) continue;
        (groups[key] = groups[key] || { name: name, files: [], path: path }).files.push(f);
      }
      if (o.recurse && folder.getFolders) {
        var sub = folder.getFolders();
        while (sub.hasNext()) { var s = sub.next(); walk(s, path.concat([s.getName()])); }
      }
    };
    walk(DriveApp.getFolderById(o.folderId), []);
    var done = [], left = 0, already = 0, keys = Object.keys(groups);
    for (var i = 0; i < keys.length; i++) {
      var g = groups[keys[i]];
      var fresh = g.files.filter(function (f) { return !props.getProperty("seen:" + f.getId()); });
      if (!fresh.length) { already++; continue; }
      if ((o.maxGroups && done.length >= o.maxGroups) || Date.now() - t0 > budget) { left++; continue; }
      var r, why = o.preFilter ? o.preFilter(g) : null;
      if (why) r = { name: g.name, skipped: why };
      else { try { r = intakeGroup_(g, o); } catch (e) { r = { name: g.name, error: String(e && e.message || e) }; } }
      done.push(r);
      if (!r.error) g.files.forEach(function (f) { props.setProperty("seen:" + f.getId(), "1"); });
    }
    console.log("scan " + (o.source || "") + ": " + JSON.stringify(done));
    return { ok: true, processed: done, remaining: left, alreadyDone: already, total: keys.length };
  } finally { lock.releaseLock(); }
}

// One girl's files: the biodata (PDF first, else an image that isn't just a photo) and a photo if there is one.
function intakeGroup_(g, o) {
  o = o || {};
  var isPhoto = function (f) { return /photo|pic|img|dp/i.test(f.getName()) && /^image\//.test(f.getMimeType()); };
  var doc = g.files.filter(function (f) { return f.getMimeType() === "application/pdf"; })[0]
         || g.files.filter(function (f) { return !isPhoto(f); })[0] || g.files[0];
  // A lone image is her biodata, not a portrait: don't use the whole page as her photo.
  var photo = g.files.filter(function (f) { return f !== doc && isPhoto(f); })[0];
  var fields = {}, ocrMiss = false;
  try { fields = parseBiodata_(ocrText_(doc)); } catch (e) { console.warn("could not read " + doc.getName() + ": " + e); }
  ocrMiss = !Object.keys(fields).some(function (k) { return k !== "name"; });
  fields.name = fields.name && normName_(fields.name) === normName_(g.name) ? fields.name : g.name;
  if (o.defaults) o.defaults(fields, g);
  var why = o.filter ? o.filter(fields, g) : null;
  if (why) return { name: g.name, skipped: why, ocrMiss: ocrMiss };
  var r = intake_({ driveFileId: doc.getId(), fields: fields, source: (g.path || []).concat([doc.getName()]).join(" / "), sourceLabel: o.source }, "folder");
  if (r.ok) {
    var cur = fsFetch_("/candidates/" + r.id, { method: "get" });
    var has = cur.fields && cur.fields.photo && cur.fields.photo.stringValue;
    if (!has) {
      var url = "";
      if (photo) { var thumb = photo.getThumbnail(); if (thumb) url = "data:image/png;base64," + Utilities.base64Encode(thumb.getBytes()); }
      // No separate photo: take the best-looking picture inside the biodata PDF.
      if (!url && doc.getMimeType() === "application/pdf") {
        var best = pickPhoto_(extractJpegs_(doc.getBlob().getBytes()));
        if (best && best.bytes.length <= 350000) url = "data:image/jpeg;base64," + Utilities.base64Encode(best.bytes);
      }
      if (url) fsPatch_("candidates/" + r.id, { photo: url });
    }
  }
  if (r.ok) PropertiesService.getScriptProperties().setProperty("read15:" + r.id, "1");
  return { name: r.name, id: r.id, created: !!r.created, heightFit: r.heightFit, ocrMiss: ocrMiss };
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
  // Janmakshar details: time and place of birth (the most asked-for lines after native place).
  var bt = t.match(/(?:time of birth|birth\s*time|time\s*(?:\/|&|and)\s*place|birth details[^\n]*?time)\s*[:\-]?\s*(\d{1,2}\s*[:.]\s*\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?)/i)
        || (/birth|born|janm/i.test(t) && t.match(/\btime\s*[:\-]\s*(\d{1,2}\s*[:.]\s*\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?)/i));
  var tm = bt && normTime_(bt[1]); if (tm) out.birthTime = tm;
  var bp = line(/(?:place of birth|birth\s*place|born at|born in)\s*[:\-]?\s*([^\n|]{2,50})/i)
        || line(/time\s*(?:&|and|\/)\s*place\s*[:\-]?\s*[^&,\n]*?(?:&|,)\s*([A-Za-z][^\n|]{1,40})/i)
        || line(/birth\s*time\s*[:\-]?\s*\d{1,2}\s*[:.]\s*\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?\s*,\s*([A-Za-z][^\n|]{1,40})/i)
        || (/birth|born|janm/i.test(t) ? line(/(?:^|[|\n]|\s)(?<!native\s)(?<!work\s)(?<!office\s)place\s*[:\-]\s*([A-Za-z][^\n|]{1,40})/i) : "");
  if (bp) out.birthPlace = bp.replace(/\bIST\b/i, "").replace(/[,\s]+$/, "").trim();
  out.education = line(/(?:qualification|education)\s*[:\-]\s*([^\n]{3,120})/i);
  out.work = line(/(?:occupation|profession|current work|currently working)\s*[:\-]?\s*([^\n]{3,120})/i);
  out.marital = line(/marital status\s*[:\-]\s*([^\n]{3,60})/i);
  Object.keys(out).forEach(function (k) {
    if (k !== "dob" && k !== "height") out[k] = String(out[k]).replace(/\+?\d[\d\s\-]{8,}\d/g, "").replace(/\S+@\S+/g, "").trim(); // no phones/emails
    if (!out[k]) delete out[k];
  });
  return out;
}
// "1:10 pm", "5.48pm", "07:29 p.m.", "18:56" → "13:10" (24-hour, for the app's time field)
function normTime_(s) {
  var m = String(s || "").toLowerCase().replace(/\s+/g, "").match(/^(\d{1,2})[:.](\d{2})(a\.?m\.?|p\.?m\.?)?/);
  if (!m) return "";
  var h = +m[1], mi = +m[2], ap = m[3] ? m[3].charAt(0) : "";
  if (mi > 59 || h > 23) return "";
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return pad_(h) + ":" + pad_(mi);
}
function parseDate_(s) {
  if (!s) return "";
  var m = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (m) return m[3] + "-" + pad_(m[2]) + "-" + pad_(m[1]);
  m = s.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\s*,?\s*(\d{4})/i);
  if (m && MONTHS[m[2].toLowerCase()]) return m[3] + "-" + pad_(MONTHS[m[2].toLowerCase()]) + "-" + pad_(m[1]);
  m = s.match(/([a-z]{3})[a-z]*\s+(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*(\d{4})/i);
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
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "binaDaily") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("binaDaily").timeBased().everyDays(1).atHour(7).create();
  console.log("Circle now checks From chat every 15 minutes and Bina's folder every morning around 7.");
}

// ===================== Her photo from inside the biodata =====================
// Pictures in a PDF are usually stored as plain JPEG files. Find them, with their sizes.
function extractJpegs_(bytes) {
  var s = "", CH = 8192;
  for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.slice(i, i + CH).map(function (b) { return b & 255; }));
  var out = [], at = 0;
  while ((at = s.indexOf("/DCTDecode", at)) >= 0) {
    var st = s.indexOf("stream", at);
    if (st < 0) break;
    var start = st + 6;
    if (s.charAt(start) === "\r") start++;
    if (s.charAt(start) === "\n") start++;
    var end = s.indexOf("endstream", start);
    if (end < 0) break;
    var jpg = bytes.slice(start, end);
    var dim = jpegSize_(jpg);
    if (dim) out.push({ bytes: jpg, w: dim.w, h: dim.h });
    at = end;
  }
  return out;
}
function jpegSize_(b) {
  if ((b[0] & 255) !== 0xFF || (b[1] & 255) !== 0xD8) return null;
  for (var i = 2; i + 9 < b.length;) {
    if ((b[i] & 255) !== 0xFF) { i++; continue; }
    var m = b[i + 1] & 255, len = ((b[i + 2] & 255) << 8) | (b[i + 3] & 255);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
      return { h: ((b[i + 5] & 255) << 8) | (b[i + 6] & 255), w: ((b[i + 7] & 255) << 8) | (b[i + 8] & 255) };
    i += 2 + len;
  }
  return null;
}
// A face photo is usually upright or square and medium-sized; skip page backgrounds, banners and tiny icons.
function photoScore_(p) {
  var r = p.w / p.h;
  if (p.w < 120 || p.h < 120) return -1;
  if (r > 1.3 || r < 0.45) return -1;
  // A full-page picture (A4 shape, large) is the page design, not her photo.
  if (Math.abs(r - 0.707) < 0.03 && p.w >= 1000) return -1;
  return (r <= 1.05 ? 1.5 : 1) * Math.min(p.w * p.h, 900 * 1200);
}
function pickPhoto_(list) {
  var best = null, bs = 0;
  list.forEach(function (p) { var sc = photoScore_(p); if (sc > bs) { bs = sc; best = p; } });
  return best;
}
// For Circle's "Photo from biodata": up to 8 pictures, best first. An image biodata comes back whole, to crop.
function photoChoices_(fileId) {
  var f = DriveApp.getFileById(fileId), mt = f.getMimeType(), list;
  if (/^image\//.test(mt)) list = [{ bytes: f.getBlob().getBytes(), type: mt }];
  else list = extractJpegs_(f.getBlob().getBytes()).filter(function (p) { return p.w >= 80 && p.h >= 80 && p.bytes.length < 2500000; })
    .sort(function (a, b) { return photoScore_(b) - photoScore_(a); }).slice(0, 8)
    .map(function (p) { return { bytes: p.bytes, type: "image/jpeg" }; });
  return { ok: true, photos: list.map(function (p) { return "data:" + p.type + ";base64," + Utilities.base64Encode(p.bytes); }) };
}

// ===================== One-time batch: Bina's "Divorced Brides 1990-1998" =====================
// Already on Drive in year folders (1990 … 1996). Nothing is copied or moved: profiles link to those files.
var BINA_FOLDER = "1WlhAJO4L12Lj8zPqQzC0-IPh9-IVdtkj"; // override with script property BINA_FOLDER_ID if Bina's folder moves
function binaFolder_() { return prop_("BINA_FOLDER_ID") || BINA_FOLDER; }
var BINA_LABEL = "Bina · Divorced Brides";
// Bina's list is filtered, not dumped: born 1988–1998 and height at or under 5′6″. Taller girls are not added.
var BINA_YEARS = [1988, 1998];
var BINA_COPY = "1WlhAJO4L12Lj8zPqQzC0-IPh9-IVdtkj"; // Harsh's copy, already height-checked by Bina's filter
function yearOf_(g, fields) {
  var y = (g.path || []).map(Number).filter(function (n) { return n >= 1900 && n <= 2015; })[0];
  if (!y && fields && fields.dob) y = +String(fields.dob).slice(0, 4);
  return y || 0;
}
function binaPreFilter_(g) {
  var y = yearOf_(g);
  if (y && (y < BINA_YEARS[0] || y > BINA_YEARS[1])) return "born " + y;
  return null;
}
function binaFilter_(fields, g) {
  var y = yearOf_(g, fields);
  if (!y) return "birth year not known";
  if (y < BINA_YEARS[0] || y > BINA_YEARS[1]) return "born " + y;
  var h = parseHeight_(fields.heightIn != null ? fields.heightIn : fields.height);
  if (h && h > HARSH_HEIGHT_IN) return "too tall (" + Math.floor(h / 12) + "′" + (h % 12) + "″)";
  // In Harsh's copy every girl already passed height; elsewhere an unreadable height is flagged, not guessed.
  if (!h && binaFolder_() !== BINA_COPY) return "height not readable";
  return null;
}
var PARENT_FOLDER_URL = "https://drive.google.com/drive/folders/13AhRjQVi2val9F5fq55C7HK2aZnyC3WT";

// Run this once. It keeps going in 5-minute rounds by itself until every file is in, then stops.
function importBina() {
  tidySources_();
  pruneBina_();
  fsPatch_("reference/settings", { driveFolder: PARENT_FOLDER_URL });
  return importBinaRound();
}
function importBinaRound() {
  var r = scanLane_({ folderId: binaFolder_(), source: BINA_LABEL, recurse: true, budgetMs: 270000, defaults: binaDefaults_,
    preFilter: binaPreFilter_, filter: binaFilter_ });
  if (r.skipped) return r;
  var props = PropertiesService.getScriptProperties();
  var rep = JSON.parse(props.getProperty("BINA_REPORT") || '{"created":0,"updated":0,"failed":[],"pass":0,"fail":0,"unknown":0,"ocrMiss":[],"errors":[],"newNames":[]}');
  rep.newNames = rep.newNames || []; rep.already = rep.already || []; rep.skipped = rep.skipped || {};
  r.processed.forEach(function (x) {
    if (x.error) { rep.errors.push(x.name + ": " + x.error); return; }
    if (x.skipped) { var k = /^born/.test(x.skipped) ? "tooOld" : /tall/.test(x.skipped) ? "tooTall" : /height/.test(x.skipped) ? "noHeight" : "noYear";
      (rep.skipped[k] = rep.skipped[k] || []).push(x.name + " (" + x.skipped + ")"); return; }
    x.created ? rep.created++ : rep.updated++;
    if (x.created) rep.newNames.push(x.name); else rep.already.push(x.name);
    rep[x.heightFit] = (rep[x.heightFit] || 0) + 1;
    if (x.heightFit === "fail") rep.failed.push(x.name);
    if (x.ocrMiss) rep.ocrMiss.push(x.name);
  });
  rep.total = r.total; rep.remaining = r.remaining;
  props.setProperty("BINA_REPORT", JSON.stringify(rep));
  // What Circle's Sources tab shows (only Harsh can read admin/*).
  fsPatch_("admin/imports", { bina: { running: r.remaining > 0, lastRun: new Date(), files: r.total || 0, created: rep.created, updated: rep.updated,
    newNames: rep.newNames.slice(-30), unreadable: rep.ocrMiss.length, errors: rep.errors.length, remaining: r.remaining,
    skippedTall: (rep.skipped.tooTall || []).length, skippedOld: (rep.skipped.tooOld || []).length,
    skippedNoHeight: (rep.skipped.noHeight || []).length + (rep.skipped.noYear || []).length } });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "importBinaRound") ScriptApp.deleteTrigger(t); });
  if (r.remaining > 0) ScriptApp.newTrigger("importBinaRound").timeBased().after(60 * 1000).create();
  console.log((r.remaining ? "Round done, " + r.remaining + " girls left; next round starts in 1 minute. " : "Bina batch finished. ") + JSON.stringify(rep));
  return rep;
}
// The year folder is her birth year; everyone on this list is divorced. Only used when her biodata doesn't say.
function binaDefaults_(fields, g) {
  var yr = (g.path || []).map(Number).filter(function (y) { return y >= 1950 && y <= 2010; })[0];
  if (!fields.dob && !fields.age && yr) fields.age = new Date().getFullYear() - yr;
  if (!fields.marital) fields.marital = "Divorced";
}
// "Check Bina's folder": start a fresh check now. From Circle the work runs a second later in the background,
// so the button answers at once; the Sources tab updates as girls come in.
function updateBina_(fromCircle) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("BINA_REPORT", JSON.stringify({ created: 0, updated: 0, failed: [], pass: 0, fail: 0, unknown: 0, ocrMiss: [], errors: [], newNames: [], already: [], skipped: {} }));
  pruneBina_();
  fsPatch_("admin/imports", { bina: { running: true, startedAt: new Date() } });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "importBinaRound") ScriptApp.deleteTrigger(t); });
  if (fromCircle) { ScriptApp.newTrigger("importBinaRound").timeBased().after(1000).create(); return { ok: true, started: true }; }
  return importBinaRound();
}
function updateBina() { return updateBina_(false); }
// Daily, by itself (installTrigger): Bina's list refreshes about every 10 days, so a new batch shows up within a day.
function binaDaily() { return updateBina_(false); }
function binaReport() {
  console.log(PropertiesService.getScriptProperties().getProperty("BINA_REPORT") || "Not run yet.");
}
// An earlier import added Bina's girls unfiltered. Archive (not delete) any that break the filters, so Circle shows
// only the filtered list; Harsh can still find them under Profiles › Archived.
function pruneBina_() {
  var all = fsFetch_(":runQuery", { method: "post", payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: "candidates" }], where: { fieldFilter: { field: { fieldPath: "source" }, op: "EQUAL", value: { stringValue: BINA_LABEL } } } } }) });
  var n = 0, yr = new Date().getFullYear();
  all.forEach(function (x) {
    if (!x.document) return;
    var d = fromFs_(x.document.fields || {});
    if (d.archived) return;
    var y = d.dob ? +String(d.dob).slice(0, 4) : (d.age ? yr - d.age : 0);
    var bad = (d.heightIn && d.heightIn > HARSH_HEIGHT_IN) || (y && (y < BINA_YEARS[0] - 1 || y > BINA_YEARS[1] + 1));
    if (bad) { fsPatch_("candidates/" + x.document.name.split("/").pop(), { archived: true, viewers: [] }); n++; }
  });
  if (n) console.log("Archived " + n + " Bina profiles outside the filters.");
  return n;
}
// Older imports said "Seema Aunty · From chat"; one name per source keeps the Sources tab and filter clean.
function tidySources_() {
  var all = fsFetch_(":runQuery", { method: "post", payload: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: "candidates" }], where: { fieldFilter: { field: { fieldPath: "source" }, op: "EQUAL", value: { stringValue: "Seema Aunty · From chat" } } } } }) });
  all.forEach(function (x) { if (x.document) fsPatch_("candidates/" + x.document.name.split("/").pop(), { source: "Seema Aunty" }); });
}

// ===================== One-time re-read of every profile (birth date, time, place, native) =====================
var READ_FIELDS = ["dob", "birthTime", "birthPlace", "native", "community", "education", "work", "marital"];
function readAllBiodatas() {
  PropertiesService.getScriptProperties().deleteProperty("READ_REPORT");
  return readAllRound();
}
function readAllRound() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: "already running" };
  var t0 = Date.now(), props = PropertiesService.getScriptProperties();
  var rep = JSON.parse(props.getProperty("READ_REPORT") || '{"read":0,"dob":0,"birthTime":0,"birthPlace":0,"native":0,"photos":0,"missed":[],"errors":[]}');
  var left = 0;
  try {
    var all = fsFetch_(":runQuery", { method: "post", payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: "candidates" }] } }) });
    all.forEach(function (x) {
      if (!x.document) return;
      var id = x.document.name.split("/").pop(), d = fromFs_(x.document.fields || {});
      var fid = String(d.pdfUrl || "").match(/\/d\/([\w-]{20,})/);
      if (!fid || props.getProperty("read15:" + id)) return;
      if (Date.now() - t0 > 270000) { left++; return; }
      try {
        var file = DriveApp.getFileById(fid[1]);
        var found = parseBiodata_(ocrText_(file)), patch = {};
        if (found.height && !d.heightIn) { var h = parseHeight_(found.height); if (h) patch.heightIn = h; }
        READ_FIELDS.forEach(function (k) { if (found[k] && !d[k]) patch[k] = found[k]; });
        if (!d.photo && file.getMimeType() === "application/pdf") {
          var best = pickPhoto_(extractJpegs_(file.getBlob().getBytes()));
          if (best && best.bytes.length <= 350000) { patch.photo = "data:image/jpeg;base64," + Utilities.base64Encode(best.bytes); rep.photos++; }
        }
        if (Object.keys(patch).length) { patch.updatedAt = new Date(); fsPatch_("candidates/" + id, patch); }
        rep.read++;
        ["dob", "birthTime", "birthPlace", "native"].forEach(function (k) { if (d[k] || patch[k]) rep[k]++; });
        if (!(d.birthPlace || patch.birthPlace) || !(d.native || patch.native)) rep.missed.push(d.name);
        props.setProperty("read15:" + id, "1");
      } catch (e) { rep.errors.push(d.name + ": " + (e && e.message || e)); props.setProperty("read15:" + id, "1"); }
    });
  } finally { lock.releaseLock(); }
  rep.remaining = left;
  props.setProperty("READ_REPORT", JSON.stringify(rep));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "readAllRound") ScriptApp.deleteTrigger(t); });
  if (left > 0) ScriptApp.newTrigger("readAllRound").timeBased().after(60 * 1000).create();
  console.log((left ? "Round done, " + left + " profiles left; next round in 1 minute. " : "All profiles read. ") + JSON.stringify(rep));
  return rep;
}
function readAllReport() {
  console.log(PropertiesService.getScriptProperties().getProperty("READ_REPORT") || "Not run yet.");
}
