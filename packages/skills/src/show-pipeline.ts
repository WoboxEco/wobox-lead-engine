import { createLogger } from '@wobox/core';

export interface ShowPipelineOptions {
  venture?: string;
  stage?: string;
  founder?: string;
  campaign?: string;
  minScore?: string;
}

export async function run(_opts: ShowPipelineOptions): Promise<void> {
  const log = createLogger('show-pipeline');
  log.warn('stub: implement Kanban view filterable by venture/stage/founder/campaign/score');
}
