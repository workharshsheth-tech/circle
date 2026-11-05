# Seema Aunty bot → Circle

**Simplest path (in use):** the bot saves each biodata in Drive › Seema Aunty · Biodatas › **From chat**, and only there.
Circle's script checks that folder every 15 minutes and adds or fills in the profile (source "Seema Aunty").
Nothing below is needed for that. Other folders (e.g. Bina's batch) are one-time imports; the bot never writes to them.

## Optional: the bot posts directly

When a biodata PDF reaches the Seema Aunty bot, the bot reads it and sends it to Circle's intake link.
Circle saves the PDF in Harsh's Drive folder and adds the profile, or fills in a profile with the same name.

What Circle does with it:
- New profile goes to stage **New**, shared with **no one**. Harsh decides who sees it.
- Height pass / fail against 5′6″ is worked out from the height.
- Contact numbers and source go to "Only you see this", never to family.
- Same name already in Circle: only empty fields are filled and the PDF is attached. Harsh's edits are never overwritten.

## Settings for the bot (Harsh enters these himself; never paste them in a chat)

- Intake link: the Apps Script web app URL (ends in `/exec`).
- Secret: the `BOT_SECRET` from the Apps Script's Script properties.

## What the bot sends

`POST` to the intake link, body as JSON text, following redirects:

```json
{
  "secret": "<BOT_SECRET>",
  "source": "WhatsApp from Seema Aunty, 5 Nov",
  "fileUrl": "<a direct download link to the PDF>",
  "fileName": "Shivani Malik Biodata.pdf",
  "fields": {
    "name": "Shivani Malik",
    "dob": "1993-04-12",
    "age": 33,
    "height": "5 ft 4 in",
    "community": "Jain",
    "native": "Lakhtar",
    "city": "Andheri West, Mumbai",
    "education": "MBA",
    "work": "Product manager",
    "family": "Father in textiles, one brother",
    "marital": "Never married",
    "diet": "Jain vegetarian",
    "about": "Two lines from the biodata in plain words",
    "contact": "Father, 98xxxxxxxx",
    "notes": "Anything only Harsh should see"
  }
}
```

- Instead of `fileUrl`, the bot may send the file itself: `"file": { "name": "x.pdf", "base64": "<file as base64>" }`.
- Every field is optional except that there must be a `name` or a file. Leave out anything not in the biodata; don't guess.
- The reply is `{ "ok": true, "id": "...", "created": true, "name": "...", "heightFit": "pass" | "fail" | "unknown" }`
  or `{ "ok": true, "updated": true, ... }`, or `{ "ok": false, "error": "..." }`.

## Text to give Grok for the bot

> When I send you a marriage biodata (PDF or photo), read it and send it to Circle.
> Fill only what the biodata says: name, dob (YYYY-MM-DD), age, height, community, native, city, education, work,
> family, marital, diet, about (two plain lines). Put phone numbers in contact, never in about.
> Use the Circle intake link and secret from your settings. Then reply in one line:
> "<Name> added to Circle · Height <pass/fail/not known>" or the error.
> Never send or forward the biodata to anyone else.
