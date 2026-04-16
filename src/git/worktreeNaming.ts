export const WORKTREE_ANIMALS: readonly string[] = [
  'otter',
  'fox',
  'koala',
  'panda',
  'tiger',
  'whale',
  'eagle',
  'raven',
  'wolf',
  'bear',
  'lynx',
  'heron',
  'falcon',
  'badger',
  'rabbit',
  'seal',
  'owl',
  'gecko',
  'bison',
  'moose',
  'hare',
  'stoat',
  'beaver',
  'ferret',
  'marmot',
  'puffin',
  'macaw',
  'toucan',
  'swan',
  'crane',
  'sparrow',
  'robin',
  'finch',
  'turtle',
  'newt',
  'iguana',
  'cobra',
  'dolphin',
  'orca',
  'shark',
  'octopus',
  'crab',
  'lobster',
  'salmon',
  'pike',
];

export const WORKTREE_COLORS: readonly string[] = [
  '#b52e31',
  '#087CA7',
  '#42b883',
  '#ff3e00',
  '#f9e64f',
  '#5dc9e2',
  '#68217A',
  '#1857a4',
  '#eb5424',
  '#215732',
  '#832561',
  '#007fff',
  '#639',
  '#bd10e0',
  '#f48024',
];

export class WorktreeNamingUtils {
  static pickAnimal(taken: ReadonlySet<string>): string {
    const shuffled = shuffle(WORKTREE_ANIMALS);
    for (const animal of shuffled) {
      if (!taken.has(animal)) {
        return animal;
      }
    }

    const base = shuffled[0];
    for (let suffix = 2; suffix < 1000; suffix++) {
      const candidate = `${base}-${suffix}`;
      if (!taken.has(candidate)) {
        return candidate;
      }
    }

    return `${base}-${Date.now()}`;
  }

  static pickColor(): string {
    const index = Math.floor(Math.random() * WORKTREE_COLORS.length);
    return WORKTREE_COLORS[index];
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
