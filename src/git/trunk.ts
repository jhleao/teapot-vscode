const TRUNK_CANDIDATES = ['main', 'master', 'develop', 'trunk'] as const;

export function selectTrunk(branchNames: Iterable<string>): string | null {
  const branchNameSet = new Set(branchNames);

  for (const candidate of TRUNK_CANDIDATES) {
    if (branchNameSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}
