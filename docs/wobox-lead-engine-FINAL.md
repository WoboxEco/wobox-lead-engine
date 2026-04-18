# Wobox Lead Engine — Especificación Técnica FINAL

## Contexto

Wobox es una startup argentina que opera 3 productos:
- **Wobox Food**: Vende sobrestock de alimentos a consumidores a precios reducidos
- **Wobox Fashion**: Vende sobrestock de ropa y accesorios a consumidores
- **Loop**: Tarjeta digital de fidelización eco (sin plástico, vía QR) para marcas de cualquier tamaño

Opera en **Rosario, Buenos Aires (CABA) y Córdoba**. Equipo: 3 founders con acceso total.

Esta aplicación es el motor unificado de generación y gestión de leads outbound para los 3 productos.

---

## Objetivo

Sistema end-to-end multi-venture: **Prospección → Calentamiento → Contacto → Reunión → Métricas → Aprendizaje → Loop (Flywheel)**

---

## Estrategia de Construcción: 3 Capas

```
CAPA 1: Skills (semana 1-3)
  Piezas individuales que validan la lógica de negocio.
  Se ejecutan desde Claude Code con comandos simples.
  Escriben y leen de Supabase.
         │
         ▼
CAPA 2: Agentes (semana 4-5)
  Encadenan skills en workflows completos.
  "Prospectá Loop wellness Palermo" corre todo el pipeline.
         │
         ▼
CAPA 3: App Web (semana 6-9)
  Frontend en Next.js sobre la misma base de datos.
  Dashboard visual, compartido, filtrable por venture.
```

---

## Stack Tecnológico

| Componente | Tecnología | Rol | Capa |
|---|---|---|---|
| Base de datos + Auth | **Supabase** (PostgreSQL) | DB, auth, cron jobs, Edge Functions | 1, 2, 3 |
| Inteligencia artificial | **Claude API** (Sonnet) | Scoring + mensajes + análisis | 1, 2, 3 |
| Leads estructurados | **Apollo.io** (free tier) | Wobox Food + Fashion: cadenas/franquicias | 1, 2, 3 |
| Leads locales | **Web search** (Google, Maps, IG) | Loop: negocios locales + cadenas | 1, 2, 3 |
| CRM | **HubSpot** (plan pago existente) | Pipeline de ventas | 2, 3 |
| Booking reuniones | **Calendly** | Agendamiento | 2, 3 |
| Operación inicial | **Claude Code** + Skills | Ejecución via terminal | 1, 2 |
| Frontend + API | **Next.js** (React) en Vercel | Dashboard + API routes | 3 |
| Runtime | **Node.js** (ya instalado) | | 1, 2, 3 |

**Costo estimado:** ~$20-30/mes (Claude API). Todo lo demás en free tier.

---

## Multi-Venture: Qué comparten y qué no

| Aspecto | Compartido | Específico por venture |
|---|---|---|
| Base de datos | Sí — mismas tablas, campo `venture` | |
| Pipeline de prospección | Sí — mismos stages | |
| Pipeline de ventas (HubSpot) | Sí — mismo HubSpot | |
| Fuente de leads | | Wobox: Apollo · Loop: web search + Apollo para cadenas |
| Modelo de scoring | | Wobox: scoring-wobox · Loop: scoring-loop |
| Prompts de mensajes | | Distintos por venture × vertical × approach |
| Buyer personas | | Wobox: por vertical · Loop: 6 buyer personas |
| Secuencia de nurture | Misma estructura (4 steps) | Contenido distinto por venture |
| Dedup, asignación, warm path | Sí | |
| Métricas y flywheel | Sí — filtrable por venture | |

---

## Dual Pipeline

### Pipeline de Prospección (Supabase)

```
new → enriched → qualified → nurturing → contacted → meeting_booked → discarded
```

Mismo pipeline para los 3 ventures. El campo `venture` filtra la vista.

### Pipeline de Ventas (HubSpot)

```
sin contacto → contacto → presentación enviada → negociación → onboarding → cierre ganado → cierre perdido
```

### Puente
- `meeting_booked` en app → crea deal en HubSpot en `contacto`
- `cierre ganado/perdido` en HubSpot → actualiza Supabase para flywheel

---

## Fuentes de Leads por Venture

### Wobox Food & Fashion → Apollo.io (principal)
- Empresas medianas/grandes con estructura
- Filtros: vertical, tamaño, región, industria
- Datos incluyen: contactos, emails, LinkedIn, company size

### Loop → Doble fuente

**Fuente A: Web search** (negocios locales, 1-15 locales)
Basada en la skill de prospect research. Búsqueda exhaustiva por zona:

CABA por barrio: Palermo (Soho, Hollywood, Botánico), Recoleta, Belgrano, Villa Crespo, Caballito, San Telmo/Monserrat, Almagro/Boedo, Núñez/Saavedra, Flores/Floresta, Puerto Madero/Microcentro.

Rosario por zona: Centro/Pichincha, Echesortu/Fisherton, Parque Independencia, Barrio Martin/Alberdi.

Córdoba por zona: Nueva Córdoba, Güemes, Centro/General Paz, Cerro de las Rosas/Jardín.

Métodos de búsqueda:
- Google: `[sector] [barrio] [ciudad]`, `[sector] [barrio] site:instagram.com`
- Google Maps: todos los resultados por zona, no solo top 3
- Instagram hashtags: `#[sector][ciudad]`, `#[barrio][sector]`
- Directorios: argentino.com.ar, infoisinfo-ar.com, guialocal.com, Guía Óleo (food), CIAI (fashion)

Sub-sectores a buscar siempre por separado:
- Gastronómico: cafeterías, restaurantes, rotiserías, delis, panaderías, hamburgueserías, sushi, heladerías, catering
- Wellness/Beauty: peluquerías, barberías premium, estética, spas, pilates, yoga, depilación, nail studios, masajes, nutrición
- Fitness: gimnasios, crossfit, estudios boutique, clubes deportivos
- Retail: librerías, ferreterías, dietéticas, farmacias
- Moda: marcas indie, accesorios, calzado artesanal, ropa sustentable

**Fuente B: Apollo.io** (cadenas y franquicias para Loop)
Cadenas de cafeterías, panaderías, gimnasios, wellness chains — también usan Loop. Apollo da mejor data para estas.

---

## Buyer Personas

### Wobox Food & Fashion
El ICP es más simple: empresas de food retail o moda con sobrestock. El pitch se segmenta por vertical (food vs fashion) pero el perfil del comprador es similar: director comercial, gerente de compras, o founder de la marca.

### Loop — 6 Buyer Personas

#### BP1: El gastronómico (1 local a cadena)
- Perfil: Dueño o director de cafetería, restaurante, rotisería, panadería, heladería. Desde 1 local hasta cadenas de 50+.
- Dolor core: Gasta en captar pero no mide retención. Tarjetas de papel no funcionan. No tiene datos de frecuencia de visita.
- Pitch adaptado por tamaño:
  - 1-3 locales: "Cada cliente que se va lo notás directo en la caja. Loop te dice cuándo volver a llamarlos."
  - 4-15 locales: "Tus clientes van a cualquiera de tus locales pero vos no sabés cuántas veces. Loop te lo muestra."
  - 16+ locales / cadena: "Loop unifica la fidelización de todos tus puntos gastronómicos. Un cliente acumula en cualquier sucursal, vos ves todo desde un solo dashboard."
- Canal: 1-8 locales → Instagram DM / LinkedIn del dueño. Cadenas → LinkedIn del director comercial / Apollo.
- Ciclo: 1-3 locales = muy corto. 4-15 = corto. 16+ = medio (más decisores).
- Fuente: Locales chicos → web search. Cadenas → Apollo.

#### BP2: La dueña de wellness/beauty
- Perfil: Propietaria de peluquería, estética, spa, pilates. 1-3 locales.
- Dolor: Clientes van 1 vez y no vuelven con frecuencia esperada.
- Pitch: "Cada clienta que viene una vez vale 3 veces más si vuelve. Loop te dice cuándo recordárselo."
- Canal: Instagram / LinkedIn / referidas por proveedores
- Ciclo: Corto

#### BP3: El founder de moda indie
- Perfil: Fundador de marca de ropa/accesorios. 1-4 locales + e-commerce.
- Dolor: Tiene fans de marca pero no clientes recurrentes.
- Pitch: "Tu tarjeta de fidelización digital es parte de tu marca. Sin plástico, sin papel, sin fricción."
- Canal: Instagram / LinkedIn / eventos de moda sustentable
- Ciclo: Medio

#### BP4: El dueño de retail independiente
- Perfil: Dueño de librería, ferretería, dietética, farmacia. 1-15 locales.
- Dolor: Sin programa de fidelización o tiene uno obsoleto.
- Pitch: "Sin cambiar tu operación actual, tus clientes empiezan a acumular desde el primer día."
- Canal: LinkedIn / eventos retail / referidos
- Ciclo: Muy corto (1 local) a medio (cadena)

#### BP5: El operador de gimnasio/club
- Perfil: Dueño de gimnasio, club deportivo, estudio boutique. 1-3 sedes.
- Dolor: Churn post-enero brutal. Sin herramienta de reactivación.
- Pitch: "El cliente que falta 3 semanas seguidas es el que cancela. Loop te avisa antes."
- Canal: LinkedIn / referidos fitness / WhatsApp B2B
- Ciclo: Corto-medio

#### BP6: La cadena/franquicia no gastronómica
- Perfil: Cadena de peluquerías, gimnasios, retail, moda. 10-50+ locales. Franquicia o marca propia con múltiples sucursales. NO incluye cadenas gastronómicas (esas van en BP1).
- Dolor: Programa de fidelización legacy o inexistente. Sin datos unificados de recurrencia entre locales. Las tarjetas físicas no escalan.
- Pitch: "Loop unifica la fidelización de todos tus locales en una sola tarjeta digital. Tus clientes acumulan en cualquier sucursal, vos ves los datos de todas."
- Objeción típica: "Tenemos que pasarlo por IT / dirección." → ciclo más largo
- Canal: LinkedIn del director comercial / Apollo para datos estructurados
- Ciclo: Medio-largo (más decisores)

### Notas para el agente de outreach
- BP1 cubre todo el rango gastronómico (1 local a cadena 50+). Adaptar pitch por tamaño.
- Para 1 local: hablar de visibilidad del problema ("cada cliente que se va lo notás")
- Para cadenas: hablar de datos unificados y escalabilidad
- El ángulo eco es transversal — siempre diferenciador vs tarjetas físicas
- Moda indie: verificar si comunica sustentabilidad antes de usar ese gancho
- BP6 es solo para cadenas no gastronómicas (wellness, gym, retail, moda)

---

## Modelos de Scoring

### Scoring Wobox (scoring-wobox-v1.md)

Para Wobox Food y Wobox Fashion. Score 1-100.

| Dimensión | Peso | Alto | Medio | Bajo |
|---|---|---|---|---|
| Vertical | 25% | Food O fashion | Mix | Otras |
| Escala | 25% | 10+ locales | 5-9 | <5 |
| Probabilidad sobrestock | 20% | Perecederos, seasonal | Mix | Estable |
| Modelo franquicia | 15% | Central que decide | Descentralizada | No franquicia |
| Región | 15% | Rosario, BsAs, Córdoba | Otras AR | Fuera AR |

### Scoring Loop (scoring-loop-v1.md)

Para Loop. Score 1-100. Modelo distinto porque el ICP es diferente.

| Dimensión | Peso | Alto | Medio | Bajo |
|---|---|---|---|---|
| Potencial de recurrencia | 30% | Visita semanal+ (café, gym, peluquería) | Visita mensual (ropa, retail) | Visita esporádica |
| Sub-sector fit | 25% | Gastro, wellness, gym, moda indie | Retail general | Servicios profesionales, B2B |
| Presencia digital | 15% | Activo en IG, usa QR/digital payments | Tiene IG pero poco activo | Sin presencia digital |
| Escala y potencial | 15% | Cadena 10+ (gran deal) O 1-3 con crecimiento | 4-9 locales | 1 local sin señales de crecimiento |
| Región | 15% | CABA, Rosario, Córdoba | Otras AR | Fuera AR |

**Diferencias clave vs Wobox:**
- Recurrencia reemplaza a sobrestock (Loop vende fidelización, no excedente)
- Sub-sector fit reemplaza a vertical (más granular: no es "food" genérico sino "cafetería con clientes diarios")
- Escala no penaliza a los chicos — 1 local con crecimiento puntúa medio, cadena de 30 puntúa alto. Ambos son buenos, por distinta razón.
- Presencia digital importa más (si ya usa QR y MercadoPago, la adopción es más fácil)

### Rangos de acción (ambos modelos)
- 80-100 = Hot → contactar
- 50-79 = Warm → nurture
- <50 = Cold → guardar

### Accesibilidad fuera del scoring
La accesibilidad (warm path, decisor identificado) sigue siendo routing, no scoring.

---

## Prompts de IA

### Prompts de Scoring

#### scoring-wobox-v1.md
```
# Instrucciones para scoring de leads — Wobox (Food + Fashion)

## Tu rol
Sos un analista comercial senior de Wobox. Wobox es una startup argentina que:
- Vende sobrestock de alimentos y ropa a consumidores a precios reducidos
- Ofrece tarjetas de fidelización de usuarios a las marcas
- Opera en Rosario, Buenos Aires y Córdoba

## Criterios de evaluación
Evaluá cada dimensión en escala 0-100.

### 1. Vertical (peso: 25%)
- 80-100: Food retail (supermercados, panaderías, cadenas de comida) O moda/fashion (ropa, calzado, accesorios, fast fashion)
- 40-60: Mix que incluye algo de food o moda pero no es su foco
- 0-30: Otras verticales sin relación

### 2. Escala (peso: 25%)
- 80-100: 10+ puntos de venta
- 50-70: 5-9 puntos de venta
- 10-40: Menos de 5 puntos de venta
- Considerá potencial de crecimiento

### 3. Probabilidad sobrestock (peso: 20%)
- 80-100: Perecederos, seasonal, fast fashion, alta rotación
- 50-70: Mix de productos, algo de rotación
- 10-40: Producto estable, baja rotación
- Pistas: food retail = alta por vencimiento. Fast fashion = alta por temporadas.

### 4. Modelo franquicia (peso: 15%)
- 80-100: Franquicia centralizada (cerrar uno = ganar muchos)
- 50-70: Franquicia descentralizada
- 20-40: Marca propia, no franquicia
- 0-10: Negocio individual sin estructura

### 5. Región (peso: 15%)
- 80-100: Opera en Rosario, Buenos Aires o Córdoba
- 50-70: Otras ciudades de Argentina
- 10-30: Fuera de Argentina

## Formato de respuesta
JSON válido, sin texto adicional:
{
  "total_score": <int 1-100>,
  "vertical_score": <int 0-100>,
  "scale_score": <int 0-100>,
  "overstock_score": <int 0-100>,
  "franchise_score": <int 0-100>,
  "region_score": <int 0-100>,
  "ai_reasoning": "<2-3 oraciones con factores clave e incertidumbres>"
}

total_score = (vertical × 0.25) + (scale × 0.25) + (overstock × 0.20) + (franchise × 0.15) + (region × 0.15)

## Datos del lead
{LEAD_DATA}
```

#### scoring-loop-v1.md
```
# Instrucciones para scoring de leads — Loop

## Tu rol
Sos un analista comercial senior de Loop. Loop es una tarjeta digital de 
fidelización eco (sin plástico, vía QR) para marcas de cualquier tamaño 
en Argentina. Opera en Rosario, Buenos Aires (CABA) y Córdoba.

Loop funciona para negocios desde 1 local hasta cadenas de 50+. El valor 
depende de la recurrencia del negocio (clientes que vuelven seguido = más 
valor de fidelización).

## Criterios de evaluación
Evaluá cada dimensión en escala 0-100.

### 1. Potencial de recurrencia (peso: 30%)
- 80-100: Clientes visitan semanalmente o más. Café, peluquería, gym, 
  panadería, pilates, restaurante de barrio. La fidelización tiene 
  impacto directo en facturación.
- 50-70: Clientes visitan mensualmente. Tienda de ropa, estética, 
  retail especializado. Fidelización útil pero ciclo más largo.
- 10-40: Visita esporádica (compra anual, servicios puntuales). 
  Fidelización tiene poco impacto.

### 2. Sub-sector fit (peso: 25%)
- 80-100: Gastronómico (cafetería, restaurante, rotisería, heladería, 
  panadería), wellness/beauty (peluquería, estética, spa, pilates, yoga), 
  fitness (gym, crossfit, estudio boutique)
- 50-70: Retail independiente (librería, dietética, farmacia), moda indie
- 20-40: Servicios profesionales, B2B, sectores sin cliente recurrente
- Nota: Cadenas de cualquier sub-sector de arriba puntúan alto.

### 3. Presencia digital (peso: 15%)
- 80-100: Instagram activo (posts últimos 30 días), usa QR o pagos 
  digitales (MercadoPago, etc), tiene booking online
- 50-70: Tiene Instagram pero poco activo, alguna presencia digital
- 10-40: Sin presencia digital o presencia mínima
- Por qué importa: adopción de Loop es más fácil si ya están digitalizados.

### 4. Escala y potencial (peso: 15%)
- 80-100: Cadena 10+ locales (gran deal, alto revenue) O negocio de 
  1-3 locales con señales de crecimiento (abriendo nuevos, comunidad 
  activa, marca en ascenso)
- 50-70: 4-9 locales, o 1-3 locales estables con buena operación
- 20-40: 1 local sin señales de crecimiento, operación básica
- IMPORTANTE: No penalizar negocios chicos. Un café de especialidad 
  con 1 local y 200 clientes diarios es un lead excelente.

### 5. Región (peso: 15%)
- 80-100: CABA, Rosario o Córdoba capital
- 50-70: Otras ciudades de Argentina
- 10-30: Fuera de Argentina

## Buyer personas de referencia
Usá estos perfiles para enriquecer tu razonamiento:
- BP1 Gastronómico (1 local a cadena): dolor = no mide retención, valora facilidad (chico) o datos unificados (cadena)
- BP2 Wellness/Beauty: dolor = clientes no vuelven, valora imagen de marca
- BP3 Moda Indie: dolor = fans ≠ clientes recurrentes, valora ángulo eco
- BP4 Retail Indie: dolor = fidelización obsoleta, valora ROI claro
- BP5 Gym/Club: dolor = churn post-enero, valora gamificación
- BP6 Cadena no gastronómica: dolor = sin datos unificados entre locales, valora escalabilidad

## Formato de respuesta
JSON válido, sin texto adicional:
{
  "total_score": <int 1-100>,
  "recurrence_score": <int 0-100>,
  "subsector_score": <int 0-100>,
  "digital_score": <int 0-100>,
  "scale_score": <int 0-100>,
  "region_score": <int 0-100>,
  "buyer_persona": "<BP1|BP2|BP3|BP4|BP5|BP6>",
  "ai_reasoning": "<2-3 oraciones con factores clave. Mencioná qué buyer persona aplica y por qué.>"
}

total_score = (recurrence × 0.30) + (subsector × 0.25) + (digital × 0.15) + (scale × 0.15) + (region × 0.15)

## Datos del lead
{LEAD_DATA}
```

### Prompts de Mensajes — Wobox

(Mismos 5 prompts del spec v3: warm-intro, nurture-food, nurture-fashion, direct-food, direct-fashion. No se repiten aquí por brevedad — ver v3.)

### Prompts de Mensajes — Loop

#### message-loop-warm-intro-v1.md
```
# Generación de mensaje: Warm Intro — Loop

## Contexto
Sos un SDR de Loop pidiendo una warm intro a un contacto en común.

## Sobre Loop (contexto, no copiar textual)
Loop es una tarjeta digital de fidelización eco. Sin plástico, sin papel, 
vía QR. Ayuda a negocios a medir y aumentar la recurrencia de sus clientes.

## Instrucciones
- Tono: Cercano, profesional, breve. Como un mensaje entre colegas.
- Largo: Máximo 4-5 oraciones.
- Estructura: Saludo → mencioná que conoce al lead → 1 oración de por qué 
  te interesa → pedí la intro.
- Mencioná algo específico del negocio.
- NO exageres. Solo necesitás la presentación.

## Datos
Conector: {CONNECTOR_NAME}
Lead: {COMPANY_NAME}
Contacto: {CONTACT_NAME}, {CONTACT_ROLE}
Sub-sector: {SUBSECTOR}
Locales: {LOCATIONS_COUNT}
Buyer persona: {BUYER_PERSONA}
Dato relevante: {PROFILE_INSIGHT}

## Formato: Solo el texto del mensaje.
```

#### message-loop-nurture-v1.md
```
# Generación de mensaje: Nurture Sequence — Loop

## Contexto
Sos un SDR de Loop ejecutando una secuencia de calentamiento. El objetivo 
es generar familiaridad antes de cualquier pitch.

## Adaptación por buyer persona
Usá el buyer persona del lead para adaptar el contenido:
- BP1 Gastronómico (1-3 locales): ángulo retención visible, datos de frecuencia, cada cliente cuenta
- BP1 Gastronómico (4-15 locales): ángulo visibilidad entre locales, saber a cuál van
- BP1 Gastronómico (16+ / cadena): ángulo datos unificados, fidelización centralizada
- BP2 Wellness/Beauty: ángulo imagen de marca, eco-tarjeta, comunidad
- BP3 Moda Indie: ángulo sustentabilidad, fidelización digital, fans→clientes
- BP4 Retail Indie: ángulo ROI, simplicidad, competir con cadenas grandes
- BP5 Gym/Club: ángulo churn, reactivación, gamificación
- BP6 Cadena no gastronómica: ángulo datos unificados, escalabilidad, reemplazo de tarjeta física

## Steps

### Step 1: Comentario de valor en post del lead
- Ángulo según sub-sector (retención, fidelización, experiencia cliente)
- 2-3 oraciones, aportar dato o perspectiva. NO mencionar Loop.

### Step 2: Recurso de valor
- Dato relevante para su negocio según buyer persona.
- Ejemplos BP1 (chico): "El 60% de los clientes de cafeterías no vuelve después de 
  la 3ra visita si no hay incentivo"
- Ejemplos BP1 (cadena): "Las cadenas gastronómicas que unifican su programa de 
  fidelización ven un 25% más de cross-visits entre locales"
- Ejemplos BP5: "El churn en gyms de Argentina supera el 40% post-verano"
- 3-4 oraciones + dato. NO mencionar Loop.

### Step 3: Conexión LinkedIn
- Nota de 300 chars max. Referenciar interacción anterior. NO mencionar Loop.

### Step 4: Mensaje directo post-conexión
- Ahora SÍ mencionás Loop.
- Usá el pitch angle del buyer persona correspondiente.
- Preguntá si tiene sentido una charla de 15 min.
- Tono: café, no venta. 4-6 oraciones.

## Datos del lead
Empresa: {COMPANY_NAME}
Contacto: {CONTACT_NAME}, {CONTACT_ROLE}
Sub-sector: {SUBSECTOR}
Locales: {LOCATIONS_COUNT}
Región: {REGION}
Buyer persona: {BUYER_PERSONA}
Instagram: {SOCIAL_PROFILE}
Dato relevante: {PROFILE_INSIGHT}

## Step a generar: {STEP_NUMBER}
## Formato: Solo el texto del mensaje del step indicado.
```

#### message-loop-direct-v1.md
```
# Generación de mensaje: Contacto Directo — Loop

## Contexto
Contacto directo con un lead de Loop. Se usa cuando hay warm path o 
score muy alto.

## Instrucciones
- Tono: Directo pero cercano.
- Usá el pitch angle del buyer persona (ver abajo).
- Mencioná algo específico del negocio.
- Call to action: charla de 15 min.
- NO uses "solución integral", "propuesta de valor", jerga corporativa.
- El ángulo eco (sin plástico) es transversal — mencionarlo siempre.

## Pitch por buyer persona
- BP1 (1-3 locales): "Tu cliente ya viene. Loop te dice cuándo se va a ir y lo trae de vuelta."
- BP1 (4-15 locales): "Tus clientes van a cualquiera de tus locales pero no sabés cuántas veces. Loop te lo muestra."
- BP1 (16+ / cadena): "Loop unifica la fidelización de todos tus puntos gastronómicos en un solo dashboard."
- BP2: "Tu eco-tarjeta digital es parte de tu marca. Sin plástico, sin papel."
- BP3: "Tu tarjeta de fidelización en el celular del cliente. Consistente con tu marca sustentable."
- BP4: "Sin cambiar tu operación, tus clientes acumulan desde el primer día."
- BP5: "El cliente que falta 3 semanas es el que cancela. Loop te avisa antes."
- BP6: "Una sola tarjeta digital para todos tus locales. Datos unificados, sin plástico."

## Adaptación por tamaño
- 1-3 locales: "Cada cliente que se va lo notás directo en la caja."
- 4-9 locales: "Con Loop medís la recurrencia en todos tus puntos."
- 10+ locales/cadena: "Loop unifica la fidelización de todas tus sucursales."

## Canal: {CHANNEL}
- LinkedIn DM: 5 oraciones, informal
- Email: 6-7 oraciones + subject line
- WhatsApp: 4 oraciones, directo
- Instagram DM: 3-4 oraciones, casual

## Datos
Empresa: {COMPANY_NAME}
Contacto: {CONTACT_NAME}, {CONTACT_ROLE}
Sub-sector: {SUBSECTOR}
Locales: {LOCATIONS_COUNT}
Región: {REGION}
Score: {TOTAL_SCORE}
Buyer persona: {BUYER_PERSONA}
Razonamiento score: {AI_REASONING}
Warm connector: {WARM_CONNECTOR}
Dato relevante: {PROFILE_INSIGHT}

## Formato
Email: SUBJECT: [subject]\nBODY: [cuerpo]
Otros: Solo el texto.
```

---

## Buenas Prácticas y Reglas del Sistema

### 1. Deduplicación
Claves (en orden): `linkedin_url` → `website` (normalizado) → `instagram_handle` → `name + region`. Si duplicado: actualizar, no crear.

### 2. Asignación de leads
Campo `assigned_to` en companies. Reglas: warm path → founder con conexión. Sin warm path → round-robin. Dos founders nunca contactan al mismo lead.

### 3. Feedback de mensajes editados
`original_body` (IA) + `body` (final). El flywheel compara para mejorar generación.

### 4. Lead reactivation
`reactivation_date` = 6 meses post-discard o cierre perdido. Cron semanal mueve a `new`.

### 5. Rate limits y errores
Reintentos con backoff (3 intentos). Tabla `error_logs`. Nunca estado inconsistente.

### 6. Prompts versionados
Archivos en `/prompts/`. Campo `model_version` y `prompt_version` para trazabilidad.

### 7. Tracking de créditos
Tabla `api_usage`. Warning cuando Apollo < 1000 créditos.

---

## CAPA 1: Skills (Semana 1-3)

### Skill 1: `setup-database`
Crea todas las tablas, auth, índices, RLS. Una sola vez.

### Skill 2: `search-leads` (Apollo)
- **Para:** Wobox Food, Wobox Fashion, Loop cadenas (BP1 gastro 16+, BP6 non-gastro)
- **Input:** venture, vertical/sub-sector, región, tamaño mínimo, campaña
- **Proceso:** Apollo API → dedup → insert companies + contacts → assign founder → track créditos
- **Output:** "X leads encontrados. Y nuevos. Créditos usados: N."

### Skill 3: `search-leads-web` (Web search)
- **Para:** Loop negocios locales (BP1 chicos 1-15, BP2-BP5)
- **Input:** venture (loop), sub-sector, ciudad, barrio (o "todos"), campaña
- **Proceso:** Búsqueda exhaustiva por zona (Google, Maps, Instagram, directorios). Para cada resultado: nombre, dirección, locales, Instagram, estado activo, posicionamiento. Verificar decision maker (IG bio → web → Google → LinkedIn). Dedup → insert → assign.
- **Mínimo target:** 40+ leads por corrida por sub-sector.
- **Output:** Tabla con leads + priorización (rojo/amarillo/blanco) + "X leads guardados en Supabase."

### Skill 4: `import-csv`
- **Input:** CSV + venture
- **Proceso:** Parse → validar → dedup → insert. Acepta los 3 ventures.

### Skill 5: `enrich-lead`
- **Input:** company_id o "todos los new sin enriquecer"
- **Proceso:** Website → Instagram handle → follower count. Fallback: LinkedIn de Apollo. Para Loop leads de web search, muchos ya tienen Instagram del paso de búsqueda.

### Skill 6: `score-leads`
- **Input:** company_id o filtro. El skill detecta el venture del lead y aplica el prompt correcto.
- **Proceso:** Si venture = wobox_food o wobox_fashion → `scoring-wobox-v1.md`. Si venture = loop → `scoring-loop-v1.md`.
- **Loop extra:** Asigna buyer persona (BP1-BP6) automáticamente.

### Skill 7: `check-warm-path`
Mismo para los 3 ventures. Apollo para datos de conexiones.

### Skill 8: `generate-messages`
- **Input:** company_id, approach, channel, step
- **Selección de prompt automática por venture:**
  - wobox_food + nurture → `message-nurture-food-v1.md`
  - wobox_fashion + nurture → `message-nurture-fashion-v1.md`
  - loop + nurture → `message-loop-nurture-v1.md` (usa buyer persona)
  - (igual para warm_intro y direct)

### Skill 9: `sync-hubspot`
Push leads `meeting_booked` → HubSpot. Pull resultados.

### Skill 10: `show-pipeline`
Filtrable por venture, stage, vertical/sub-sector, región, campaña, score, founder.

### Skill 11: `show-metrics`
KPIs filtrados por venture. Incluye: conversion por venture, por approach, por buyer persona (Loop).

### Skill 12: `approve-message`
Aprobar, editar, o descartar mensajes draft.

---

## CAPA 2: Agentes (Semana 4-5)

### Agente 1: `full-prospecting`
```
Input: venture, sector/sub-sector, región, campaña
Flujo:
  1. Si venture=wobox → search-leads (Apollo)
     Si venture=loop + cadena (BP1 16+ o BP6) → search-leads (Apollo)
     Si venture=loop + local (BP1-BP5 chicos) → search-leads-web
  2. enrich-lead
  3. score-leads (auto-detecta modelo)
  4. Filtrar qualified (>= 50)
  5. check-warm-path
  6. generate-messages (auto-selecciona prompts)
Output: Resumen por venture con leads por categoría.
```

### Agente 2: `nurture-sequence`
Mismo que v3. Auto-adapta contenido por venture y buyer persona.

### Agente 3: `daily-review`
Agrega filtro por venture. Muestra estado de los 3 productos.

### Agente 4: `campaign-report`
Análisis por venture. Para Loop: breakdown por buyer persona.

---

## CAPA 3: App Web (Semana 6-9)

### API Routes
Mismos que v3 + filtro `venture` en todos los endpoints.

### Frontend — Vistas

#### Vista 1: Pipeline
- Selector de venture arriba (Wobox Food / Wobox Fashion / Loop / Todos)
- Kanban con cards filtradas
- Cards de Loop muestran buyer persona badge (BP1-BP6)

#### Vista 2: Detalle de Lead
- Muestra el scoring del modelo correcto (Wobox o Loop)
- Loop: muestra buyer persona asignado + pitch angle sugerido
- Resto igual que v3

#### Vista 3: Métricas
- Filtro por venture
- Loop: conversion por buyer persona, por sub-sector
- Cross-venture: comparación de rendimiento entre productos

### Cron Jobs
Mismos que v3. Aplican a los 3 ventures.

---

## Modelo de Datos (Supabase)

### Tabla: `companies`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| name | text | |
| venture | enum | `wobox_food`, `wobox_fashion`, `loop` |
| vertical | enum | `food`, `fashion`, `other` (Wobox) |
| subsector | text | Nullable — para Loop: "cafetería", "peluquería", etc. |
| buyer_persona | enum | Nullable — `BP1`..`BP6` (solo Loop) |
| locations_count | int | |
| is_franchise | boolean | |
| franchise_type | enum | `centralized`, `decentralized`, `not_franchise` |
| region | text | Ciudad |
| neighborhood | text | Nullable — barrio (relevante para Loop búsqueda por zona) |
| social_followers | int | |
| social_source | enum | `instagram`, `linkedin`, `manual`, `pending` |
| instagram_handle | text | Nullable |
| overstock_likelihood | enum | Nullable — `high`, `mid`, `low` (solo Wobox) |
| recurrence_potential | enum | Nullable — `high`, `mid`, `low` (solo Loop) |
| digital_readiness | enum | Nullable — `high`, `mid`, `low` (solo Loop: usa QR, pagos digitales) |
| website | text | Nullable |
| linkedin_url | text | Nullable |
| apollo_id | text | Nullable |
| hubspot_id | text | Nullable |
| hubspot_deal_id | text | Nullable |
| stage | enum | `new`, `enriched`, `qualified`, `nurturing`, `contacted`, `meeting_booked`, `discarded` |
| source | enum | `apollo`, `web_search`, `csv`, `manual` |
| assigned_to | uuid | FK → auth.users |
| campaign_id | uuid | FK → campaigns (nullable) |
| reactivation_date | timestamp | Nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

### Tabla: `contacts`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| company_id | uuid | FK → companies |
| name | text | |
| role | text | |
| email | text | Nullable |
| linkedin_url | text | Nullable |
| instagram_url | text | Nullable — relevante para Loop (DM via IG) |
| phone | text | Nullable |
| warm_path | enum | `direct`, `2nd_degree`, `none` |
| warm_connector | text | Nullable |
| is_decision_maker | boolean | |
| contact_source | text | Nullable — "IG bio", "website about", "Apollo", "LinkedIn" |
| created_at | timestamp | |

### Tabla: `scores`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| company_id | uuid | FK → companies |
| total_score | int | 1-100 |
| dimension_1_score | int | Wobox: vertical / Loop: recurrence |
| dimension_2_score | int | Wobox: scale / Loop: subsector |
| dimension_3_score | int | Wobox: overstock / Loop: digital |
| dimension_4_score | int | Wobox: franchise / Loop: scale |
| dimension_5_score | int | Región (ambos) |
| scoring_model | text | `scoring-wobox-v1` o `scoring-loop-v1` |
| ai_reasoning | text | |
| buyer_persona_assigned | text | Nullable — solo Loop |
| scored_at | timestamp | |

### Tabla: `interactions`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| contact_id | uuid | FK → contacts |
| company_id | uuid | FK → companies |
| campaign_id | uuid | FK → campaigns (nullable) |
| type | enum | `like`, `comment`, `resource_sent`, `connection_request`, `message`, `email`, `call`, `meeting`, `reactivation` |
| channel | enum | `linkedin`, `email`, `whatsapp`, `phone`, `in_person`, `instagram_dm`, `calendly` |
| content | text | |
| ai_generated | boolean | |
| outcome | enum | `pending`, `sent`, `opened`, `replied`, `accepted`, `declined`, `meeting_booked`, `no_response` |
| performed_by | uuid | |
| performed_at | timestamp | |

### Tabla: `messages`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| contact_id | uuid | FK → contacts |
| company_id | uuid | FK → companies |
| campaign_id | uuid | FK → campaigns (nullable) |
| sequence_step | int | 1-4 |
| approach_type | enum | `warm_intro`, `nurture`, `direct` |
| channel | enum | `linkedin`, `email`, `whatsapp`, `instagram_dm` |
| subject | text | Nullable |
| body | text | Versión final |
| original_body | text | Lo que generó la IA |
| prompt_version | text | Ej: "message-loop-nurture-v1" |
| status | enum | `draft`, `approved`, `sent`, `discarded` |
| created_at | timestamp | |

### Tabla: `campaigns`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| name | text | Ej: "Q3 Loop Wellness Palermo" |
| venture | enum | `wobox_food`, `wobox_fashion`, `loop` |
| vertical_focus | text | Wobox: food/fashion. Loop: sub-sector |
| region_focus | text | |
| approach_strategy | text | |
| status | enum | `active`, `paused`, `completed` |
| started_at | timestamp | |
| ended_at | timestamp | Nullable |
| created_at | timestamp | |

### Tabla: `error_logs`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| skill | text | |
| company_id | uuid | Nullable |
| error_type | text | |
| error_message | text | |
| resolved | boolean | Default false |
| created_at | timestamp | |

### Tabla: `api_usage`

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| service | enum | `apollo`, `claude`, `instagram`, `google` |
| operation | text | |
| credits_used | int | |
| tokens_used | int | Nullable |
| venture | enum | Para tracking de costo por producto |
| created_at | timestamp | |

---

## Sync con HubSpot
- Push: `meeting_booked` → deal en HubSpot. Campo `venture` se refleja como property custom en HubSpot.
- Pull: `cierre ganado/perdido` → actualiza Supabase.

---

## Plan de Ejecución

### Capa 1 — Skills (Semana 1-3)
- [ ] `setup-database`: tablas + auth + prompts
- [ ] `search-leads` (Apollo): Wobox + Loop cadenas
- [ ] `search-leads-web`: Loop negocios locales
- [ ] `import-csv`: multi-venture
- [ ] `enrich-lead`: Instagram lookup
- [ ] `score-leads`: auto-detecta modelo por venture
- [ ] `check-warm-path`
- [ ] `generate-messages`: auto-selecciona prompts
- [ ] `show-pipeline`: filtrable por venture
- [ ] `show-metrics`
- [ ] `approve-message`
- [ ] Validar con 20+ leads reales por venture

### Capa 2 — Agentes (Semana 4-5)
- [ ] `full-prospecting`: multi-venture
- [ ] `nurture-sequence`: adapta por venture + buyer persona
- [ ] `daily-review`: vista cross-venture
- [ ] `campaign-report`: analytics por venture
- [ ] `sync-hubspot`
- [ ] Primera campaña real por venture

### Capa 3 — App Web (Semana 6-9)
- [ ] Next.js + Vercel
- [ ] API routes con filtro venture
- [ ] Pipeline con selector de venture
- [ ] Detalle con scoring modelo correcto
- [ ] Métricas cross-venture
- [ ] Cron jobs
- [ ] Deploy

---

## Decisiones Resueltas

- [x] Booking: Calendly
- [x] Fuente leads: Apollo + Web search
- [x] Pipeline dual: prospección en app + ventas en HubSpot
- [x] Stages HubSpot: sin contacto → contacto → presentación → negociación → onboarding → cierre ganado/perdido
- [x] Multi-venture desde día 1
- [x] Loop incluye cadenas (BP6) — no solo negocios chicos
- [x] Approach: Skills → Agentes → App

## Decisiones Pendientes

- [ ] Roles de cada founder (o todos hacen todo)
- [ ] API key Apollo
- [ ] API key Claude
- [ ] Credenciales Supabase
- [ ] Credenciales HubSpot API
- [ ] URL Calendly
