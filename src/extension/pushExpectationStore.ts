import type { GitHubPullPayload } from '../github/githubClient';

export interface PushExpectation {
  expectedHeadSha: string;
  expectedBaseRef: string | null;
  // When a PR was just created, we hold the full payload so the resolver can
  // render it immediately even while GitHub's list endpoint is still stale.
  syntheticPull: GitHubPullPayload | null;
  expiresAt: number;
}

export interface PushExpectationSnapshot {
  expectedHeadSha: string;
  expectedBaseRef: string | null;
  syntheticPull: GitHubPullPayload | null;
}

export class PushExpectationStore {
  static readonly TTL_MS = 30_000;

  private readonly map = new Map<string, PushExpectation>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  record(
    branchRef: string,
    expectedHeadSha: string,
    expectedBaseRef: string | null,
    syntheticPull: GitHubPullPayload | null = null
  ): void {
    this.map.set(branchRef, {
      expectedHeadSha,
      expectedBaseRef,
      syntheticPull,
      expiresAt: this.now() + PushExpectationStore.TTL_MS,
    });
  }

  get(branchRef: string): PushExpectation | null {
    const entry = this.map.get(branchRef);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.map.delete(branchRef);
      return null;
    }
    return entry;
  }

  clear(branchRef: string): void {
    this.map.delete(branchRef);
  }

  hasActiveFor(branchRef: string): boolean {
    return this.get(branchRef) !== null;
  }

  snapshot(): ReadonlyMap<string, PushExpectationSnapshot> {
    const result = new Map<string, PushExpectationSnapshot>();
    const now = this.now();
    for (const [branchRef, entry] of this.map) {
      if (entry.expiresAt <= now) {
        this.map.delete(branchRef);
        continue;
      }
      result.set(branchRef, {
        expectedHeadSha: entry.expectedHeadSha,
        expectedBaseRef: entry.expectedBaseRef,
        syntheticPull: entry.syntheticPull,
      });
    }
    return result;
  }
}
