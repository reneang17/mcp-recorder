# Testing Progress — MCP Recorder

Living document tracking the evolution of the test suite, what's passing, what's pending, and what source changes were needed along the way.

---

## Current Status

| Tier | Tests | Passing | Framework | Notes |
|------|-------|---------|-----------|-------|
| Unit | 84 | ✅ 84/84 | vitest | Original AI-generated tests; assertions are vague |
| Integration | 9 | ✅ 9/9 | vitest + raw CDP | Synthetic events, not real interactions |
| E2E | 0 | — | — | Not yet created |
| **Total** | **93** | **93/93** | | |

**Last verified**: 2026-04-08 — `npm run test:unit` passes (84 tests, 262ms)

---

## Phase 1: Restructure + Harden Unit Tests

> **Goal**: Reorganize into `unit/integration/e2e/` dirs, tighten assertions, add missing edge cases.

### Directory Migration

- [x] `tests/correlator.test.ts` → `tests/unit/correlator.test.ts`
- [x] `tests/filters.test.ts` → `tests/unit/filters.test.ts`
- [x] `tests/post-filters.test.ts` → `tests/unit/post-filters.test.ts`
- [x] Remove old integration tests (rewritten in Phase 2)
- [x] Update `vitest.config.ts` for new structure
- [x] Update `package.json` scripts

### New Unit Tests

- [x] `tests/unit/correlator.test.ts` — add edge cases (same-timestamp, boundary window, rapid-fire, large-scale, all event type descriptions)
- [x] `tests/unit/network-parse.test.ts` — `parseBody`/`detectEncoding`/`getContentType` (requires minor source refactor)
- [x] `tests/unit/recorder-lifecycle.test.ts` — constructor merging, `isRecording()`, `getFilterConfig()`

### Source Changes Required

- [x] Extract `parseBody`, `detectEncoding`, `getContentType` from `NetworkCapture` class → standalone exported functions in `network-capture.ts`

### Status: ✅ Completed

---

## Phase 2: Puppeteer Integration Tests

> **Goal**: Replace synthetic `dispatchEvent()` tests with real Puppeteer-driven mouse/keyboard interactions.

### Infrastructure

- [x] Install `puppeteer` as dev dependency
- [x] Create `tests/helpers/puppeteer-harness.ts` — shared setup/teardown
- [x] Create 7 new test fixtures in `test-fixtures/`

### New Test Files

- [x] `tests/integration/dom-capture.test.ts` — real clicks, typing, submit, Enter, select, checkbox
- [x] `tests/integration/navigation.test.ts` — **critical**: events survive page navigation
- [x] `tests/integration/network-capture.test.ts` — form POST, JSON POST, failed requests, noise filtering
- [x] `tests/integration/selectors.test.ts` — full priority chain (`data-testid > id > aria-label > name > tag path`)
- [x] `tests/integration/recorder.test.ts` — full lifecycle, correlated steps, post-filters

### Status: ✅ Completed

---

## Phase 3: Playwright E2E Tests

> **Goal**: Validate recorder against real public pages.

### Infrastructure

- [ ] Install `playwright` as dev dependency
- [ ] Create `tests/helpers/playwright-harness.ts`

### New Test Files

- [ ] `tests/e2e/httpbin.test.ts` — form POST on httpbin.org
- [ ] `tests/e2e/mdn-form.test.ts` — MDN GitHub-hosted example form

### Status: ⏳ Not started

---

## Phase 4: GitHub Actions CI

- [ ] Create `.github/workflows/test.yml`
- [ ] Unit tests job (no Chrome needed)
- [ ] Integration tests job (Puppeteer bundles Chrome)
- [ ] E2E tests job (Playwright installs Chromium)
- [ ] Verify green on GitHub

### Status: ⏳ Not started

---

## Source Code Changes Log

Track every production code change made for testability or bug fixes discovered during testing.

| Date | File | Change | Reason |
|------|------|--------|--------|
| 2026-04-08 | `src/network-capture.ts` | Extracted `parseBody`, `detectEncoding`, `getContentType` into standalone exported functions | To allow unit testing of parsing logic without full class instantiation |
| 2026-04-08 | `src/dom-capture.ts` | Switched from `Runtime.evaluate` to `Page.addScriptToEvaluateOnNewDocument` | Fix critical bug: capture script was lost on page navigations. Real integration tests caught this. |

---

## Test Results History

| Date | Unit | Integration | E2E | Total | Commit |
|------|------|-------------|-----|-------|--------|
| 2026-04-08 | 84/84 ✅ | 9/9 ✅ | — | 93/93 | `7612896` (initial commit) |
| 2026-04-08 | 133/133 ✅ | — | — | 133/133 | (Phase 1 complete) |
| 2026-04-08 | 133/133 ✅ | 10/10 ✅ | — | 143/143 | (Phase 2 complete) |
