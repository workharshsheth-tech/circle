# Circle · Harsh's family review

Private, invite-only app where Harsh shares marriage biodatas with close family, who rate (1–5 stars) and comment.
Not a public site: no sign-up, no search indexing, no link previews of profiles.

## Stack (and why)

Firebase Auth ("Continue with Google", email link as backup) + Firestore (security rules) + Firebase Hosting, plain HTML/JS, no build step.

- Free Spark plan, owned in Harsh's own Google account. Does not pause when idle (Supabase free does).
- "Continue with Google": on an Android phone the family is already signed into Google, so it is one tap. No passwords, no codes.
  Email link stays as a backup for anyone without a Google account. Phone OTP is possible later but needs the paid plan.
- All access is enforced in `firestore.rules`, not in the page. A reviewer who opens dev tools still gets only what is shared with them.
- Owner is fixed in the rules (`work.harshsheth@gmail.com`), so no data change can make anyone else admin.
- No service or admin key anywhere. `public/config.js` holds only the public web config.

## Who sees what

- Profiles: Harsh sees all; family sees only ones shared with them (and not hidden or archived); anyone else sees nothing.
- Ratings: Harsh sees everyone's; family see their own, and others' only after they rate (blind first).
- Comments: Harsh sees all; family see comments on profiles shared with them.
- Private notes (contact, source, notes): Harsh only.
- Harsh's biodata: Harsh edits; family read.

Pausing or removing a person cuts access at once.

## How Harsh invites someone

1. Open the app > **Family** > type name and email > **Add**.
2. Tap **Copy invite** and send it yourself (WhatsApp, Wispr). The app never sends anything.
3. Open a profile > **Shared with** > tick the person (or **Everyone**).
4. They open the link in Chrome and tap **Continue with Google**, picking the same email you added. Done; it stays signed in.
   If they open it inside WhatsApp, the page shows an **Open in Chrome** button first.
   Then they tap **Install** on the "Install Circle" card (Android), or on iPhone: Safari > Share > **Add to Home Screen**.
   Circle then opens from its own icon like an app. Nothing to download from a store; updates arrive by themselves.

Someone not on the list who tries to sign in sees "Not on the list yet" and no data.

## Adding profiles

- One at a time: **+ Add profile** (photo is shrunk to under 300 KB and kept only in Firestore).
- Many at once: **Profiles > Import**, paste CSV or JSON. Columns: name, dob, age, height (5'4" or 163 cm),
  community, native, city, education, work, family, marital, diet, about, stage. Private columns: contact, source, notes.
- Seed file: `seed/seed.json` (git-ignored, so candidate data never goes into git). It also fills Harsh's biodata.
- New profiles are shared with no one until Harsh ticks people.

## Biodata PDFs (Google Drive)

- PDFs stay in Harsh's Google Drive; the app only holds the link. Nothing is copied to another server.
- On a profile: **Edit > Biodata PDF (Google Drive link)**. Family taps **Biodata PDF** to view it inside the app.
- **Family > Drive folder**: paste the folder link once. Everyone sees a one-line "All biodata PDFs in Drive" link and it goes into the invite message.
- Drive decides who can open the PDFs, not the app. Share the folder in Drive with each family email as **Viewer**.
  Keep the folder on "Restricted", not "Anyone with the link".
- Import also takes a `pdf` column with the Drive link.

## How a rishta moves in Circle

Stages follow the family's usual path: **New → Mothers in touch → Biodatas exchanged → Kundli check → Families meet →
Harsh meets her → Going ahead**, plus **On hold** and **Pass**.

- **Family's part** (on every profile, filled by Mummy, Papa or anyone it's shared with): spoke to her mother (and when),
  biodatas exchanged, kundli (Pending / Match / No match), and what they felt about her family.
- **Harsh's part** (only Harsh sees): **My call** (Yes / Not sure / No) and private notes on each profile.
- **My criteria** tab (only Harsh): what he wants and how much it matters (Must / Nice / Doesn't matter), deal-breakers,
  what he learnt from meetings, thinking out loud. Each profile shows "Against my criteria"; the list flags "Misses a must".
- **Sources** tab (only Harsh): every biodata grouped by where it came from (Pratima Ben, Bina Ben, matrimonial site,
  Seema Aunty…), and how many from each moved ahead. Set it on a profile under Edit › "Biodata came from".
- **Profiles list**: grouped by stage, numbered 1–8 along the path. Filters: Stage, Source, Harshaben (passed / not / not yet),
  Community (all Jain groups as "Jain"), Language (choose several), City, and Height last.

## New biodatas arrive by themselves

The Seema Aunty bot already saves biodatas in Drive › **Seema Aunty · Biodatas › From chat**. A small Google Apps Script
(`apps-script/`, running as Harsh) checks that folder every 15 minutes. For each new girl it reads the biodata with
Google's own text reading, adds her in **New** (shared with no one), fills height, date of birth, community, native,
education, work and marital status, attaches the PDF, sets the source, and adds her photo: a separate photo file
if Seema Aunty saved one, otherwise the best picture inside the biodata PDF (page backgrounds and banners are skipped). If she's already in Circle, it only fills
empty fields. Phones, emails and addresses are left out. Harsh's own biodata is skipped.

The same script powers **Profiles › Upload PDF**. Optionally the bot can post to it directly (`docs/seema-bot.md`).

### Set up the script (one time, about 10 minutes)

1. https://script.google.com > **New project**, name it "Circle intake" (signed in as work.harshsheth@gmail.com).
2. **Project settings** (gear) > tick **Show "appsscript.json"**. In the editor, replace `appsscript.json` and `Code.gs`
   with the files in `apps-script/` from GitHub.
3. **Project settings > Script properties > Add**: `PROJECT_ID` = `circle-88f2b`, `API_KEY` = the apiKey in `public/config.js`,
   `FOLDER_ID` = `1KW3nb2zWCn0uI7F8Bkt2_0W9-KRyWzzu` (From chat), `OWNER_EMAIL` = `work.harshsheth@gmail.com`.
4. In the editor, pick **setupCheck** in the function list > **Run** > allow the permissions (Advanced > Go to Circle intake).
   The log should say "All good". Then pick **installTrigger** > **Run**.
5. For **Upload PDF** and **Edit › From biodata** (pick and crop her photo from the biodata): **Deploy > New deployment > Web app**, Execute as **Me**, access **Anyone** > Deploy.
   Paste the web app URL in Circle under **Family > Setup > Intake link**.

## Set up (one time, about 15 minutes)

1. https://console.firebase.google.com > **Add project** (signed in as work.harshsheth@gmail.com). Analytics off.
2. **Authentication > Get started > Sign-in method**:
   - **Google** > Enable, support email work.harshsheth@gmail.com > Save.
   - **Email/Password** > turn on **Email link (passwordless sign-in)** > Save.
3. **Authentication > Settings > User actions**: leave "Create" on (needed for email link), turn on **Email enumeration protection**.
4. **Build > Firestore Database > Create database**, production mode, region `asia-south1` (Mumbai).
5. **Project settings > Your apps > Web (</>)**, register "circle". Copy the config into `public/config.js`.
6. On a laptop: `npm install`, then `npx firebase login`, `npx firebase use --add` (pick the project),
   then `npm run deploy`. This uploads the site and the security rules.
7. **Authentication > Settings > Authorized domains**: the `*.web.app` domain is there already. Add a custom domain only if you use one.
8. Open the site, sign in with work.harshsheth@gmail.com, **Profiles > Import** the seed file.

No environment variables are needed. If you change the owner email, change it in both `firestore.rules` and `public/config.js`.

## Run and test locally

- `npm run dev` starts local Auth, Firestore and Hosting emulators. Open http://localhost:5000.
  Sign-in links appear at http://127.0.0.1:9099/emulator/v1/projects/demo-family-review/oobCodes.
- `npm test` runs the security rules tests (10), intake tests (5) and folder-watcher tests (6).
- `node tests/e2e.mjs` (with `npm run dev` running) drives a real browser: owner signs in, imports, invites,
  shares; reviewer signs in, rates, comments; a stranger is turned away. Screenshots go to `shots/`.

## Later, if needed

- Daily backup: Firestore export needs the paid Blaze plan; until then, copy data out by hand if wanted.
- Password sign-in as a backup: turn on Email/Password in step 2 and add a password form. Left off to keep one way in.
