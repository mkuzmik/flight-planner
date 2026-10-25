# AGENTS.md

**`README.md` is the source of truth** for what this project is, how it's
structured, how to run, test and deploy it, and where new code goes. Read the
relevant sections before working, and keep the README current when you change
any of that — don't duplicate it here. This file only adds the rules and
working conventions that the README doesn't cover.

## Hard rules

- **This repository is public.** Never commit secrets (tokens, keys) — not in
  code, tests, fixtures, docs, commit messages or PR text.
- **This is a flight-planning tool; wrong output can mislead a pilot.**
  - When input or external data is missing, stale or unparseable, say so on
    the page and err on the side of warning — never silently treat it as
    "clear" or "zero".
  - Never invent or hand-edit aeronautical data (airspace, frequencies,
    navaids, declination). It comes from an authoritative source, and the page
    names the source and how fresh it is.
  - Keep the "planning aid only" framing; don't word output as if it replaced
    official briefing (AIP, AUP/UUP, NOTAMs, weather).
- **Static site, no backend.** The app runs from GitHub Pages without a build
  step. External data is either fetched in the browser from an API that allows
  it (CORS), or downloaded at deploy time by the Pages workflow. Navigation and
  data logic goes in `js/planner.js` as pure functions with unit tests.
- Never merge PRs and never deploy (including running the Pages workflow) —
  the maintainer does that.

## How work is organised

- **One task → one branch → one PR**, each in its own git worktree. Don't work
  in, or change the state of, the maintainer's main checkout. The git stash is
  shared across worktrees: never use a bare `git stash`/`git stash pop`
  (prefer a WIP commit).
- **Ideas, proposals and follow-ups are GitHub issues**, not PRs. This covers
  new ideas, findings deferred from a PR review, and "not in this PR" items.
  - One issue per item, labelled `bug` or `enhancement`. A follow-up links the
    PR (or issue) it came from. Describe the behaviour and why it matters, in
    functional terms.
  - A design or proposal is written in the issue itself (edit the body as it
    evolves; use comments for validation notes and discussion), not as a file
    in the repo or a draft PR.
  - A PR starts only when the maintainer picks up an issue. It references the
    issue (`Fixes #N`), implements only what was asked for, and updates the
    issue when the implementation diverges from the design.
- **Bug fixes**: write the failing test first, confirm it fails without the
  fix, then fix.
- **UI changes**: check the page in a browser (and the print layout, which is
  meant to fit on paper), not only the unit tests.
- Keep edits to widely shared files (`index.html`, `js/planner.js`) small and
  localised; several PRs may be in flight at once.

### PR descriptions

The maintainer reviews mainly the description (and Copilot checks the diff
against it, see `.github/copilot-instructions.md`), so it must be an accurate,
complete account of the change:

- **Describe functionality, not implementation**: what changes for the pilot
  using the page (inputs, results, printout, warnings), and anything the
  maintainer must do before or after merging (repository settings, workflow
  changes, new external data sources). No file-by-file changelog.
- **Keep it in sync**: after every push, update the description so it matches
  the code — no stale claims from earlier iterations.
- **"Decisions for the owner"** section at the top: for every non-critical
  choice you made, say what you chose and the alternatives.
- **Critical decisions** (any reasonable implementation would be thrown away;
  safety-relevant, security-sensitive or irreversible; no sensible default):
  stop, push what's useful, keep the PR as a draft, and put a
  "⚠️ Decision needed" section at the top.
- Also: summary, how to verify, and conflicts/dependencies with other open PRs.

Merging to `main` deploys the site, so there are no release labels or version
numbers.

### Review loop (poll → evaluate → fix)

After pushing a PR that's ready for review:

1. Request a Copilot review.
2. Wait for a review on the latest head commit.
3. Evaluate **every** finding — inline comments *and* items that appear only in
   the review body (e.g. "Previously missed" / low-confidence notes):
   - valid → fix it, with a test that fails without the fix;
   - not valid → explain why;
   - description mismatch → update the PR description.
4. Reply on each inline thread with the fixing commit or the reasoning;
   answer body-only items with a PR comment.
5. Push without force, re-request the review, repeat. Stop when a round has
   no new valid findings, or after 4 rounds (then list what's left in the PR).
6. Confirm CI is green.
