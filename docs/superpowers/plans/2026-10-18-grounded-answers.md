# Grounded Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce reproducible retrieval/context risks and support bounded, cited comparisons without claiming measured answer accuracy.
**Architecture:** Keep BM25/vector RRF and the v1 JSON index. Gate contextual search and one-hop relation expansion by query intent; serialize bounded evidence with provenance.
**Tech Stack:** Existing TypeScript 6, Vitest 5, Next 16, AI SDK 7. No new dependencies.
**Spec:** docs/superpowers/specs/2026-10-18-grounded-answers-design.md

## Global Constraints

- No production deployment/reindex, Docker, new credentials or paid services.
- Preserve PR #8; branch independently from develop 14c73eb.
- Read-only operations first. Never output secrets or raw operational log messages.
- Full source block <= 9,000 characters; one-hop expansion <= 2 relations.
- Do not mistake retrieval recall or valid citation syntax for answer correctness.

## Review Focus

- Topic changes must not inherit a previous topic or unrelated viewed article.
- Invalid/negative vectors must not flood the result set with irrelevant candidates.
- A large early snippet must not starve a comparison's second article.
- Relation cycles, generic concepts and category co-membership must not invent causation.
- Citation validity and unreviewed semantic answer quality must remain separate.

### Task 1: Safer search and context

**Files:** lib/retrieval.ts, lib/prompt.ts, lib/chat-handler.ts; tests/retrieval.test.ts, tests/prompt.test.ts, tests/chat-handler.test.ts.
**Interfaces:** Preserve Searcher.search(SearchInput), buildSearchQuery and buildSources; add chunk provenance to SourceRef.

- [ ] Write regressions for topic switch, explicit/implicit current-post requests, weak/nonfinite vectors, exact technical terms, and long-source starvation/escaping/budget.
- [ ] Run tests to observe the expected failures, then implement query gating, relevance filters and bounded source selection.
- [ ] Run `npm test` (all pass), record results, commit.

### Task 2: One-hop evidence relations

**Files:** lib/relations.ts, lib/types.ts, lib/retrieval.ts, lib/prompt.ts, ingest/extract.ts; tests/relations.test.ts, tests/extract.test.ts, tests/chat-handler.test.ts.
**Interfaces:** EvidenceRelation refers to fromChunkId/toChunkId and kind link/series/concept. RetrievedChunk carries optional relation provenance; buildSources returns source-numbered relations as well as sources/block.

- [ ] Write regressions for link/series/concept witnesses, wrong hosts, generic words, cycle bounds, simple queries bypassing expansion and relation endpoints surviving serialization.
- [ ] Observe failing tests, implement capped one-hop expansion and internal-link preservation without rewriting the index.
- [ ] Run `npm test` (all pass), record results, commit.

### Task 3: Separated evaluation and delivery

**Files:** eval/grounding.ts, eval/quality.ts, eval/answers.ts, eval/review.ts, eval/grounding-cases.json; tests/quality.test.ts; package.json, README.md, docs/answer-quality.md; branch-only vercel.json and PR validation workflow.
**Interfaces:** assessQuality reports missing required posts/invalid citations mechanically; human judgments independently supply correctness/citation support/unsupported relation claim count, otherwise null.

- [ ] Write failing evaluation tests with valid-but-wrong citations, missing required posts and unsupported relationship judgments.
- [ ] Implement offline grounding scenarios and optional human review scoring. Save source evidence alongside generated answer evaluations.
- [ ] Run full tests, offline retrieval/grounding evaluations, typecheck, build, actionlint and diff check. No model API calls.
- [ ] Fresh reviewer checks the whole branch; resolve important findings with regression tests. Create Draft PR and report actual CI separately. Preserve existing branch/PR and do not merge/deploy.
