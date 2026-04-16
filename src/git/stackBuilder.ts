import type { StackState } from '../protocol';
import { GitStackStateLoader } from './stackState/loader';

export class GitStackBuilder {
  static build(cwd: string): Promise<StackState> {
    return GitStackStateLoader.load(cwd);
  }
}
