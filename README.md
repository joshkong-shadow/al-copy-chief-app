# AL Copy Chief (dashboard)

A single web page the copy team uses to request and manage AI copywriting tasks: scripts, research, shocking angles, listicles, dossiers and more. It has no server of its own. Everything it does goes through GitHub: each task is a GitHub issue in the private copy repo, the cloud jobs do the work and save the results in that repo, and this page shows them.

Files: `index.html`, `styles.css`, `app.js` (no build step, no framework). Demo mode (`?demo=1`) needs a local `demo/` folder of test data, which is kept out of this public repo.

The contract with the cloud jobs is `docs/TASK-PROTOCOL.md` in the copy repo. The page follows it exactly: labels, issue body, uploads, status labels, `/approve` `/feedback` `/refine` `/final` comments, archive, and the owner-only promotion task.

## Signing in

Each person signs in with their own GitHub fine-grained token. The sign-in screen walks through it:

1. Open https://github.com/settings/personal-access-tokens/new
2. Name it "AL Copy Chief", pick an expiry.
3. Resource owner: the account that owns the copy repo. Repository access: only the copy repo.
4. Repository permissions: **Contents** read and write, **Issues** read and write. **Metadata** read-only is added automatically.
5. Generate, copy, paste into the page.

The token and repo name are kept only in that browser (localStorage). "Sign out" (bottom of the menu) removes them. The page never logs the token.

## Changing the repo

The "Copy repo" box on the sign-in screen defaults to `joshkong-shadow/al-copy-chief`. When the repo moves (for example to the company account), sign out and type the new `owner/name` there. To change the default for everyone, edit `DEFAULT_REPO` near the top of section 2 in `app.js`.

Who counts as an owner (sees "Team learnings" and can promote) comes from `copy-chief.config.json` → `owners` in the copy repo, not from this page.

## What loads after sign-in

Nothing about the company is hard-coded in the page. After sign-in it reads, from the copy repo: `RESEARCH-INDEX.json` (search boxes, persona appendix), `ENGINES.json` (engine cards), `EXAMPLES.json` (start grid, How it works, real examples, cast, benchmarks, sample outputs), `copy-chief.config.json` (owners), the `jobs/issue-<N>/` folders (plans, results, versions, downloads) and `profiles/` (learnings).

## Demo mode (no token)

Open `index.html?demo=1`. The page loads `demo/` instead of GitHub and **sends nothing**: every call it would make (method, path, body) appears in the "Demo log" panel, bottom right, and in `window.__demoLog`. Run it locally with:

```
cd al-copy-chief-app
python3 -m http.server 8000
# then open http://localhost:8000/index.html?demo=1
```

Demo tasks: #8 script ready (new `v1/`/`v2/` layout), #3 script ready (older layout), #5 script waiting on a plan, #7 shocking angles waiting on a plan, #6 deep research running, #4 iteration analysis done, #11 a promotion. The demo login is an owner, so Team learnings can be tried (two fixture profiles, one already-dismissed proposal).

The `demo/` folder is not published: it contains real company data and stays on the builder's machine.
