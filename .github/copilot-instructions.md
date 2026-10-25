# Instructions for Copilot code review

The maintainer reads the **PR description**, not every line of the diff. Your
most important job is to make sure the description is an accurate, complete
account of what the PR does.

## 1. Description ↔ code consistency (highest priority)

Compare the PR title and description against the diff and flag every
discrepancy:

- **Undescribed behaviour changes**: anything a pilot using the page would
  notice (new/removed/renamed inputs, changed calculations or defaults,
  changed results, warnings or printout) or the maintainer must act on (new
  external data sources, workflow or repository-settings changes) that the
  description doesn't mention.
- **Claims the code doesn't back up**: a described feature, fix, safeguard or
  test that isn't in the diff, or works differently than described.
- **Stale description**: text describing an earlier iteration of the PR.
- **Missing or understated risk**: anything that changes calculated values
  (courses, times, fuel, airspace status), breaks the deployed site, or needs
  a step before or after merging.

Report these as review comments with a concrete suggested wording for the
description.

## 2. What a good description looks like

Written for the maintainer, in terms of **functionality**, not implementation:
what changes for the pilot, steps the maintainer must take, decisions for the
maintainer, and how to verify. It should **not** be a file-by-file
changelog ("added function X", "modified file Y"); if the description is
mostly that, say so and suggest a functional summary.

## 3. Then the code

Review for correctness, security and tests as usual. Also flag:

- secrets anywhere in code, tests, fixtures or docs — this repository is
  public;
- missing, stale or unparseable data treated as "clear" or zero instead of
  being shown as a warning — this is a flight-planning tool;
- hard-coded or hand-edited aeronautical data (airspace, frequencies, navaids)
  instead of data from an authoritative source;
- calculation logic added to `index.html` instead of `js/planner.js` with
  tests.

Skip style nitpicks that don't affect behaviour.
