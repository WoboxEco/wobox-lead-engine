# Wobox Lead Engine — Cómo funciona

## Qué es esto

El Wobox Lead Engine es una aplicación interna que automatiza y potencia con inteligencia artificial la generación de leads para los 3 productos de Wobox: **Wobox Food** (venta de sobrestock de alimentos), **Wobox Fashion** (venta de sobrestock de ropa) y **Loop** (tarjeta digital de fidelización eco para marcas).

El sistema encuentra empresas que podrían ser clientes, las evalúa automáticamente, detecta si tenemos algún contacto cercano para que nos presente, genera mensajes personalizados para acercarnos, y aprende de los resultados para mejorar con el tiempo.

Lo usan los 3 founders del equipo. Cada uno tiene acceso total y el sistema se encarga de que no se pisen entre sí (nunca dos founders contactan al mismo lead).

---

## Qué problema resuelve

Sin esta herramienta, el proceso de prospección es manual: alguien busca empresas en LinkedIn o Google, anota los datos en una planilla, piensa un mensaje, lo envía, y después no hay registro de qué funcionó y qué no. No escala, no aprende, y depende de la memoria de quien lo hace.

Con el Lead Engine, el equipo puede decirle al sistema "buscá cadenas de cafeterías en Buenos Aires para Loop" y en minutos tiene una lista de leads evaluados, con score de calidad, con warm path detectado, y con mensajes listos para revisar y enviar. Toda la información queda registrada para que después el sistema pueda decir "el approach de nurture convierte 3 veces más que el contacto directo para cafeterías con más de 10 locales".

---

## Las piezas del sistema

El sistema tiene 5 componentes principales que trabajan juntos.

**Supabase** es la base de datos. Guarda toda la información: las empresas que encontramos, las personas de contacto, los scores de cada lead, el historial de todas las interacciones, los mensajes que generó la IA, y las métricas. También maneja la autenticación (el login de los 3 founders) y ejecuta tareas programadas como re-evaluar leads cada semana o sincronizar con HubSpot cada mañana.

**Claude API** es el cerebro de inteligencia artificial. Hace dos cosas fundamentales: evalúa cada lead con un score de 1 a 100 basado en criterios específicos, y genera mensajes personalizados para contactar a cada empresa. Cada producto tiene su propio modelo de evaluación porque lo que hace bueno a un lead de Wobox Food (sobrestock de perecederos) es completamente distinto de lo que hace bueno a un lead de Loop (alta recurrencia de clientes).

**Apollo.io** es la fuente de datos para empresas medianas y grandes. Cuando buscamos cadenas de supermercados, franquicias de ropa, o cadenas de cafeterías, Apollo nos da la información: nombre de la empresa, tamaño, contactos con sus emails y perfiles de LinkedIn, y si alguno de los founders tiene conexiones cercanas con alguien de la empresa. Para negocios chicos (una peluquería, un café de barrio), Apollo no tiene datos — ahí usamos búsqueda web directa.

**HubSpot** es el CRM donde vive el pipeline de ventas. Una vez que un lead acepta una reunión, pasa de nuestra app a HubSpot, donde los founders gestionan la negociación, la presentación, y el cierre. El sistema sincroniza ambos: si un deal se cierra en HubSpot (ganado o perdido), esa información vuelve a la app para alimentar el aprendizaje.

**Next.js** es la aplicación web que los founders abren cada día. Un dashboard donde ven todos los leads organizados por estado, pueden revisar y aprobar mensajes generados por la IA, consultar métricas, y tomar decisiones. Corre en Vercel, se accede desde cualquier navegador, y no consume tokens de IA para operar (solo cuando se pide generar algo nuevo).

---

## Dos pipelines conectados

El sistema gestiona dos pipelines que se conectan entre sí.

El primero es el **pipeline de prospección**, que vive dentro de la app. Cubre el camino desde que encontramos una empresa hasta que conseguimos una reunión. Los estados son: nuevo → enriquecido → calificado → en nurture → contactado → reunión agendada. La app tiene control total sobre este pipeline: el scoring, la detección de warm path, la generación de mensajes, el seguimiento de la secuencia de nurture.

El segundo es el **pipeline de ventas**, que vive en HubSpot. Cubre el camino desde la primera reunión hasta el cierre. Los estados son: sin contacto → contacto → presentación enviada → negociación → onboarding → cierre ganado → cierre perdido. Este pipeline lo gestionan los founders directamente en HubSpot como ya lo hacían.

El puente entre ambos es simple: cuando un lead pasa a "reunión agendada" en la app, se crea automáticamente un deal en HubSpot. Y cuando un deal se cierra en HubSpot (ganado o perdido), esa información vuelve a la app para que el sistema aprenda qué tipo de acercamiento funciona mejor.

---

## Tres productos, dos motores de búsqueda

Wobox Food y Wobox Fashion buscan leads similares: empresas medianas o grandes, cadenas con múltiples locales, franquicias con sobrestock. Para esto usamos Apollo, que tiene bases de datos estructuradas de empresas con información de contacto.

Loop tiene un rango más amplio: desde un café de especialidad con 1 solo local en Palermo hasta una cadena de 50 panaderías. Para los negocios chicos, Apollo no sirve — una peluquería de barrio no aparece ahí. Por eso Loop usa un segundo motor de búsqueda: web search, que busca en Google, Google Maps, Instagram, y directorios argentinos, barrio por barrio. Para las cadenas grandes, Loop también usa Apollo.

---

## Cómo evalúa la IA a cada lead

Cada lead recibe un score de 1 a 100. Pero el modelo de evaluación es distinto según el producto.

Para **Wobox Food y Fashion**, la IA evalúa: qué vertical es (food o moda valen más), cuántos locales tiene (10+ es ideal), qué probabilidad hay de que tenga sobrestock (perecederos y seasonal puntúan alto), si es franquicia centralizada (cerrar uno = ganar muchos), y si está en Rosario, Buenos Aires o Córdoba.

Para **Loop**, la IA evalúa cosas distintas: qué tan recurrente es el negocio (un café con clientes diarios vale más que una tienda de compra esporádica), en qué sub-sector está (gastronómico, wellness, gym, moda, retail), qué tan digitalizado está (si ya usa QR y pagos digitales, adoptar Loop es más fácil), su escala y potencial de crecimiento, y la región. Además, le asigna automáticamente uno de 6 perfiles de comprador (buyer personas) que determinan el tono y el ángulo del mensaje.

Los leads con score de 80 o más se contactan directamente. Los de 50 a 79 pasan por una secuencia de calentamiento antes. Los menores a 50 se guardan para re-evaluar en 6 meses.

---

## El approach de no contactar en frío

El sistema tiene dos caminos para llegar a un lead, y ninguno es un cold call.

**Si tenemos un contacto cercano** (alguien que conoce al decisor de la empresa), el sistema lo detecta usando los datos de conexiones de LinkedIn de los 3 founders. En ese caso, sugiere un mensaje para pedirle al contacto que nos presente. Esto es un warm intro — la empresa nos recibe porque alguien de confianza nos recomendó.

**Si no tenemos contacto cercano**, el sistema activa una secuencia de calentamiento de 4 pasos que se ejecuta en 5 a 7 días antes de cualquier pitch. Primero, el founder le da like y deja un comentario de valor en un post del prospecto. Después, le comparte un recurso relevante para su negocio (un dato de su industria, un insight útil). Luego, le envía una solicitud de conexión en LinkedIn con una nota que referencia la interacción anterior. Y finalmente, ya conectados, le envía un mensaje directo con la propuesta de valor de Wobox o Loop. Para cuando llega el mensaje, el prospecto ya vio el nombre del founder al menos 2-3 veces — no es un desconocido.

En ambos caminos, la IA genera los mensajes adaptados al perfil de la empresa, su vertical, su tamaño, y el canal elegido (LinkedIn, email, WhatsApp, o Instagram DM). El founder siempre revisa y aprueba antes de enviar — nada se manda automáticamente.

---

## El flywheel: cómo aprende el sistema

El sistema registra absolutamente todo: qué mensaje se envió, por qué canal, a qué tipo de empresa, con qué approach (warm intro, nurture, o directo), y cuál fue el resultado (respondió, aceptó reunión, no respondió, dijo que no).

Con esos datos, puede responder preguntas como: ¿el approach de nurture convierte más que el directo para cafeterías? ¿Los mensajes por LinkedIn funcionan mejor que por email para marcas de moda? ¿Los leads de score 70 que pasan por nurture convierten igual que los de score 90 contactados directamente?

Estas respuestas retroalimentan el scoring (se ajustan los pesos) y la generación de mensajes (se mejoran los prompts). Con el tiempo, el sistema se vuelve más preciso en identificar buenos leads y más efectivo en contactarlos.

Además, el sistema detecta cuándo los founders editan los mensajes generados por la IA. Si un founder siempre cambia la misma parte de un mensaje, eso indica que el prompt necesita ajuste. Esta información también alimenta la mejora continua.

---

## Cómo se construyó

La app se construyó en 3 capas, en ese orden.

Primero, se crearon **skills en Claude Code**: piezas individuales que hacen una sola cosa (buscar leads, scorearlos, generar mensajes). Esto permitió validar que cada componente funcione bien antes de armar el sistema completo.

Después, se crearon **agentes** que encadenan varios skills en un solo flujo. Por ejemplo, el agente de prospección completa hace en un solo comando: buscar leads → enriquecer datos → scorear → detectar warm path → generar mensajes.

Finalmente, se construyó la **app web** que expone todo eso en un dashboard visual. Los API routes de la app hacen exactamente lo mismo que los skills, pero disparados por botones en vez de comandos de terminal.

---

## Ejemplo: prospectando cafeterías en Palermo para Loop

Para hacer concreto todo lo anterior, este es el flujo completo de cómo el sistema procesaría una campaña real.

**Día 1 — Búsqueda.** Un founder abre la app (o Claude Code en las primeras semanas) y lanza: "Prospectá Loop, gastronómico, CABA Palermo, campaña Q3 Gastro Palermo". El sistema usa búsqueda web porque son negocios locales. Recorre Google Maps, Instagram y directorios buscando cafeterías, restaurantes, panaderías y rotiserías en Palermo Soho, Hollywood y Botánico. Encuentra 47 negocios. Verifica cuáles ya estaban en la base de datos (deduplicación), descarta 5 duplicados, y guarda 42 nuevos leads.

**Día 1 — Enriquecimiento.** Para cada lead, el sistema visita su website y busca el link a Instagram. Encuentra el Instagram de 35 de los 42. Para los 7 restantes, usa los datos de LinkedIn como alternativa. Ahora cada lead tiene: nombre, dirección, cantidad de locales, Instagram con followers, y si están activos en redes.

**Día 1 — Scoring.** La IA evalúa cada lead con el modelo de Loop. Un café de especialidad con 2 locales, 15.000 seguidores en Instagram, que usa QR para el menú y tiene posts diarios, recibe un score de 87 — hot lead. Una rotisería de 1 local sin Instagram y sin presencia digital recibe un score de 38 — se guarda para después. De los 42 leads, 8 salen hot (80+), 19 salen warm (50-79), y 15 se descartan por ahora. Cada uno tiene asignado un buyer persona: la mayoría son BP1 (gastronómico), algunos son BP4 (retail) si son más del tipo dietética o fiambrería.

**Día 1 — Warm path.** El sistema consulta si alguno de los 3 founders tiene conexiones de 1er o 2do grado con los decisores de los 27 leads viables. Encuentra que un founder conoce al dueño de 2 de las cafeterías. Esos 2 leads se le asignan a ese founder automáticamente. Los otros 25 se reparten entre los 3 por round-robin.

**Día 1 — Generación de mensajes.** Para los 2 leads con warm path, la IA genera mensajes de warm intro: un texto para pedirle al contacto en común que los presente. Para los 8 hot leads sin warm path, genera mensajes de contacto directo adaptados a cada negocio. Para los 19 warm leads, prepara la secuencia de nurture empezando por el step 1.

**Día 1 — Revisión.** Los 3 founders abren el dashboard. Cada uno ve sus leads asignados con los mensajes listos. Revisan, editan alguno que quieren ajustar (esa edición queda registrada para mejorar la IA), aprueban, y marcan como enviados cuando los mandan por LinkedIn o Instagram.

**Día 2 a 7 — Nurture.** Los 19 warm leads van avanzando en la secuencia. El sistema le avisa a cada founder cuándo toca el siguiente touchpoint. Día 2: like y comentario en un post del negocio. Día 4: compartir un dato sobre retención de clientes en gastronomía. Día 6: solicitud de conexión en LinkedIn con nota personalizada. Día 7+: mensaje directo con la propuesta de Loop. En cada paso, la IA genera el contenido adaptado al negocio y el founder lo revisa antes de enviarlo.

**Día 10 — Resultados parciales.** De los 2 warm intros, uno respondió y aceptó una reunión — pasa a "reunión agendada" en la app y se crea un deal en HubSpot automáticamente. De los 8 hot leads contactados directamente, 3 respondieron: 1 quiere agendar, 1 pidió más info, 1 dijo que no por ahora. De los 19 en nurture, 5 ya llegaron al step 4 (mensaje directo) y 2 respondieron positivamente.

**Semana 3 — Métricas.** El founder abre las métricas de la campaña "Q3 Gastro Palermo". Ve que el warm intro convirtió 50% (1 de 2), el nurture convirtió 18% (2 de 11 que llegaron al step 4), y el directo convirtió 25% (2 de 8). También ve que los leads con score 85+ convirtieron 40% vs 12% los de score 50-70. Esto confirma que el scoring está funcionando bien y que el nurture necesita más volumen pero convierte.

**Semana 4 — Flywheel.** Esos datos retroalimentan el sistema. La próxima vez que se busquen leads gastronómicos, el scoring va a estar un poco más calibrado. Los prompts de nurture se ajustan basándose en qué mensajes se editaron más y cuáles generaron respuesta. La rueda gira.
