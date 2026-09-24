/** Fixture source file. Gives the smoke test something real to locate. */
export interface QueueJob {
  readonly id: string;
  readonly payload: string;
}

export function drainQueue(jobs: readonly QueueJob[]): readonly string[] {
  return jobs.map((job) => job.id);
}

