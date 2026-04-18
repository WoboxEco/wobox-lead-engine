import { createLogger } from '@wobox/core';

export interface ApproveMessageOptions {
  id?: string;
  action?: 'approve' | 'edit' | 'discard';
  body?: string;
}

export async function run(_opts: ApproveMessageOptions): Promise<void> {
  const log = createLogger('approve-message');
  log.warn('stub: implement message approval flow (preserva original_body vs body para flywheel)');
}
