# Dashboard Tier-1 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the dashboard genuinely themeable and turn it into a real monitoring/management console: tokenize the Phase-4 components, add a Chrome-style step waterfall, per-step IO drill-in, action feedback, progress indicators, and a status summary bar.

**Architecture:** Incremental changes to existing `packages/ui/src/components/*`. Foundation (T1) rewires the 4 Phase-4 components to the `pgw-*` semantic tokens so `--pgw-*` overrides + dark mode work; subsequent tasks add UI on those tokens.

**Tech Stack:** React 19, TS (ESM), Vitest (jsdom), Tailwind v4, `@tanstack/react-query` v5. Consumes existing `lib/steps` (`extractSteps`, `StepInfo` with `startOffsetMs`/`durationMs`/`status`/`isWaitStep`/`stepInput`/`stepOutput`, `getCompletedStepCount`), `lib/duration` (`formatDuration`, `computeDurationMs`, `isTerminalStatus`, `timeAgo`).

## Global Constraints

- **Package:** `packages/ui/`. Branch `feat/pg-workflows-ui-dashboard` (PR #44 updates as commits land).
- **Style (Biome):** single quotes, semicolons always, trailing commas `all`, 2-space, 100-char, `organizeImports`. `'use client';` on hook/state components. Commits must be `biome check` + `tsc --noEmit -p .` clean and the FULL suite green.
- **THEMING (critical):** use the `pgw-*` semantic tokens, never hardcoded palette colors. Mapping for replacements:
  - text: `text-gray-500`/`600` → `text-pgw-muted-fg`; primary text → `text-pgw-fg`.
  - borders: `border`/`border-gray-*` → `border-pgw-border`.
  - surfaces: `bg-white` → `bg-pgw-bg`; `bg-gray-50`/hover → `bg-pgw-muted` / `hover:bg-pgw-muted`.
  - status/semantic colors: `text-red-600` (errors) → `text-pgw-status-failed`; accents → `text-pgw-accent`/`bg-pgw-accent`.
  - Do NOT introduce new raw hex or `gray/red/blue/green/yellow` Tailwind classes in any file this plan touches.
- **No engine/server/client/hook API changes.** UI only.
- **Run tests from `packages/ui`:** `cd packages/ui && npx vitest run <file>` (no arg = full suite).

---

### Task 1: Tokenize Phase-4 components + apply `.pgw-root`

**Files (modify):** `components/runs-table.tsx`, `components/pagination.tsx`, `components/run-detail/run-detail.tsx`, `components/workflow-runs-dashboard.tsx` (+ update any tests asserting old classes).

**Goal:** replace every hardcoded palette class in these four files with the `pgw-*` token equivalents (per the mapping above), and wrap the dashboard's outer container(s) in the `pgw-root` class so base bg/fg/font apply.

- [ ] **Step 1:** Add/confirm a test that pins the theming contract. In `runs-table.test.tsx`, add:

```tsx
it('uses themeable tokens, not hardcoded palette colors', () => {
  const { container } = render(<RunsTable runs={[]} onSelectRun={() => {}} />);
  expect(container.innerHTML).not.toMatch(/\b(?:text|bg|border|hover:bg)-(?:gray|red|blue|green|yellow|zinc|slate|neutral)-/);
});
```
Add the equivalent assertion to `pagination.test.tsx` and `workflow-runs-dashboard.test.tsx` (render the dashboard with the mock client from its existing test and assert the same on `container.innerHTML` for the list view).

- [ ] **Step 2:** Run those tests → they FAIL (current markup contains `gray/red/...`).
- [ ] **Step 3:** Replace the classes in all four component files per the mapping. Add `pgw-root` to the top-level `<div>` in `WorkflowRunsDashboard`'s rendered output (both the list container and the detail container), so base styles apply. Keep the action/pagination button base classes but swap `hover:bg-gray-50`→`hover:bg-pgw-muted`, `border`→`border-pgw-border`, and error text `text-red-600`→`text-pgw-status-failed`.
- [ ] **Step 4:** Run the three theming tests + the full component tests → PASS. Update any pre-existing test that asserted an old class string.
- [ ] **Step 5:** `npx biome check --write` the changed files; `npx biome check` (clean); `npx tsc --noEmit -p .` (clean); `npx vitest run` (full suite green).
- [ ] **Step 6:** Commit: `git commit -m "fix(ui): tokenize dashboard components for theming + dark mode"`.

---

### Task 2: Step waterfall / flame chart (`StepWaterfall`)

**Files:** create `components/run-detail/step-waterfall.tsx` (+ test); modify `run-detail.tsx` to render it above the existing `StepTimeline`.

**Interfaces:** `type StepWaterfallProps = { run: WorkflowRun; className?: string }`; `function StepWaterfall(props): JSX.Element`.

**Behavior:** `const steps = extractSteps(run)`. Compute `totalMs = max(step.startOffsetMs + (step.durationMs ?? 0))` over steps (fallback to `computeDurationMs(run)` or 1 to avoid /0). For each step render a row: a left label (`step.id`, truncated, `title` full) + a track (`relative` full-width, `bg-pgw-muted`) containing a positioned bar:
- `left: ${(startOffsetMs/totalMs)*100}%`, `width: ${Math.max((durationMs/totalMs)*100, 0.5)}%` (min width so zero-ish bars are visible).
- Bar color by segment: wait steps (`isWaitStep`) use `bg-pgw-status-paused` (or a striped/lighter treatment); active steps use `bg-pgw-status-running`; failed steps `bg-pgw-status-failed`; completed `bg-pgw-status-completed`. Choose by `step.status` first, then `isWaitStep`.
- Show the per-step duration label (`formatDuration(durationMs)`) at the end of the row (`text-pgw-muted-fg`).
- Steps without `durationMs` (pending/running-no-end): render a faint/indeterminate bar or a dot at `startOffsetMs`.
Use inline `style={{ left, width }}` for the computed percentages (Tailwind can't express dynamic %); everything else via `pgw-*` classes. Empty steps → a `text-pgw-muted-fg` "No steps yet".

- [ ] **Step 1:** Write `step-waterfall.test.tsx`: build a `run` whose `timeline` yields ≥2 completed steps with differing `startOffsetMs`/`durationMs` (mirror the fixture shape used in `step-timeline.test.tsx`); assert (a) a row per step with its id, (b) each positioned bar has a `style` with a `width`/`left` percentage, (c) no hardcoded palette classes (same regex as T1). Run → FAIL (missing module).
- [ ] **Step 2:** Implement `step-waterfall.tsx` per Behavior. Run test → PASS.
- [ ] **Step 3:** In `run-detail.tsx`, import and render `<StepWaterfall run={run} />` directly above `<StepTimeline run={run} />` under a small `text-pgw-muted-fg` "Timeline" heading. Keep `StepTimeline` (it's the textual/step list).
- [ ] **Step 4:** biome + tsc + full suite green.
- [ ] **Step 5:** Commit: `git commit -m "feat(ui): add Chrome-style step waterfall/flame chart to RunDetail"`.

---

### Task 3: Per-step IO drill-in

**Files:** modify `components/run-detail/step-waterfall.tsx` (make rows selectable) and `run-detail.tsx` (show selected step's IO); test updates.

**Behavior:** `StepWaterfall` gains an optional `onSelectStep?: (stepId: string) => void` and marks the selected row (`selectedStepId?: string` prop) with a `bg-pgw-muted` highlight. In `RunDetail`, hold `const [selectedStep, setSelectedStep] = useState<string | null>(null)`; pass it down; when set, render a panel (below the waterfall) titled with the step id showing that step's `stepInput` and `stepOutput` via `JsonViewer` (look them up from `extractSteps(run).find(s => s.id === selectedStep)`). A "clear"/close affordance resets to run-level view. Run-level input/output/error remain when no step is selected.

- [ ] **Step 1:** Test: render `RunDetail` (existing wrapper w/ mock client returning a run with steps), wait for load, click a waterfall step row, assert that step's `stepInput` value appears in a step-IO panel. Also assert `StepWaterfall` calls `onSelectStep` with the step id (unit test on the component with a spy). Run → FAIL.
- [ ] **Step 2:** Implement selection in `StepWaterfall` (row is a `<button>`/clickable with `onSelectStep`, `aria-pressed` on selected) and the step-IO panel in `RunDetail`. Run → PASS.
- [ ] **Step 3:** biome + tsc + full suite green.
- [ ] **Step 4:** Commit: `git commit -m "feat(ui): per-step input/output drill-in from the waterfall"`.

---

### Task 4: Action feedback (surface mutation results)

**Files:** modify `components/run-detail/run-detail.tsx`; test updates.

**Behavior:** Today the 5 action mutations swallow success/error. Add: (a) each button shows a small inline spinner/"…" while its mutation `isPending` (already `disabled`); (b) on `isError`, render an inline error banner (`text-pgw-status-failed`) with the error message near the action bar, dismissible/auto-cleared on next action; (c) on success, briefly surface a subtle confirmation (e.g. a `text-pgw-status-completed` "Cancelled." line) — a simple ephemeral message derived from the last-settled mutation is fine (no toast system needed). Keep it minimal and token-styled.

- [ ] **Step 1:** Test: render `RunDetail` with a mock client whose `cancelRun` REJECTS; click Cancel; `waitFor` an error message to appear. Second test: `cancelRun` resolves; click Cancel; assert the success indication appears (or the button re-enables and no error shows). Run → FAIL.
- [ ] **Step 2:** Implement inline pending/error/success feedback wired to the mutation objects' `isPending`/`isError`/`error`/`isSuccess`. Run → PASS.
- [ ] **Step 3:** biome + tsc + full suite green.
- [ ] **Step 4:** Commit: `git commit -m "feat(ui): surface run action pending/success/error feedback"`.

---

### Task 5: Progress indicators

**Files:** create `components/run-progress.tsx` (small shared bar) (+ test); modify `runs-table.tsx` (a compact progress cell/inline for non-terminal runs) and `run-detail/run-detail.tsx` or header area (a fuller bar).

**Behavior:** `RunProgress` takes `{ run: WorkflowRun; className?: string }`, computes `completed = getCompletedStepCount(run)` and `total = extractSteps(run).length` (guard total≥completed; if total is 0, render nothing). Renders a token-styled bar (`bg-pgw-muted` track, `bg-pgw-accent` fill at `completed/total`) + a `text-pgw-muted-fg` "{completed}/{total}" label. In `RunsTable`, show `RunProgress` inline (compact) only for non-terminal runs (`!isTerminalStatus(status)`); terminal runs keep the duration. In `RunDetail`, render a fuller `RunProgress` under the header. (The existing `StepTimeline` "x/y steps" bar may remain or be replaced by `RunProgress` — dedupe if trivially possible, else leave StepTimeline as-is.)

- [ ] **Step 1:** Test `run-progress.test.tsx`: a run with N completed of M steps renders the "{completed}/{total}" label and a fill element; a run with 0 total renders nothing; no hardcoded palette classes. Run → FAIL.
- [ ] **Step 2:** Implement `RunProgress`; wire into `RunsTable` (compact, non-terminal only) and `RunDetail`. Run → PASS + existing table/detail tests still green.
- [ ] **Step 3:** biome + tsc + full suite green.
- [ ] **Step 4:** Commit: `git commit -m "feat(ui): add run progress indicators to table + detail"`.

---

### Task 6: Status summary bar

**Files:** create `components/status-summary.tsx` (+ test); modify `workflow-runs-dashboard.tsx` to render it above the `FilterBar`/table.

**Behavior:** `StatusSummary` takes `{ runs: WorkflowRun[]; onSelectStatus?: (status: WorkflowRunStatus) => void; className? }`. Counts runs by status; renders one pill per non-zero status: a `StatusBadge`-like dot in the status token color + count (e.g. "● 4 running"). Clicking a pill calls `onSelectStatus(status)`. In the dashboard, feed it the **unfiltered** `useWorkflowRuns({ limit: 100 })` data already fetched for `workflowIds` (reuse that query — do not add a third query), and wire `onSelectStatus={(s) => setFilters({ statuses: [s], startingAfter: undefined, endingBefore: undefined })}`.

- [ ] **Step 1:** Test `status-summary.test.tsx`: given runs across statuses, renders a pill per present status with the right count; clicking a pill fires `onSelectStatus` with that status; no hardcoded palette classes. Run → FAIL.
- [ ] **Step 2:** Implement `StatusSummary`; render it in the dashboard list view above `FilterBar`, fed by the unfiltered query, wired to set the status filter. Run → PASS.
- [ ] **Step 3:** biome + tsc + full suite green.
- [ ] **Step 4:** Commit: `git commit -m "feat(ui): add clickable status summary bar to the dashboard"`.

---

## Self-Review

- **Coverage:** theming fix + `.pgw-root` (T1, answers the "how are these themeable" gap), waterfall (T2), per-step IO (T3), action feedback (T4), progress (T5), status summary (T6) — the Tier-1 set.
- **Theming contract enforced by test:** T1/T2/T5/T6 each assert no hardcoded palette classes, so new work stays themeable.
- **No frozen-API changes:** everything derives from existing `lib/steps`/`lib/duration` + existing hooks; no engine/server/client edits.
- **Placeholders:** none — each task has concrete behavior, the token mapping is explicit, and biome/tsc/full-suite are the gates. Percentage positioning uses inline `style` (documented) since Tailwind can't express dynamic %.
- **Deferred (not Tier 1):** dark-mode toggle UI, keyboard nav, bulk actions, sortable headers, real Trigger event form, copy/deep-link — future pass.
```
