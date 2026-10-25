# Report service

The "Report a problem" button in TreeMapper sends each report here. A Cloudflare Worker files
it as an issue in a **private** GitHub repository and stores the report file next to it.
Opening that file in TreeMapper restores the user's session.

Users need nothing: they write what happened and press **Send report**. The steps below are a
one-time setup for the author, and all of them are free.

## 1. A private repository for the reports

On GitHub, create a new repository named `TreeMapper-reports`. Make it **Private**, and tick
"Add a README" so it starts with a branch.

## 2. A token that can only file reports there

Open <https://github.com/settings/personal-access-tokens/new>. That is your **account**
settings, not the repository's: your profile picture → Settings → Developer settings (at the
bottom of the left sidebar) → Personal access tokens → Fine-grained tokens → Generate new token.

- **Repository access:** Only select repositories → `TreeMapper-reports`
- **Permissions:** these appear once the repository is chosen. Click **Add permissions** (older
  pages: *Repository permissions*), add **Issues** and **Contents**, and set both to
  *Read and write* (they start as Read-only).
- **Expiration:** up to a year. Note the date; when the token expires, generate a new one and
  repeat step 3's secret.

Copy the token (it is shown once).

## 3. The Worker on Cloudflare

1. Sign up at <https://dash.cloudflare.com> (free plan, no card needed).
2. **Workers & Pages → Create → Create Worker**, name it `treemapper-report`, **Deploy**.
3. **Edit code**: replace everything with the contents of `worker.js` from this folder, then **Deploy**.
4. The Worker's **Settings → Variables and secrets → Add**:
   - `REPO` (type *Text*): `mbuyukyoruk/TreeMapper-reports`
   - `GITHUB_TOKEN` (type *Secret*): the token from step 2
5. Copy the Worker's address, e.g. `https://treemapper-report.<your-name>.workers.dev`.

## 4. Point TreeMapper at it

In `js/report.js`, set `REPORT_ENDPOINT` to that address. The "Report a problem" button only
appears once it is set.

## What a report contains

- **Always:** the user's description, the app version, the browser and window, the tree size
  and layer list, the errors on the page, and the last status messages.
- **With "Include my tree and data layers" on (the default):** the session, so the problem can be
  seen. The drawing (SVG) is optional. A report too large to send whole drops the drawing
  first, then the data.

Everything stays in the private repository. Nothing is published.

## Limits

Free Workers plan: 100,000 requests a day and 10 ms of CPU per request. The Worker only
passes the file on (the page encodes it), so this is plenty. Reports up to about 9 MB.
There is no rate limit: if the address is ever abused, delete the Worker or the token.

Tests: `TreeMapper_tests/regress/reportworker.js` (the Worker, GitHub replaced by a recorder)
and `reportsend.js` (the dialog).
