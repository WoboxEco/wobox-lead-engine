import { createLogger } from '@wobox/core';

export interface CheckWarmPathOptions {
  id?: string;
  all?: boolean;
}

export async function run(_opts: CheckWarmPathOptions): Promise<void> {
  const log = createLogger('check-warm-path');
  log.warn('stub: implement warm path detection via Apollo connections');
  // TODO: para cada contacto de los leads qualified, consultar Apollo
  // para ver si alguno de los 3 founders tiene conexion 1er/2do grado.
  // Actualizar contacts.warm_path + warm_connector.
}
