# Report service

"Report a problem" in TreeMapper sends each report to a Cloudflare Worker (`worker.js`). The
Worker files it as an issue in a **private** GitHub repository, with the report file stored
beside it. Opening that file in TreeMapper restores the user's session.

Users only write what happened and press **Send report**. The setup below is a one-time job
for the author, and it is all free.

## 1. GitHub: a private repository

1. On github.com, click **+** (top right) → **New repository**.
2. Name: `TreeMapper-reports`. Choose **Private**. Turn on **Add a README**.
3. Click **Create repository**.

## 2. GitHub: a token for that repository only

1. Open <https://github.com/settings/personal-access-tokens/new>. This is in your account
   settings (profile picture → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens), not in the repository's settings.
2. **Token name:** `treemapper-report`. **Expiration:** the longest offered. When it
   expires, make a new token and repeat step 3.4.
3. **Repository access:** **Only select repositories** → `TreeMapper-reports`.
4. **Permissions:** **Add permissions** → **Issues** and **Contents**. Set both to
   **Read and write** (they start as Read-only).
5. Click **Generate token** and copy it. It starts with `github_pat_` and is shown only once.

## 3. Cloudflare: the Worker

1. Sign up at <https://dash.cloudflare.com/sign-up> (email and password; free plan).
2. **Workers & Pages** → **Create application** → **Start with Hello World**.
   Name: `treemapper-report`. Leave everything else as it is (Cloudflare Access stays
   **off**, or users' reports would be blocked). Click **Deploy**.
3. On the Worker's page, click **Edit code** (top right). Select all the code in the editor and
   delete it. Paste in all of `worker.js` from this folder. Click **Deploy**.
4. Back on the Worker's page: **Settings** → **Variables and secrets** → **Add variable**.
   In the dialog (Production ticked, Previews unticked):
   - Key `REPO`, Value `mbuyukyoruk/TreeMapper-reports`, **Secret** unticked
   - **+ Add** → Key `GITHUB_TOKEN`, Value: the token from step 2, **Secret** ticked
   - Click **Add 2 variables and deploy**.
5. Click **Visit** (top right). The page should show `{"ok":false,"error":"POST a report"}`.
   That means it is working. Copy the address, e.g.
   `https://treemapper-report.<your-name>.workers.dev`.

## 4. TreeMapper: point the app at it

In `js/report.js`, set `REPORT_ENDPOINT` to that address. The "Report a problem" button only
appears once this is set.

## What a report contains

- **Always:** the user's description, the app version, the browser and window, the tree size
  and layer list, the errors on the page, and the last status messages.
- **With "Include my tree and data layers" on (the default):** the session, so the problem can
  be seen. A report too large to send whole drops the drawing first, then the data.

Everything stays in the private repository.

## Handled reports

Move a handled report's file from `reports/` to `resolved/` in the reports repository and close
its issue. Issue links name the commit that stored the file, so they keep working after the move
(reports filed before 2026-10-25 01:30 UTC link by path; look for those in `resolved/`).

## If something goes wrong

- **Visit shows "The report service is not set up":** a variable is missing or misspelled.
  The keys must be exactly `REPO` and `GITHUB_TOKEN`.
- **Reports fail with "GitHub 401":** the token has expired or was pasted wrong. Make a new
  one (step 2) and replace `GITHUB_TOKEN`.
- **Reports fail with "GitHub 403" or "404":** the token is missing a permission, or `REPO` is
  misspelled.
- **Abuse:** the Worker has no rate limit. Deleting the token on GitHub stops it at once.

Free Workers plan: 100,000 requests a day, which is far more than needed. Reports can be up
to about 9 MB.

Tests: `TreeMapper_tests/regress/reportworker.js` (the Worker, GitHub replaced by a recorder)
and `reportsend.js` (the dialog).
