// Circle · family review for Harsh. BUILD 4
// Plain ES module, no build step. Security lives in firestore.rules; this file only draws screens.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, sendSignInLinkToEmail,
  isSignInWithEmailLink, signInWithEmailLink, signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  addDoc, collection, query, where, orderBy, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL } from "./config.js";

export const BUILD = "4";
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const app = initializeApp(LOCAL ? { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-family-review" } : firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (LOCAL) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const STAGES = ["New", "In review", "Shortlist", "Shared", "Talking", "Meeting", "On hold", "Pass"];
const HARSH_HEIGHT_IN = 66; // 5 ft 6 in. Partner height must be at or under this.
const $app = document.getElementById("app");

// ---------- state ----------
const S = {
  user: null, me: null, owner: false,
  cands: new Map(), members: [], harsh: null, settings: {}, admin: {}, summaries: new Map(),
  filters: { stage: "", height: "", community: "", city: "", q: "", archived: false },
  open: new Set(), unsubs: [], detailUnsubs: [], route: "",
};

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lc = (s) => String(s || "").trim().toLowerCase();
const handle = (email) => "@" + String(email || "").split("@")[0];
const initials = (n) => String(n || "?").split(/\s+/).filter(Boolean).filter((w) => !/^dr\.?$/i.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const ftIn = (inch) => (inch ? `${Math.floor(inch / 12)}′${inch % 12}″` : "");
function heightFit(inch) { return !inch ? "unknown" : inch <= HARSH_HEIGHT_IN ? "pass" : "fail"; }
function heightTag(inch) {
  const f = heightFit(inch);
  if (f === "pass") return `<span class="tag ok" title="At or under Harsh's 5′6″">Height pass · ${ftIn(inch)}</span>`;
  if (f === "fail") return `<span class="tag bad" title="Taller than Harsh's 5′6″">Height fail · ${ftIn(inch)}</span>`;
  return `<span class="tag na">Height not known</span>`;
}
function ageOf(c) {
  if (c.dob) {
    const d = new Date(c.dob), n = new Date();
    if (!isNaN(d)) { let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; }
  }
  return c.age || "";
}
function fmtDob(s) { const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
function fmtTime(ts) {
  const d = ts?.toDate ? ts.toDate() : null; if (!d) return "just now";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function parseHeight(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 100 ? Math.round(v / 2.54) : Math.round(v);
  const s = String(v).toLowerCase().trim();
  let m = s.match(/(\d)\s*(?:ft|feet|'|′|\.|\s)\s*(\d{1,2})?/);
  if (m && !/cm/.test(s)) return +m[1] * 12 + (+m[2] || 0);
  m = s.match(/(\d{3})\s*cm/); if (m) return Math.round(+m[1] / 2.54);
  m = s.match(/^\d+$/); if (m) return +s > 100 ? Math.round(+s / 2.54) : +s;
  return null;
}
const star = (on) => `<svg viewBox="0 0 24 24" class="s ${on ? "on" : ""}"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>`;
const mark = (size = 28) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 30V15c0-6 5-9 11-13 6 4 11 7 11 13v15" fill="none" stroke="#1c3fae" stroke-width="3.2" stroke-linejoin="round"/><path d="M11 30V19c0-3 2.5-5 5-6.5 2.5 1.5 5 3.5 5 6.5v11" fill="none" stroke="#1c3fae" stroke-width="2.4" stroke-linejoin="round" opacity=".55"/><circle cx="16" cy="7.5" r="3" fill="#f5a300"/></svg>`;
const TORAN = `<div class="toran" aria-hidden="true"></div>`;
// Drive links: accept any Drive share link, keep only Google's own hosts.
function driveId(u) { const m = String(u || "").match(/(?:\/d\/|[?&]id=)([\w-]{20,})/); return m ? m[1] : null; }
function isDrive(u) { try { return /(^|\.)(drive|docs)\.google\.com$/.test(new URL(u).hostname); } catch { return false; } }
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}
function viewersOf(c) { return c.hidden || c.archived ? [] : [...new Set((c.sharedWith || []).map(lc))]; }
const myName = () => S.me?.name || (S.owner ? "Harsh" : handle(S.user.email).slice(1));

// ---------- auth ----------
const LS_EMAIL = "circle.email";
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

async function finishLinkSignIn(email) {
  await signInWithEmailLink(auth, email, location.href);
  lsSet(LS_EMAIL, null);
  history.replaceState(null, "", location.pathname + "#/");
}

function renderSignIn(stage = "ask", info = {}) {
  const linkFlow = stage === "confirm";
  $app.innerHTML = `
  <div class="auth">${TORAN}<div class="card">
    ${mark(44)}
    <h1>${linkFlow ? "Confirm your email" : "Circle"}</h1>
    <p>${linkFlow ? "Type the email you asked the sign-in link for." :
      stage === "sent" ? `We sent a sign-in link to <b>${esc(info.email)}</b>. Open it on this phone.` :
      "Harsh's rishta review with family. Only people Harsh has invited can sign in."}</p>
    ${stage === "sent" ? `<button class="btn ghost wide" data-act="again">Use a different email</button>` : `
    <form id="f-signin">
      <label class="f"><span>Email</span><input class="in-t" type="email" name="email" required autocomplete="email" inputmode="email" value="${esc(info.email || "")}"></label>
      <button class="btn wide" type="submit">${linkFlow ? "Sign in" : "Email me a sign-in link"}</button>
      <div class="err" id="err">${esc(info.err || "")}</div>
    </form>`}
  </div></div>`;
  const f = document.getElementById("f-signin");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const email = lc(f.email.value); const btn = f.querySelector("button"); btn.disabled = true;
    try {
      if (linkFlow) await finishLinkSignIn(email);
      else {
        await sendSignInLinkToEmail(auth, email, { url: location.origin + "/", handleCodeInApp: true });
        lsSet(LS_EMAIL, email); renderSignIn("sent", { email });
      }
    } catch (err) { btn.disabled = false; document.getElementById("err").textContent = niceErr(err); }
  };
  $app.querySelector('[data-act="again"]')?.addEventListener("click", () => renderSignIn("ask"));
}
function niceErr(e) {
  const c = e?.code || "";
  if (c.includes("invalid-email")) return "That email doesn't look right.";
  if (c.includes("invalid-action-code") || c.includes("expired")) return "This link has expired or was used already. Ask for a new one.";
  if (c.includes("permission-denied")) return "You don't have access to this.";
  if (c.includes("too-many")) return "Too many tries. Wait a few minutes.";
  return e?.message || "Something went wrong.";
}

function renderNotInvited() {
  $app.innerHTML = `<div class="auth">${TORAN}<div class="card">${mark(44)}
    <h1>Not on the list yet</h1>
    <p><b>${esc(S.user.email)}</b> hasn't been invited. Ask Harsh to add this email, then open the link again.</p>
    <button class="btn ghost wide" data-act="signout">Sign out</button></div></div>`;
  $app.querySelector('[data-act="signout"]').onclick = () => signOut(auth);
}

// ---------- data ----------
function stopAll() { S.unsubs.forEach((u) => u()); S.unsubs = []; stopDetail(); }
function stopDetail() { S.detailUnsubs.forEach((u) => u()); S.detailUnsubs = []; }

async function startData() {
  const email = lc(S.user.email);
  const q = S.owner ? collection(db, "candidates") : query(collection(db, "candidates"), where("viewers", "array-contains", email));
  let first = true;
  S.unsubs.push(onSnapshot(q, (snap) => {
    S.cands = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    loadSummaries(); if (first) { first = false; route(); } else rerenderSoft();
  }, (e) => toast(niceErr(e))));
  if (S.owner) S.unsubs.push(onSnapshot(doc(db, "admin", "settings"), (d) => { S.admin = d.exists() ? d.data() : {}; }, () => {}));
  if (S.owner) S.unsubs.push(onSnapshot(collection(db, "members"), (snap) => {
    S.members = snap.docs.map((d) => ({ email: d.id, ...d.data() })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    rerenderSoft();
  }));
  S.unsubs.push(onSnapshot(doc(db, "reference", "settings"), (d) => { S.settings = d.exists() ? d.data() : {}; rerenderSoft(); }, () => {}));
  S.unsubs.push(onSnapshot(doc(db, "reference", "harsh"), (d) => { S.harsh = d.exists() ? d.data() : null; if (S.route.startsWith("#/harsh")) rerenderSoft(); }, () => {}));
}

// Rating summaries per candidate. Reviewers only get the family score after they rate (blind first).
async function loadSummary(id) {
  const email = lc(S.user.email);
  try {
    let mine = null, all = null;
    if (S.owner) {
      all = (await getDocs(collection(db, "candidates", id, "reviews"))).docs.map((d) => ({ email: d.id, ...d.data() }));
      mine = all.find((r) => r.email === email)?.stars || null;
    } else {
      const own = await getDoc(doc(db, "candidates", id, "reviews", email));
      if (own.exists()) {
        mine = own.data().stars;
        all = (await getDocs(collection(db, "candidates", id, "reviews"))).docs.map((d) => ({ email: d.id, ...d.data() }));
      }
    }
    S.summaries.set(id, summarize(mine, all));
  } catch { S.summaries.set(id, summarize(null, null)); }
}
function summarize(mine, all) {
  const avg = all && all.length ? all.reduce((s, r) => s + r.stars, 0) / all.length : null;
  return { mine, all, avg, count: all ? all.length : 0 };
}
let sumTimer;
async function loadSummaries() {
  await Promise.all([...S.cands.keys()].map(loadSummary));
  clearTimeout(sumTimer); sumTimer = setTimeout(() => { if (S.route === "#/" || S.route === "") rerenderSoft(); }, 30);
}

// ---------- shell ----------
function shell(inner, tab) {
  const tabs = [["#/", "Profiles", "list"], ...(S.owner ? [["#/people", "Family", "people"]] : []), ["#/harsh", "Harsh's biodata", "harsh"]];
  return `
  <header class="top">${TORAN}
    <div class="in"><a class="brand" href="#/">${mark()}<span>Circle</span></a><span class="sp"></span>
      <span class="who">${esc(myName())}</span><button class="btn plain sm" data-act="signout">Sign out</button></div>
    <nav class="tabs">${tabs.map(([h, l, k]) => `<a href="${h}" class="${tab === k ? "on" : ""}">${l}</a>`).join("")}</nav>
  </header>
  <main class="wrap">${inner}</main>`;
}

// ---------- router ----------
window.addEventListener("hashchange", () => route(false));
function rerenderSoft() {
  // Keep typing safe: don't redraw while a text box has focus.
  const a = document.activeElement;
  if (a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox"))) return;
  route(true);
}
function route(soft) {
  if (!S.me) return;
  const h = location.hash || "#/";
  if (!soft || h !== S.route) { if (!h.startsWith("#/c/") || h !== S.route) stopDetail(); }
  const prev = S.route; S.route = h;
  const y = soft && prev === h ? scrollY : 0;
  let m;
  if ((m = h.match(/^#\/c\/([\w-]+)$/))) viewDetail(m[1], soft && prev === h);
  else if (S.owner && h === "#/new") viewEdit(null);
  else if (S.owner && (m = h.match(/^#\/edit\/([\w-]+)$/))) viewEdit(m[1]);
  else if (S.owner && h === "#/import") viewImport();
  else if (S.owner && h === "#/people") viewPeople();
  else if (S.owner && h === "#/harsh/edit") viewHarshEdit();
  else if (h === "#/harsh") viewHarsh();
  else viewList();
  if (soft) scrollTo(0, y);
}
document.addEventListener("click", (e) => {
  if (e.target.closest('[data-act="signout"]')) { stopAll(); signOut(auth); }
});

// ---------- list ----------
function filtered() {
  const f = S.filters, q = lc(f.q);
  return [...S.cands.values()].filter((c) =>
    (S.owner ? (f.archived ? c.archived : !c.archived) : true) &&
    (!f.stage || c.stage === f.stage) &&
    (!f.height || heightFit(c.heightIn) === f.height) &&
    (!f.community || c.community === f.community) &&
    (!f.city || c.city === f.city) &&
    (!q || lc([c.name, c.city, c.community, c.work, c.education].join(" ")).includes(q)));
}
function opts(field) { return [...new Set([...S.cands.values()].map((c) => c[field]).filter(Boolean))].sort(); }
function selChip(key, label, values, labels = values) {
  const v = S.filters[key];
  return `<select class="chip ${v ? "on" : ""}" data-filter="${key}" aria-label="${label}">
    <option value="">${label}</option>${values.map((x, i) => `<option value="${esc(x)}" ${x === v ? "selected" : ""}>${esc(labels[i])}</option>`).join("")}</select>`;
}
function rowHtml(c) {
  const s = S.summaries.get(c.id) || {}, age = ageOf(c);
  const sub = [age && `${age}`, c.city, c.community].filter(Boolean).join(" · ");
  let right;
  if (S.owner) right = s.count ? `<span class="score"><span class="mini-star">★</span> <b>${s.avg.toFixed(1)}</b> · ${s.count}</span>` : `<span class="score">No ratings</span>`;
  else right = s.mine ? `<span class="score">You <span class="mini-star">★</span><b>${s.mine}</b></span>` : `<span class="tag blue">Rate</span>`;
  const flags = S.owner ? [c.hidden && "Hidden", !c.hidden && !c.archived && !(c.viewers || []).length && "Not shared"].filter(Boolean) : [];
  return `<a class="cr" href="#/c/${c.id}">
    <div class="av">${c.photo ? `<img src="${c.photo}" alt="" loading="lazy">` : esc(initials(c.name))}</div>
    <div class="m"><div class="nm">${esc(c.name)}</div><div class="sub">${esc(sub) || "&nbsp;"}</div></div>
    <div class="r">${heightTag(c.heightIn)}<div>${flags.map((x) => `<span class="tag mute">${x}</span>`).join(" ")} ${right}</div></div></a>`;
}
function viewList() {
  const list = filtered(), f = S.filters, any = f.stage || f.height || f.community || f.city || f.q;
  const groups = STAGES.map((st) => [st, list.filter((c) => (c.stage || "New") === st).sort((a, b) => a.name.localeCompare(b.name))]).filter(([, l]) => l.length);
  const total = S.owner ? [...S.cands.values()].filter((c) => !c.archived).length : S.cands.size;
  $app.innerHTML = shell(`
    <div class="ph"><h2>${S.owner ? "Profiles" : "Profiles Harsh shared"}</h2>
      ${S.owner ? `<label class="btn sm" id="up-btn">Upload PDF<input type="file" accept="application/pdf,.pdf" hidden data-act="upload"></label><a class="btn ghost sm" href="#/import">Import</a>` : ""}</div>
    ${isDrive(S.settings.driveFolder) ? `<div class="links"><a href="${esc(S.settings.driveFolder)}" target="_blank" rel="noopener">All biodata PDFs in Drive ↗</a></div>` : ""}
    <input class="search" type="search" placeholder="Search name, city, work" value="${esc(f.q)}" data-filter="q">
    <div class="filters">
      ${selChip("stage", "Stage", STAGES)}
      ${selChip("height", "Height", ["pass", "fail", "unknown"], ["Height pass", "Height fail", "Height not known"])}
      ${selChip("community", "Community", opts("community"))}
      ${selChip("city", "City", opts("city"))}
      ${S.owner ? `<button class="chip ${f.archived ? "on" : ""}" data-act="arch">Archived</button>` : ""}
      ${any ? `<button class="chip" data-act="clear">Clear</button>` : ""}
    </div>
    ${groups.length ? groups.map(([st, l]) => `
      <details class="grp" data-stage="${esc(st)}" ${S.open.has(st) || any ? "open" : ""}>
        <summary><span class="dot" style="opacity:${0.35 + 0.65 * (1 - STAGES.indexOf(st) / STAGES.length)}"></span>${esc(st)}<span class="n">${l.length}</span><span class="sp"></span><span class="car"></span></summary>
        ${l.map(rowHtml).join("")}
      </details>`).join("") :
      `<div class="empty">${total ? "Nothing matches these filters." : S.owner ? "No profiles yet. Add one or import a list." : "Harsh hasn't shared any profiles with you yet."}</div>`}
    ${S.owner ? `<a class="btn fab" href="#/new">+ Add profile</a>` : ""}`, "list");

  $app.querySelectorAll("details.grp").forEach((d) => d.addEventListener("toggle", () => { d.open ? S.open.add(d.dataset.stage) : S.open.delete(d.dataset.stage); }));
  $app.querySelectorAll("select[data-filter]").forEach((el) => (el.onchange = () => { S.filters[el.dataset.filter] = el.value; viewList(); }));
  const s = $app.querySelector('input[data-filter="q"]');
  s.oninput = () => { S.filters.q = s.value; const pos = s.selectionStart; viewList(); const n = $app.querySelector('input[data-filter="q"]'); n.focus(); n.setSelectionRange(pos, pos); };
  $app.querySelector('[data-act="upload"]')?.addEventListener("change", (e) => uploadPdf(e.target.files[0]));
  $app.querySelector('[data-act="arch"]')?.addEventListener("click", () => { S.filters.archived = !S.filters.archived; viewList(); });
  $app.querySelector('[data-act="clear"]')?.addEventListener("click", () => { Object.assign(S.filters, { stage: "", height: "", community: "", city: "", q: "" }); viewList(); });
}

// ---------- detail ----------
const D = { id: null, reviews: null, mine: null, comments: [], editing: null };
function viewDetail(id, soft) {
  const c = S.cands.get(id);
  if (!c) { $app.innerHTML = shell(`<a class="back" href="#/">‹ Profiles</a><div class="empty">This profile isn't available.</div>`, "list"); return; }
  if (!soft || D.id !== id) subscribeDetail(id);
  drawDetail(c);
}
function subscribeDetail(id) {
  stopDetail(); Object.assign(D, { id, reviews: null, mine: null, comments: [], editing: null, priv: null, pdfOpen: false });
  const email = lc(S.user.email);
  S.detailUnsubs.push(onSnapshot(query(collection(db, "candidates", id, "comments"), orderBy("createdAt")), (snap) => {
    D.comments = snap.docs.map((d) => ({ id: d.id, ...d.data() })); redrawDetail();
  }, () => {}));
  const listenAll = () => S.detailUnsubs.push(onSnapshot(collection(db, "candidates", id, "reviews"), (snap) => {
    D.reviews = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
    D.mine = D.reviews.find((r) => r.email === email)?.stars || null;
    S.summaries.set(id, summarize(D.mine, D.reviews)); redrawDetail();
  }, () => {}));
  if (S.owner) {
    listenAll();
    getDoc(doc(db, "candidates", id, "private", "notes")).then((d) => { D.priv = d.exists() ? d.data() : {}; redrawDetail(); });
  } else {
    let all = false;
    S.detailUnsubs.push(onSnapshot(doc(db, "candidates", id, "reviews", email), (d) => {
      D.mine = d.exists() ? d.data().stars : null;
      if (D.mine && !all) { all = true; listenAll(); }
      redrawDetail();
    }, () => {}));
  }
}
function redrawDetail() { if (S.route === `#/c/${D.id}`) { const c = S.cands.get(D.id); if (c) { const y = scrollY; drawDetail(c); scrollTo(0, y); } } }

function drawDetail(c) {
  const a = document.activeElement;
  if (a && a.tagName === "TEXTAREA" && a.value) return; // never wipe a half-typed comment
  const email = lc(S.user.email), age = ageOf(c);
  const facts = [
    ["Age", age ? `${age}${c.dob ? ` · born ${fmtDob(c.dob)}` : ""}` : ""],
    ["Community", c.community], ["Native", c.native], ["Lives in", c.city],
    ["Education", c.education], ["Work", c.work], ["Family", c.family], ["Marital status", c.marital], ["Diet", c.diet],
  ].filter(([, v]) => v);
  const avg = D.reviews && D.reviews.length ? D.reviews.reduce((s, r) => s + r.stars, 0) / D.reviews.length : null;
  const members = S.members.filter((m) => m.active && m.role !== "owner");
  const shared = new Set((c.sharedWith || []).map(lc));

  $app.innerHTML = shell(`
    <a class="back" href="#/">‹ Profiles</a>
    <div class="hero">
      <div class="ph-img">${c.photo ? `<img src="${c.photo}" alt="" data-act="zoom">` : esc(initials(c.name))}</div>
      <div><h1>${esc(c.name)}</h1><div class="tags">${heightTag(c.heightIn)}${S.owner ? "" : `<span class="tag blue">${esc(c.stage || "New")}</span>`}
        ${S.owner && c.hidden ? `<span class="tag mute">Hidden</span>` : ""}${S.owner && c.archived ? `<span class="tag mute">Archived</span>` : ""}</div></div>
    </div>

    ${S.owner ? `
    <div class="adminbar">
      <select class="chip on" data-act="stage" aria-label="Stage">${STAGES.map((s) => `<option ${s === (c.stage || "New") ? "selected" : ""}>${s}</option>`).join("")}</select>
      <a class="btn ghost sm" href="#/edit/${c.id}">Edit</a>
      <button class="btn ghost sm" data-act="hide">${c.hidden ? "Unhide" : "Hide from family"}</button>
      <button class="btn ghost sm" data-act="archive">${c.archived ? "Restore" : "Archive"}</button>
    </div>` : ""}

    ${isDrive(c.pdfUrl) ? `<a class="pdf" href="${esc(c.pdfUrl)}" target="_blank" rel="noopener" data-act="pdf"><span class="ic">PDF</span><span class="sp">Biodata PDF</span><span class="go">${D.pdfOpen ? "Close" : "View"}</span></a>
      ${D.pdfOpen && driveId(c.pdfUrl) ? `<iframe class="pdf-frame" src="https://drive.google.com/file/d/${driveId(c.pdfUrl)}/preview" title="Biodata PDF"></iframe>` : ""}` : ""}
    <section class="card">
      <h3>Biodata</h3>
      ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : `<div class="hint">No details yet.</div>`}
      ${c.about ? `<p class="about">${esc(c.about)}</p>` : ""}
    </section>

    <section class="card" id="rate">
      <h3>${S.owner ? "Family rating" : "Your rating"}</h3>
      ${!S.owner ? `<div class="stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">${star(D.mine >= n)}</button>`).join("")}</div>` : ""}
      ${D.reviews ? (D.reviews.length ? `
        <div class="rate-head" style="margin-top:${S.owner ? 0 : 12}px"><span class="big">${avg.toFixed(1)}</span><span class="hint">family average from ${D.reviews.length} ${D.reviews.length === 1 ? "person" : "people"}</span></div>
        <ul class="who-rated">${D.reviews.sort((x, y) => y.stars - x.stars).map((r) => `<li><span>${esc(r.name || handle(r.email))}${r.email === email ? " (you)" : ""}</span><span><span class="mini-star">${"★".repeat(r.stars)}</span><span style="color:#e5e8ef">${"★".repeat(5 - r.stars)}</span></span></li>`).join("")}</ul>`
        : `<div class="hint">No one has rated yet.</div>`)
        : `<div class="blind">Give your stars first. Then you'll see what the family gave, so no one is swayed.</div>`}
    </section>

    <section class="card" id="comments">
      <h3>Comments</h3>
      <div>${D.comments.length ? D.comments.map((m) => commentHtml(m, email)).join("") : `<div class="hint">No comments yet. Say what you think.</div>`}</div>
      <form class="compose" id="f-cm"><textarea name="text" rows="1" maxlength="2000" placeholder="Write a comment"></textarea><button class="btn" type="submit">Post</button></form>
      <div class="hint" style="margin-top:6px">Seen by Harsh and the family he shared this profile with.</div>
    </section>

    ${S.owner ? `
    <section class="card">
      <h3>Shared with</h3>
      ${members.length ? `<div class="share">${members.map((m) => `<label class="${shared.has(m.email) ? "on" : ""}"><input type="checkbox" data-share="${esc(m.email)}" ${shared.has(m.email) ? "checked" : ""}>${esc(m.name || m.email)}</label>`).join("")}</div>
      <div style="margin-top:10px;display:flex;gap:8px"><button class="btn ghost sm" data-act="share-all">Everyone</button><button class="btn plain sm" data-act="share-none">No one</button></div>
      ${c.hidden || c.archived ? `<div class="hint" style="margin-top:8px">${c.hidden ? "Hidden" : "Archived"}, so no one can see it right now.</div>` : ""}`
      : `<div class="hint">No family added yet. <a href="#/people">Add people</a>.</div>`}
    </section>
    <section class="card">
      <h3>Only you see this</h3>
      ${D.priv ? `<form id="f-priv">
        <div class="row2"><label class="f"><span>Contact</span><input class="in-t" name="contact" value="${esc(D.priv.contact)}"></label>
        <label class="f"><span>Came from</span><input class="in-t" name="source" value="${esc(D.priv.source)}"></label></div>
        <label class="f"><span>Notes</span><textarea class="in-t" name="notes">${esc(D.priv.notes)}</textarea></label>
        <button class="btn ghost sm" type="submit">Save notes</button></form>` : `<div class="hint">Loading…</div>`}
    </section>` : ""}
  `, "list");
  bindDetail(c);
}
function commentHtml(m, email) {
  const mine = m.email === email;
  if (D.editing === m.id) return `<div class="cm"><form class="compose" data-edit="${m.id}" style="margin:0"><textarea name="text" maxlength="2000">${esc(m.text)}</textarea><button class="btn sm" type="submit">Save</button><button class="btn plain sm" type="button" data-act="cancel-edit">Cancel</button></form></div>`;
  return `<div class="cm"><div class="h"><b>${esc(m.name || handle(m.email))}</b><span class="t">${esc(handle(m.email))} · ${fmtTime(m.createdAt)}${m.editedAt ? " · edited" : ""}</span></div>
    <div class="tx">${esc(m.text)}</div>
    ${mine || S.owner ? `<div class="act">${mine ? `<button class="btn plain sm" data-edit-cm="${m.id}">Edit</button>` : ""}<button class="btn plain sm" data-del-cm="${m.id}">Delete</button></div>` : ""}</div>`;
}
async function saveCand(id, patch) {
  const c = { ...S.cands.get(id), ...patch };
  await updateDoc(doc(db, "candidates", id), { ...patch, viewers: viewersOf(c), updatedAt: serverTimestamp() });
}
function bindDetail(c) {
  const id = c.id, email = lc(S.user.email);
  $app.querySelectorAll("[data-star]").forEach((b) => (b.onclick = async () => {
    const n = +b.dataset.star;
    try { await setDoc(doc(db, "candidates", id, "reviews", email), { stars: n, name: myName(), updatedAt: serverTimestamp() }); toast(`Saved · ${n} star${n > 1 ? "s" : ""}`); }
    catch (e) { toast(niceErr(e)); }
  }));
  const f = document.getElementById("f-cm");
  const grow = (t) => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; };
  f.text.oninput = () => grow(f.text);
  f.onsubmit = async (e) => {
    e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
    f.querySelector("button").disabled = true;
    try { await addDoc(collection(db, "candidates", id, "comments"), { email, name: myName(), text, createdAt: serverTimestamp() }); f.text.value = ""; f.text.blur(); redrawDetail(); }
    catch (err) { toast(niceErr(err)); f.querySelector("button").disabled = false; }
  };
  $app.querySelectorAll("[data-edit-cm]").forEach((b) => (b.onclick = () => { D.editing = b.dataset.editCm; drawDetail(c); $app.querySelector(`[data-edit] textarea`)?.focus(); }));
  $app.querySelector('[data-act="cancel-edit"]')?.addEventListener("click", () => { D.editing = null; document.activeElement?.blur(); drawDetail(c); });
  $app.querySelector("[data-edit]")?.addEventListener("submit", async (e) => {
    e.preventDefault(); const t = e.target.text.value.trim(); if (!t) return;
    try { await updateDoc(doc(db, "candidates", id, "comments", D.editing), { text: t, editedAt: serverTimestamp() }); D.editing = null; document.activeElement?.blur(); }
    catch (err) { toast(niceErr(err)); }
  });
  $app.querySelectorAll("[data-del-cm]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Delete this comment?")) return;
    try { await deleteDoc(doc(db, "candidates", id, "comments", b.dataset.delCm)); } catch (err) { toast(niceErr(err)); }
  }));
  $app.querySelector('[data-act="pdf"]')?.addEventListener("click", (e) => {
    if (!driveId(c.pdfUrl) || e.metaKey || e.ctrlKey) return; // plain link if it isn't a file link
    e.preventDefault(); D.pdfOpen = !D.pdfOpen; drawDetail(c);
  });
  $app.querySelector('[data-act="zoom"]')?.addEventListener("click", () => {
    const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${c.photo}" alt="">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb);
  });
  if (!S.owner) return;
  $app.querySelector('[data-act="stage"]').onchange = (e) => saveCand(id, { stage: e.target.value }).then(() => toast(`Stage: ${e.target.value}`));
  $app.querySelector('[data-act="hide"]').onclick = () => saveCand(id, { hidden: !c.hidden }).then(() => toast(c.hidden ? "Family can see it again" : "Hidden from family"));
  $app.querySelector('[data-act="archive"]').onclick = () => saveCand(id, { archived: !c.archived }).then(() => toast(c.archived ? "Restored" : "Archived"));
  $app.querySelectorAll("[data-share]").forEach((cb) => (cb.onchange = () => {
    const set = new Set((c.sharedWith || []).map(lc)); cb.checked ? set.add(cb.dataset.share) : set.delete(cb.dataset.share);
    saveCand(id, { sharedWith: [...set] });
  }));
  $app.querySelector('[data-act="share-all"]')?.addEventListener("click", () => saveCand(id, { sharedWith: S.members.filter((m) => m.active && m.role !== "owner").map((m) => m.email) }).then(() => toast("Shared with everyone")));
  $app.querySelector('[data-act="share-none"]')?.addEventListener("click", () => saveCand(id, { sharedWith: [] }));
  const fp = document.getElementById("f-priv");
  if (fp) fp.onsubmit = async (e) => {
    e.preventDefault();
    D.priv = { contact: fp.contact.value.trim(), source: fp.source.value.trim(), notes: fp.notes.value.trim() };
    await setDoc(doc(db, "candidates", id, "private", "notes"), D.priv); document.activeElement?.blur(); toast("Notes saved");
  };
}

// ---------- upload a biodata PDF (goes to Harsh's Drive and becomes a profile, via the intake script) ----------
async function uploadPdf(file) {
  if (!file) return;
  if (!S.admin.intakeUrl) { toast("Add the intake link first: Family › Setup."); location.hash = "#/people"; return; }
  if (file.size > 15e6) { toast("That PDF is over 15 MB."); return; }
  const btn = document.getElementById("up-btn"); if (btn) { btn.classList.add("busy"); btn.firstChild.textContent = "Uploading…"; }
  try {
    const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
    const idToken = await S.user.getIdToken();
    // text/plain body keeps this a simple request (no CORS preflight), which Apps Script needs.
    const r = await (await fetch(S.admin.intakeUrl, { method: "POST", body: JSON.stringify({ idToken, file: { name: file.name, mimeType: file.type || "application/pdf", base64 } }) })).json();
    if (!r.ok) throw new Error(r.error || "Upload failed");
    toast(r.created ? `Added ${r.name}. Fill in the details.` : `PDF added to ${r.name}`);
    location.hash = `#/c/${r.id}`;
  } catch (e) { toast(niceErr(e)); if (btn) { btn.classList.remove("busy"); btn.firstChild.textContent = "Upload PDF"; } }
}

// ---------- add / edit ----------
const FIELDS = [
  ["name", "Full name", "text", true], ["dob", "Date of birth", "date"], ["age", "Age (if no date of birth)", "number"],
  ["community", "Community", "text"], ["native", "Native place", "text"], ["city", "Lives in (city / area)", "text"],
  ["education", "Education", "text"], ["work", "Work", "text"], ["family", "Family", "text"],
  ["marital", "Marital status", "text"], ["diet", "Diet", "text"],
];
function heightSelects(inch) {
  const ft = inch ? Math.floor(inch / 12) : "", i = inch ? inch % 12 : "";
  return `<div class="row2">
    <select class="in-t" name="hft"><option value="">Feet</option>${[4, 5, 6].map((x) => `<option ${x === ft ? "selected" : ""}>${x}</option>`).join("")}</select>
    <select class="in-t" name="hin"><option value="">Inches</option>${[...Array(12).keys()].map((x) => `<option ${x === i && ft !== "" ? "selected" : ""}>${x}</option>`).join("")}</select></div>`;
}
async function resizePhoto(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  let max = 640, q = 0.78, out;
  do {
    const k = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement("canvas");
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    out = cv.toDataURL("image/jpeg", q); max -= 120; q -= 0.08;
  } while (out.length > 300_000 && max > 200);
  return out;
}
function viewEdit(id) {
  const c = id ? S.cands.get(id) : { stage: "New" };
  if (!c) { location.hash = "#/"; return; }
  let photo = c.photo || "";
  $app.innerHTML = shell(`
    <a class="back" href="${id ? `#/c/${id}` : "#/"}">‹ ${id ? "Back" : "Profiles"}</a>
    <div class="ph"><h2>${id ? "Edit profile" : "Add profile"}</h2></div>
    <form id="f-edit">
      <div class="hero" style="margin-top:0"><div class="ph-img" id="pv">${photo ? `<img src="${photo}" alt="">` : "+"}</div>
        <div><label class="btn ghost sm">Choose photo<input type="file" accept="image/*" name="photo" hidden></label>
        ${photo ? ` <button class="btn plain sm" type="button" data-act="nophoto">Remove</button>` : ""}<div class="hint" style="margin-top:6px">Kept small, only in this app.</div></div></div>
      <label class="f"><span>Stage</span><select class="in-t" name="stage">${STAGES.map((s) => `<option ${s === (c.stage || "New") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      ${FIELDS.slice(0, 3).map(fieldHtml(c)).join("")}
      <label class="f"><span>Height</span>${heightSelects(c.heightIn)}</label>
      ${FIELDS.slice(3).map(fieldHtml(c)).join("")}
      <label class="f"><span>About</span><textarea class="in-t" name="about">${esc(c.about)}</textarea></label>
      <label class="f"><span>Biodata PDF (Google Drive link)</span><input class="in-t" name="pdfUrl" type="url" inputmode="url" placeholder="https://drive.google.com/file/d/…" value="${esc(c.pdfUrl)}"></label>
      <div class="err" id="err"></div>
      <button class="btn wide" type="submit">${id ? "Save" : "Add profile"}</button>
      ${id ? `<button class="btn danger wide" type="button" data-act="delete" style="margin-top:12px">Delete for good</button>` : ""}
    </form>`, "list");
  const f = document.getElementById("f-edit");
  f.photo.onchange = async () => { const file = f.photo.files[0]; if (!file) return; photo = await resizePhoto(file); document.getElementById("pv").innerHTML = `<img src="${photo}" alt="">`; };
  $app.querySelector('[data-act="nophoto"]')?.addEventListener("click", () => { photo = ""; document.getElementById("pv").textContent = "+"; });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    FIELDS.forEach(([k, , t]) => { const v = f[k].value.trim(); data[k] = t === "number" ? (v ? +v : null) : v; });
    data.stage = f.stage.value; data.about = f.about.value.trim(); data.photo = photo;
    data.pdfUrl = f.pdfUrl.value.trim();
    if (data.pdfUrl && !isDrive(data.pdfUrl)) { document.getElementById("err").textContent = "The PDF link must be a Google Drive link."; return; }
    data.heightIn = f.hft.value ? +f.hft.value * 12 + (+f.hin.value || 0) : null;
    if (!data.name) { document.getElementById("err").textContent = "Name is needed."; return; }
    try {
      if (id) { await saveCand(id, data); location.hash = `#/c/${id}`; }
      else {
        const full = { ...data, sharedWith: [], hidden: false, archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        full.viewers = viewersOf(full);
        const ref = await addDoc(collection(db, "candidates"), full); location.hash = `#/c/${ref.id}`;
      }
      toast("Saved");
    } catch (err) { document.getElementById("err").textContent = niceErr(err); }
  };
  $app.querySelector('[data-act="delete"]')?.addEventListener("click", async () => {
    if (!confirm(`Delete ${c.name} with all ratings and comments? This can't be undone.`)) return;
    const b = writeBatch(db);
    for (const sub of ["reviews", "comments", "private"]) (await getDocs(collection(db, "candidates", id, sub))).forEach((d) => b.delete(d.ref));
    b.delete(doc(db, "candidates", id)); await b.commit(); location.hash = "#/"; toast("Deleted");
  });
}
const fieldHtml = (c) => ([k, l, t, req]) => `<label class="f"><span>${l}</span><input class="in-t" name="${k}" type="${t}" value="${esc(c[k] ?? "")}" ${req ? "required" : ""}></label>`;

// ---------- import (CSV or JSON) ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  const keys = head.map((h) => lc(h).replace(/[^a-z]/g, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()])));
}
function normCand(r) {
  const pick = (...ks) => { for (const k of ks) if (r[k] != null && r[k] !== "") return String(r[k]).trim(); return ""; };
  const stage = STAGES.find((s) => lc(s) === lc(pick("stage"))) || "New";
  return {
    c: { name: pick("name", "fullname"), dob: pick("dob", "dateofbirth", "birthdate"), age: +pick("age") || null,
      heightIn: parseHeight(r.heightIn ?? r.heightin ?? r.height), community: pick("community", "caste"), native: pick("native", "nativeplace"),
      city: pick("city", "livesin", "location"), education: pick("education"), work: pick("work", "profession", "occupation"),
      family: pick("family"), marital: pick("marital", "maritalstatus"), diet: pick("diet"), about: pick("about", "notesforfamily"),
      pdfUrl: isDrive(pick("pdfUrl", "pdfurl", "pdf")) ? pick("pdfUrl", "pdfurl", "pdf") : "",
      stage, photo: "", sharedWith: [], viewers: [], hidden: false, archived: false },
    p: { contact: pick("contact", "phone"), source: pick("source", "from"), notes: pick("notes", "privatenotes") },
  };
}
function viewImport() {
  $app.innerHTML = shell(`
    <a class="back" href="#/">‹ Profiles</a>
    <div class="ph"><h2>Import profiles</h2></div>
    <p class="hint">Paste CSV with a header row, or JSON. Columns: name, dob, age, height (5'4" or 163 cm), community, native, city, education, work, family, marital, diet, about, stage, pdf (Drive link). Private columns (only you see): contact, source, notes. New profiles are shared with no one until you choose.</p>
    <label class="f"><textarea class="in-t" name="data" style="min-height:220px;font-family:ui-monospace,monospace;font-size:13px" placeholder="name,height,city,community,stage"></textarea></label>
    <label class="btn ghost sm">Choose a file<input type="file" accept=".csv,.json,text/csv,application/json" hidden name="file"></label>
    <div class="err" id="err"></div><div class="hint" id="pre"></div>
    <button class="btn wide" data-act="go" style="margin-top:14px">Import</button>`, "list");
  const ta = $app.querySelector("textarea"), err = document.getElementById("err"), pre = document.getElementById("pre");
  let parsed = null;
  const parse = () => {
    err.textContent = ""; parsed = null; const t = ta.value.trim(); if (!t) { pre.textContent = ""; return; }
    try {
      let rows, harsh = null, settings = null;
      if (/^[\[{]/.test(t)) { const j = JSON.parse(t); rows = Array.isArray(j) ? j : j.candidates || []; harsh = j.harsh || null; settings = j.settings || null; }
      else rows = parseCSV(t);
      parsed = { rows: rows.map(normCand).filter((x) => x.c.name), harsh, settings };
      pre.textContent = `Ready: ${parsed.rows.length} profile${parsed.rows.length === 1 ? "" : "s"}${harsh ? " and Harsh's biodata" : ""}. ` +
        parsed.rows.map((x) => x.c.name).join(", ");
    } catch (e) { err.textContent = "Couldn't read that: " + e.message; }
  };
  ta.oninput = parse;
  $app.querySelector('input[name="file"]').onchange = async (e) => { ta.value = await e.target.files[0].text(); parse(); };
  $app.querySelector('[data-act="go"]').onclick = async () => {
    if (!parsed?.rows.length && !parsed?.harsh) { err.textContent = "Nothing to import."; return; }
    const b = writeBatch(db);
    for (const { c, p } of parsed.rows) {
      const ref = doc(collection(db, "candidates"));
      b.set(ref, { ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      if (p.contact || p.source || p.notes) b.set(doc(db, "candidates", ref.id, "private", "notes"), p);
    }
    if (parsed.harsh) b.set(doc(db, "reference", "harsh"), parsed.harsh);
    if (parsed.settings?.driveFolder && isDrive(parsed.settings.driveFolder)) b.set(doc(db, "reference", "settings"), { ...S.settings, driveFolder: parsed.settings.driveFolder });
    try { await b.commit(); toast(`Imported ${parsed.rows.length}`); location.hash = "#/"; } catch (e) { err.textContent = niceErr(e); }
  };
}

// ---------- family (people) ----------
function viewPeople() {
  const url = location.origin + "/";
  const people = S.members.filter((m) => m.role !== "owner");
  const count = (e) => [...S.cands.values()].filter((c) => (c.viewers || []).includes(e)).length;
  $app.innerHTML = shell(`
    <div class="ph"><h2>Family</h2></div>
    <p class="hint" style="margin-top:-6px">Add someone here, then send them the invite yourself. They sign in with this exact email.</p>
    <form id="f-add" class="card">
      <div class="row2"><label class="f"><span>Name</span><input class="in-t" name="name" required placeholder="Mummy"></label>
      <label class="f"><span>Email</span><input class="in-t" name="email" type="email" required inputmode="email"></label></div>
      <button class="btn" type="submit">Add</button><div class="err" id="err"></div>
    </form>
    <details class="grp" ${S.admin.intakeUrl && S.settings.driveFolder ? "" : "open"}><summary>Setup<span class="sp"></span><span class="car"></span></summary>
    <form id="f-drive" style="padding:16px">
      <label class="f"><span>Drive folder with the biodata PDFs</span><input class="in-t" name="folder" type="url" inputmode="url" placeholder="https://drive.google.com/drive/folders/…" value="${esc(S.settings.driveFolder)}"></label>
      <div class="hint" style="margin:-6px 0 14px">Everyone here needs view access to this folder. In Drive: Share › add their email › Viewer.</div>
      <label class="f"><span>Intake link (Apps Script web app)</span><input class="in-t" name="intake" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.admin.intakeUrl)}"></label>
      <div class="hint" style="margin:-6px 0 14px">Only you see this. It lets "Upload PDF" and the Seema Aunty bot add profiles.</div>
      <button class="btn ghost sm" type="submit">Save</button>${isDrive(S.settings.driveFolder) ? ` <a class="btn plain sm" href="${esc(S.settings.driveFolder)}" target="_blank" rel="noopener">Open folder ↗</a>` : ""}
    </form></details>
    <section class="card people">
      ${people.length ? people.map((m) => `<div class="p">
        <div class="av">${esc(initials(m.name))}</div>
        <div class="m"><div style="font-weight:600">${esc(m.name)} ${m.active ? "" : `<span class="tag mute">Paused</span>`}</div>
          <div class="e">${esc(m.email)} · sees ${count(m.email)}</div></div>
        <button class="btn ghost sm" data-copy="${esc(m.email)}">Copy invite</button>
        <button class="btn plain sm" data-toggle="${esc(m.email)}">${m.active ? "Pause" : "Resume"}</button>
        <button class="btn plain sm" data-remove="${esc(m.email)}" aria-label="Remove">✕</button>
      </div>`).join("") : `<div class="hint">No one yet.</div>`}
    </section>`, "people");
  const f = document.getElementById("f-add");
  f.onsubmit = async (e) => {
    e.preventDefault(); const email = lc(f.email.value), name = f.name.value.trim();
    if (email === lc(OWNER_EMAIL)) { document.getElementById("err").textContent = "That's you."; return; }
    try { await setDoc(doc(db, "members", email), { name, role: "reviewer", active: true, addedAt: serverTimestamp() }); f.reset(); document.activeElement?.blur(); toast(`${name} added`); }
    catch (err) { document.getElementById("err").textContent = niceErr(err); }
  };
  const fd = document.getElementById("f-drive");
  fd.onsubmit = async (e) => {
    e.preventDefault(); const u = fd.folder.value.trim(), i = fd.intake.value.trim();
    if (u && !isDrive(u)) { toast("The folder must be a Google Drive link."); return; }
    if (i && !/^https:\/\/script\.google(usercontent)?\.com\//.test(i) && !LOCAL) { toast("The intake link must start with https://script.google.com/"); return; }
    await setDoc(doc(db, "reference", "settings"), { ...S.settings, driveFolder: u });
    await setDoc(doc(db, "admin", "settings"), { ...S.admin, intakeUrl: i }); document.activeElement?.blur(); toast("Saved");
  };
  $app.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
    const m = S.members.find((x) => x.email === b.dataset.copy);
    const msg = `Hi ${m.name.split(" ")[0]}, I've added you to Circle so you can look at a few profiles with me and share what you think. Open ${url} and sign in with ${m.email}. You'll get a sign-in link by email.${isDrive(S.settings.driveFolder) ? ` The biodata PDFs are here: ${S.settings.driveFolder}` : ""}`;
    try { await navigator.clipboard.writeText(msg); toast("Invite copied. Send it yourself."); } catch { prompt("Copy this invite:", msg); }
  }));
  $app.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = () => {
    const m = S.members.find((x) => x.email === b.dataset.toggle); updateDoc(doc(db, "members", m.email), { active: !m.active });
  }));
  $app.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => {
    const email = b.dataset.remove; if (!confirm(`Remove ${email}? They lose access at once. Their old comments stay.`)) return;
    await deleteDoc(doc(db, "members", email));
    const batch = writeBatch(db);
    S.cands.forEach((c) => { if ((c.sharedWith || []).includes(email)) { const sw = c.sharedWith.filter((x) => x !== email); batch.update(doc(db, "candidates", c.id), { sharedWith: sw, viewers: viewersOf({ ...c, sharedWith: sw }) }); } });
    await batch.commit(); toast("Removed");
  }));
}

// ---------- Harsh's biodata ----------
const HFIELDS = [["name", "Name"], ["dob", "Born"], ["height", "Height"], ["community", "Community"], ["native", "Native"], ["marital", "Marital status"],
  ["city", "Lives in"], ["education", "Education"], ["work", "Work"], ["family", "Family"], ["diet", "Diet"]];
function viewHarsh() {
  const h = S.harsh;
  $app.innerHTML = shell(`
    <div class="ph"><h2>Harsh's biodata</h2>${S.owner ? `<a class="btn ghost sm" href="#/harsh/edit">Edit</a>` : ""}</div>
    ${h ? `<section class="card"><div class="hero" style="margin:0 0 14px"><div class="ph-img">${h.photo ? `<img src="${h.photo}" alt="">` : esc(initials(h.name))}</div>
      <div><h1>${esc(h.name)}</h1><span class="tag blue">For reference</span></div></div>
      ${isDrive(h.pdfUrl) ? `<a class="pdf" href="${esc(h.pdfUrl)}" target="_blank" rel="noopener"><span class="ic">PDF</span><span class="sp">Harsh's biodata PDF</span><span class="go">Open ↗</span></a>` : ""}
      <dl class="facts">${HFIELDS.slice(1).filter(([k]) => h[k]).map(([k, l]) => `<dt>${l}</dt><dd>${esc(k === "dob" ? fmtDob(h[k]) : h[k])}</dd>`).join("")}</dl>
      ${h.about ? `<p class="about">${esc(h.about)}</p>` : ""}</section>
      <p class="hint">Height rule: a partner's height must be at or under 5′6″.</p>`
      : `<div class="empty">Not added yet.</div>`}`, "harsh");
}
function viewHarshEdit() {
  const h = S.harsh || {};
  $app.innerHTML = shell(`<a class="back" href="#/harsh">‹ Back</a><div class="ph"><h2>Edit Harsh's biodata</h2></div>
    <form id="f-h">${HFIELDS.map(([k, l]) => `<label class="f"><span>${l}</span><input class="in-t" name="${k}" type="${k === "dob" ? "date" : "text"}" value="${esc(h[k])}"></label>`).join("")}
    <label class="f"><span>About</span><textarea class="in-t" name="about">${esc(h.about)}</textarea></label>
    <button class="btn wide" type="submit">Save</button></form>`, "harsh");
  const f = document.getElementById("f-h");
  f.onsubmit = async (e) => {
    e.preventDefault(); const d = { ...h };
    HFIELDS.forEach(([k]) => (d[k] = f[k].value.trim())); d.about = f.about.value.trim();
    await setDoc(doc(db, "reference", "harsh"), d); location.hash = "#/harsh"; toast("Saved");
  };
}

// ---------- boot ----------
(async function boot() {
  if (isSignInWithEmailLink(auth, location.href)) {
    const email = lsGet(LS_EMAIL);
    if (email) { try { await finishLinkSignIn(email); } catch (e) { renderSignIn("ask", { err: niceErr(e) }); } }
    else renderSignIn("confirm");
  }
  onAuthStateChanged(auth, async (user) => {
    stopAll(); S.user = user; S.me = null; S.cands = new Map(); S.summaries = new Map();
    if (!user) { if (!isSignInWithEmailLink(auth, location.href)) renderSignIn("ask"); return; }
    const email = lc(user.email);
    S.owner = email === lc(OWNER_EMAIL);
    let member = null;
    try { const d = await getDoc(doc(db, "members", email)); member = d.exists() ? d.data() : null; } catch {}
    if (!S.owner && (!member || !member.active)) { renderNotInvited(); return; }
    S.me = { email, name: member?.name || (S.owner ? "Harsh" : ""), role: S.owner ? "owner" : "reviewer" };
    S.route = ""; $app.innerHTML = `<div class="spin">Loading…</div>`;
    startData();
  });
})();
