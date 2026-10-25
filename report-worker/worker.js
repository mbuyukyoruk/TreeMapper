// TreeMapper "Report a problem": a Cloudflare Worker that files each report as an issue in a
// private GitHub repository (deployment: README.md next to this file).
//
// The page (js/report.js) posts a form with two parts:
//   meta  JSON: { description, app, browser, tree, errors, actions, hasData, hasSvg, website }
//         ("website" is a field people never see: a form that fills it is a bot)
//   file  the report file (.treemapper-report.json), already base64-encoded by the page, so
//         that this Worker only passes it on (a Worker on the free plan has 10 ms of CPU)
// The file is stored in the repository as reports/<id>.treemapper-report.json and the issue
// links to it; opening the file in TreeMapper restores the user's session.
//
// Settings (Cloudflare: the Worker's Settings → Variables and secrets):
//   GITHUB_TOKEN  secret: a fine-grained token for the reports repository only, with
//                 "Issues: read and write" and "Contents: read and write"
//   REPO          e.g. mbuyukyoruk/TreeMapper-reports (a private repository)

const MAX_META = 64 * 1024;            // characters of the meta part
const MAX_FILE_B64 = 12 * 1024 * 1024; // characters of the base64 file (about 9 MB of report)
const MAX_TEXT = 5000;                 // characters of the description

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

// text for the issue: no code fences broken, no one @-mentioned
const clean = (s, n) => String(s == null ? '' : s).slice(0, n).replace(/```/g, "'''").replace(/(^|[\s(])@(?=[A-Za-z])/g, '$1@​');
const cell = (s) => clean(s, 300).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function issueBody(meta, id, fileUrl) {
  const b = meta.browser || {}, t = meta.tree || null;
  const rows = [
    ['App version', meta.app || 'unknown'],
    ['Browser', b.userAgent || ''],
    ['Window', (b.viewport ? b.viewport.join(' × ') : '') + (b.devicePixelRatio ? ' @' + b.devicePixelRatio + 'x' : '') + (b.theme ? ', ' + b.theme + ' theme' : '')],
    ['Page', b.url || ''],
    ['Tree', t ? t.tips + ' tips' + (t.layers && t.layers.length ? ' · ' + t.layers.join(', ') : '') : 'none loaded'],
    ['Tree and data included', meta.hasData ? 'yes' : 'no'],
    ['Report file', fileUrl ? '[' + id + '.treemapper-report.json](' + fileUrl + ')' : 'not stored']
  ];
  const errs = Array.isArray(meta.errors) ? meta.errors.slice(-20) : [];
  const acts = Array.isArray(meta.actions) ? meta.actions.slice(-20) : [];
  let s = '**What happened**\n\n```text\n' + clean(meta.description, MAX_TEXT) + '\n```\n\n';
  s += '| | |\n|---|---|\n' + rows.map(r => '| ' + r[0] + ' | ' + cell(r[1]) + ' |').join('\n') + '\n\n';
  s += '<details><summary>Errors on the page (' + errs.length + ')</summary>\n\n```text\n' +
    (errs.length ? errs.map(e => clean((e.t != null ? e.t + ' s  ' : '') + e.message + (e.where ? '  (' + e.where + ')' : '') + (e.stack ? '\n' + e.stack : ''), 1200)).join('\n\n') : 'none') + '\n```\n</details>\n\n';
  s += '<details><summary>Last status messages (' + acts.length + ')</summary>\n\n```text\n' +
    (acts.length ? acts.map(a => clean((a.t != null ? a.t + ' s  ' : '') + a.m, 300)).join('\n') : 'none') + '\n```\n</details>\n\n';
  s += '_To see it: download the report file and open it in TreeMapper (Open, or drop it on the page); it restores the session' + (meta.hasData ? '' : ' settings (no tree or data were included)') + '. Report ' + id + '._';
  return s;
}

async function gh(env, path, method, body) {
  const r = await fetch('https://api.github.com' + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'treemapper-report-worker', 'Content-Type': 'application/json' },
    body
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { ok: r.ok, status: r.status, json, text };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST a report' });
    if (!env.GITHUB_TOKEN || !env.REPO) return reply(500, { ok: false, error: 'The report service is not set up (GITHUB_TOKEN, REPO)' });
    const len = +(request.headers.get('Content-Length') || 0);
    if (len > MAX_FILE_B64 + MAX_META + 64 * 1024) return reply(413, { ok: false, error: 'The report is too large' });

    let form;
    try { form = await request.formData(); } catch (e) { return reply(400, { ok: false, error: 'Not a report form' }); }
    const metaText = String(form.get('meta') || '');
    if (!metaText || metaText.length > MAX_META) return reply(400, { ok: false, error: 'No report details' });
    let meta;
    try { meta = JSON.parse(metaText); } catch (e) { return reply(400, { ok: false, error: 'Unreadable report details' }); }
    if (meta.website) return reply(200, { ok: true });   // a bot filled the hidden field: accepted, dropped
    const description = String(meta.description || '').trim();
    if (description.length < 3) return reply(400, { ok: false, error: 'Please describe what happened' });

    const id = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '-' + Math.random().toString(36).slice(2, 8);
    let fileUrl = null;
    const file = form.get('file');
    if (file) {
      const b64 = typeof file === 'string' ? file : await file.text();
      if (b64.length > MAX_FILE_B64) return reply(413, { ok: false, error: 'The report is too large' });
      if (b64 && /^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 200))) {
        // (the body is put together as text: the file is not parsed or copied into an object)
        const body = '{"message":"Report ' + id + '","content":"' + b64.replace(/\s+/g, '') + '"}';
        const put = await gh(env, '/repos/' + env.REPO + '/contents/reports/' + id + '.treemapper-report.json', 'PUT', body);
        if (!put.ok) return reply(502, { ok: false, error: 'The report file could not be stored (GitHub ' + put.status + ')' });
        fileUrl = put.json && put.json.content && put.json.content.html_url || null;
      }
    }
    const firstLine = description.split(/\r?\n/)[0];
    const title = 'Report: ' + (firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine);
    const fields = { title: clean(title, 120), body: issueBody(meta, id, fileUrl), labels: ['user-report'] };
    let issue = await gh(env, '/repos/' + env.REPO + '/issues', 'POST', JSON.stringify(fields));
    if (issue.status === 422) { delete fields.labels; issue = await gh(env, '/repos/' + env.REPO + '/issues', 'POST', JSON.stringify(fields)); }   // (the label refused: filed without it)
    if (!issue.ok) return reply(502, { ok: false, error: 'The report could not be filed (GitHub ' + issue.status + ')' });
    return reply(200, { ok: true, number: issue.json && issue.json.number, id });
  }
};
