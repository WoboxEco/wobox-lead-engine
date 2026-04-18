import { createLogger } from '@wobox/core';

export interface GenerateMessagesOptions {
  id?: string;
  approach?: 'warm_intro' | 'nurture' | 'direct';
  channel?: string;
  step?: string;
}

export async function run(_opts: GenerateMessagesOptions): Promise<void> {
  const log = createLogger('generate-messages');
  log.warn('stub: implement message generation via Claude');
  // TODO:
  // 1. Cargar company + contact + score + warm_path.
  // 2. Seleccionar prompt segun venture + approach + vertical/sub-sector.
  //    - wobox_food + warm_intro -> message-wobox-warm-intro-v1
  //    - wobox_food + nurture -> message-wobox-nurture-food-v1
  //    - loop + * -> message-loop-*-v1 (usa buyer_persona)
  // 3. Llamar claude.completeText.
  // 4. Insert en messages con status='draft', prompt_version, original_body=body.
}
