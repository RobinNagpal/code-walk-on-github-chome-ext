// Shared walkthrough format helpers for the skill scripts.
// Keep in sync with extension/lib/walkthrough.ts and ../walkthrough.schema.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LineRange {
  start: number;
  end: number;
}

/** CodeTour: files at one pinned commit. PRReview: the changes of a pull request. */
export const WALKTHROUGH_TYPES = ['CodeTour', 'PRReview'] as const;
export type WalkthroughType = (typeof WALKTHROUGH_TYPES)[number];

export interface Slide {
  id: string;
  title: string;
  summary: string;
  narration: string;
  file?: string;
  lines?: LineRange;
  /** PRReview only: "new" (default) for added or kept lines, "old" for removed ones. */
  side?: 'new' | 'old';
  audio?: string;
  durationSec?: number;
}

export interface PullRequest {
  number: number;
  title?: string;
  baseCommit: string;
  headCommit: string;
}

export interface Walkthrough {
  version: 1;
  /** Missing means CodeTour. */
  type?: WalkthroughType;
  pullRequest?: PullRequest;
  id: string;
  title: string;
  description?: string;
  repo: { host?: string; owner: string; name: string; commit: string };
  createdAt?: string;
  targetMinutes?: number;
  slides: Slide[];
}

export const WALKTHROUGH_FILE = 'walkthrough.json';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA = /^[0-9a-f]{40}$/;

export function readWalkthrough(dir: string): Walkthrough {
  return JSON.parse(readFileSync(join(dir, WALKTHROUGH_FILE), 'utf8')) as Walkthrough;
}

export function writeWalkthrough(dir: string, walkthrough: Walkthrough): void {
  writeFileSync(join(dir, WALKTHROUGH_FILE), JSON.stringify(walkthrough, null, 2) + '\n');
}

/** Structural checks only; line ranges are checked against the repo in validate.ts. */
export function structuralErrors(w: Walkthrough, folderName: string): string[] {
  const errors: string[] = [];
  if (w.version !== 1) errors.push('version must be 1');
  if (!SLUG.test(w.id ?? '')) errors.push(`id "${w.id}" must be hyphen-separated lowercase`);
  if (w.id !== folderName) errors.push(`id "${w.id}" must match folder name "${folderName}"`);
  if (!w.title) errors.push('title is required');
  if (!w.repo?.owner || !w.repo?.name) errors.push('repo.owner and repo.name are required');
  if (!SHA.test(w.repo?.commit ?? '')) errors.push('repo.commit must be a full 40-character commit SHA');
  if (w.type !== undefined && !WALKTHROUGH_TYPES.includes(w.type)) errors.push(`type must be one of ${WALKTHROUGH_TYPES.join(', ')}`);
  const review = w.type === 'PRReview';
  if (review) {
    const pr = w.pullRequest;
    if (!pr || !Number.isInteger(pr.number)) errors.push('a PRReview needs pullRequest.number');
    if (!SHA.test(pr?.baseCommit ?? '') || !SHA.test(pr?.headCommit ?? '')) {
      errors.push('pullRequest.baseCommit and headCommit must be full 40-character SHAs');
    }
    if (pr && w.repo?.commit !== pr.headCommit) errors.push('repo.commit must equal pullRequest.headCommit');
  }
  if (!Array.isArray(w.slides) || w.slides.length === 0) errors.push('slides must be a non-empty array');

  const ids = new Set<string>();
  (w.slides ?? []).forEach((s, i) => {
    const at = `slides[${i}]`;
    if (!SLUG.test(s.id ?? '')) errors.push(`${at}.id "${s.id}" must be hyphen-separated lowercase`);
    if (ids.has(s.id)) errors.push(`${at}.id "${s.id}" is duplicated`);
    ids.add(s.id);
    if (!s.title) errors.push(`${at}.title is required`);
    if (!s.summary) errors.push(`${at}.summary is required`);
    if (!s.narration) errors.push(`${at}.narration is required`);
    if (s.lines && !s.file) errors.push(`${at}.lines given without file`);
    if (s.side !== undefined && (!review || !['new', 'old'].includes(s.side))) {
      errors.push(`${at}.side must be "new" or "old", and only in a PRReview`);
    }
    if (s.lines) {
      const { start, end } = s.lines;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        errors.push(`${at}.lines must satisfy 1 <= start <= end`);
      }
    }
    if (s.file && (s.file.startsWith('/') || s.file.includes('..'))) {
      errors.push(`${at}.file must be a repo-relative path`);
    }
  });
  return errors;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
