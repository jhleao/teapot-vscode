import type { StackBranch } from '../protocol';

export class PrBaseUtils {
  // What the PR base SHOULD be given the local stack. Used for drift detection
  // against an already-existing PR: if the local parent differs from the PR base
  // on GitHub, we surface drift. Parent is used regardless of whether it has its
  // own PR — a stacked intermediate branch without a PR is still a valid signal
  // of intent.
  static expectedBaseFor(branches: StackBranch[], branchRef: string): string | null {
    const byRef = new Map(branches.map((branch) => [branch.ref, branch]));
    const branch = byRef.get(branchRef);
    if (!branch?.parentRef) {
      return null;
    }

    const parent = byRef.get(branch.parentRef);
    if (!parent) {
      return null;
    }

    return parent.ref;
  }

  static buildExpectedBaseMap(branches: StackBranch[]): Map<string, string | null> {
    const map = new Map<string, string | null>();
    for (const branch of branches) {
      map.set(branch.ref, PrBaseUtils.expectedBaseFor(branches, branch.ref));
    }
    return map;
  }
}
