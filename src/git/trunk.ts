const TRUNK_CANDIDATES = ['main', 'master', 'develop', 'trunk'] as const;

export function selectTrunk(branchNames: string[]): string | null {
  return TRUNK_CANDIDATES.find((name) => branchNames.includes(name)) ?? null;
}
