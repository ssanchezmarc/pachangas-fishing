# PRD — App de clasificaciones para campeonatos de pesca con lectura IA de plicas

**Estado:** borrador v1 · **Fecha:** 2026-06-08 · **Autor:** Sergio Sánchez
**Origen:** sesión de grill-me (decisiones cerradas en `~/.claude/projects/.../memory/design-decisions.md`)

---

## 1. Resumen ejecutivo

Aplicación para automatizar las **clasificaciones provisionales y finales** de campeonatos de pesca. Hoy los controladores anotan a mano en una **plica** de papel las capturas (número y tallas) de cada pescador. La propuesta: el controlador **fotografía la plica y la envía por un WhatsApp oficial del club**; un **LLM multimodal** lee la foto, extrae las piezas y la cuadra contra los totales escritos; un **motor de reglas** calcula las clasificaciones (individual y por parejas) y se publican en una **web en vivo** más un resumen al grupo de WhatsApp, con un flujo **provisional → reclamaciones → final** auditado.

**Objetivo de negocio:** eliminar el cálculo manual de clasificaciones (lento y propenso a error), dar resultados casi en tiempo real a los participantes y dejar trazabilidad para resolver reclamaciones.

---

## 2. Problema y contexto

- Las clasificaciones se calculan hoy a mano a partir de plicas de papel → lento, tedioso y con errores que generan disputas.
- Los controladores ya usan WhatsApp de forma natural en el evento.
- La plica real (referencia: "VII Liga Duos Alto Carrión 2026") ya está **semiestructurada y es autovalidante**: por cada pieza hay 3 señales (decena marcada, unidad marcada, talla manuscrita) y al pie hay totales (total capturas talla, menores talla, pieza mayor) que sirven de checksum.
- Las pruebas son en río/embalse, con cobertura móvil irregular.

---

## 3. Alcance

### En alcance (v1)
- Un **único club** (con `club_id` en el modelo desde el día 1 para habilitar multi-club a futuro sin reescritura).
- Estructura **mangas + sectores/tramos**; el controlador es otro pescador (pesca un tramo, controla otro).
- Clasificación **individual y por parejas** (formato "Liga Duos").
- Lectura IA de plicas + revisión humana (HITL).
- Canal de entrada **WhatsApp Cloud API**.
- Web en vivo de clasificaciones + push de resumen al grupo.
- Flujo provisional → reclamación → final, con auditoría.

### Fuera de alcance (v1)
- Multi-club / SaaS (facturación, onboarding de clubes).
- Liga acumulada de temporada (varias jornadas) como vista propia.
- Modelo de visión propio entrenado.
- App nativa (se entrega como web/PWA).
- Login para controladores y participantes.

### Decisión de naming
Usar **`club_id`** y la entidad **`club`** (lenguaje del dominio). **No** usar `tenant_id` ni jerga genérica de SaaS.

---

## 4. Usuarios y roles

| Rol | Quién | Autenticación (v1) | Qué hace |
|---|---|---|---|
| **Comité / Admin** | Organización del club | Login real (Supabase Auth) | Configura campeonato y mangas, carga censo, revisa cola HITL, resuelve reclamaciones, publica final |
| **Controlador** | Pescador que controla a otro | Sin login; reconocido por su nº de WhatsApp en lista blanca | Fotografía y envía la plica; responde a las confirmaciones del bot |
| **Participante** | Pescador / público | Sin login; web abierta | Consulta clasificaciones provisionales y finales |

---

## 5. Modelo de dominio

```
Club (club_id en todas las tablas)
└── Competición / Liga            "VII Liga Duos Alto Carrión 2026"
    └── Manga (fecha, horario)    "7ª Manga, día 07, 15:45–17:45"
        └── Sector / Tramo        el pescador pesca un tramo y controla otro
            └── Plica             1 por pescador y manga
                └── Pieza         talla redondeada; válida o menor-de-talla
Pescador ── Dorsal (clave de identificación en la manga)
Pareja (Duo) = 2 pescadores
```

**Tablas núcleo:** `club`, `competicion`, `manga`, `sector`, `pescador`, `pareja`,
`inscripcion_manga` (censo: dorsal → pescador → sector → a quién controla),
`plica`, `pieza`, `clasificacion` (materializada por ámbito e individual/parejas),
`reclamacion`, `auditoria`, `foto_plica` (evidencia en storage).

Todas con `club_id`.

---

## 6. Reglas de puntuación (motor configurable)

El motor es **declarativo** (parámetros por campeonato), no `if`s hardcodeados.

**Preset por defecto** (el de la plica real):
- **Pieza válida** (≥ talla mínima; talla mínima por defecto = 19 cm), con **redondeo al cm superior** (19,3 → 20; 26,7 → 27):
  `puntos = 100 + (cm³ / 100)`
- **Pieza menor de talla:** `60` puntos fijos.
- **Agregación:** **suma de puestos** (sistema federado FEPyC). En cada sector/manga se ordena por puntos de captura y se asigna puesto (1º = 1 punto de clasificación…). La final = **menor suma de puestos gana**.
- **Desempates (estándar FEPyC):**
  - Empate de puntos dentro de un sector → reparto del **promedio** de los puestos en disputa.
  - Empate en la final → mayor **suma de puntos de captura** totales; si persiste, **pieza mayor**.

**Parámetros configurables por campeonato:** talla mínima, puntos base por pieza, fórmula de tamaño, puntos de pieza menor-talla, regla de redondeo, regla de desempate, método de agregación.

---

## 7. Flujo end-to-end

1. **Setup de manga** (admin): crea la manga y carga el censo (dorsales, sectores, quién controla a quién). La manga activa se deduce por fecha/configuración.
2. **Captura**: el controlador fotografía la plica y la envía al número de WhatsApp del club.
3. **Webhook (WhatsApp Cloud API)**: responde `200` de inmediato y **encola** el procesado (no se procesa el LLM dentro del webhook).
4. **Lectura IA (LLM multimodal)**: devuelve **JSON estructurado** — lista de piezas `{decena, unidad, talla_manuscrita}`, totales del pie, pieza mayor, dorsal, y **autoconfianza** por campo.
5. **Validación automática**: cuadra detalle ↔ totales; concuerdan las 3 señales por pieza; el dorsal existe en el censo.
6. **Bucle de calidad**: si algo no cuadra, el **bot responde al controlador** por WhatsApp ("⚠️ Plica 17: leo 3 piezas pero el total dice 4. ¿Reenvías foto más nítida o confirmas?") mientras aún tiene el papel delante. Si persiste, pasa a la cola del comité con la incidencia marcada.
7. **HITL** (cola del comité): el comité confirma/corrige en segundos con la foto al lado. Cada corrección queda etiquetada → dataset gratis para especializar el modelo a futuro.
8. **Cálculo**: el motor de reglas recalcula las clasificaciones afectadas.
9. **Publicación**: web en vivo (polling 15–30 s) como fuente de verdad + el bot empuja resumen/enlace al grupo.
10. **Provisional → reclamación → final**: al cerrar la manga se publica la **provisional** y arranca un plazo de reclamación; las reclamaciones se registran (quién, qué plica, motivo), el comité resuelve y al cerrar el plazo se publica la **final inmutable**. Todo cambio queda en auditoría.

---

## 8. Requisitos funcionales

- **RF-1** El admin crea competiciones y mangas y define sus reglas de puntuación.
- **RF-2** El admin carga el censo de la manga (dorsal → pescador → sector → controlador).
- **RF-3** El sistema recibe fotos por WhatsApp solo de números en lista blanca.
- **RF-4** La IA extrae piezas, tallas, totales y dorsal en JSON con confianza por campo.
- **RF-5** El sistema valida detalle ↔ totales y la coherencia de las 3 señales por pieza.
- **RF-6** Ante incoherencia/baja confianza, el bot pide acción al controlador por WhatsApp.
- **RF-7** Las plicas dudosas entran en una cola de revisión humana con la foto adjunta.
- **RF-8** El motor calcula clasificaciones individual y por parejas (suma de puestos + desempates FEPyC).
- **RF-9** La web pública muestra clasificaciones en vivo por individual, parejas y sector.
- **RF-10** El bot empuja un resumen/enlace al grupo al haber provisional y final.
- **RF-11** El sistema gestiona estados provisional → reclamación → final con auditoría inmutable.
- **RF-12** Se conserva la foto original de cada plica como evidencia.

## 9. Requisitos no funcionales

- **RNF-1 Correcciones primero:** las clasificaciones deben ser exactas y reproducibles antes que rápidas.
- **RNF-2 Latencia:** resultado provisional en minutos tras el cierre de manga; web refresca cada 15–30 s.
- **RNF-3 Robustez de red:** WhatsApp encola y reenvía al recuperar señal; la "entrega máximo 21:00" cuenta hora de **envío**, no de recepción.
- **RNF-4 Auditoría:** toda corrección y resolución de reclamación queda registrada con autor y timestamp.
- **RNF-5 Privacidad:** datos personales mínimos (nombre, dorsal); fotos en storage privado.
- **RNF-6 Coste:** volumen de decenas de fotos por jornada → coste de IA en céntimos; infra de bajo coste.

---

## 10. Arquitectura y stack

| Capa | Tecnología |
|---|---|
| Web + API + webhooks | **Next.js + TypeScript** (monorepo único) |
| Base de datos | **Postgres (Supabase)** |
| Storage de fotos (evidencia) | **Supabase Storage** (privado) |
| Auth admin | **Supabase Auth** (solo comité) |
| Mensajería | **WhatsApp Cloud API** (Meta Business + nº dedicado) |
| Cola / procesado async | **Inngest** o **QStash** (desacoplar webhook ↔ LLM) |
| Visión IA | **LLM multimodal** (Claude / GPT-4o vision) con salida estructurada |
| Hosting | **Vercel** + Supabase |
| Tiempo real | **Polling 15–30 s** (suficiente: datos en ráfaga al cierre) |

**Nota de arquitectura crítica:** el webhook de WhatsApp debe responder rápido y delegar el trabajo del LLM a una cola; nunca procesar la visión dentro del handler del webhook.

---

## 11. Roadmap por fases

- **Fase 0 — Núcleo offline:** modelo de datos + motor de reglas + carga manual de plicas + web de clasificación. *Valida que las clasificaciones salen exactas antes de meter IA.*
- **Fase 1 — IA + HITL:** lectura LLM con JSON estructurado, validación por checksum, cola de revisión.
- **Fase 2 — WhatsApp:** Cloud API, webhook + cola, identificación por dorsal, bot que pide reenvíos.
- **Fase 3 — Provisional/Final:** estados, ventana de reclamaciones, auditoría, publicación al grupo.
- **Fase 4 — Futuro:** multi-club, liga acumulada de temporada, especialización del modelo de visión con el dataset acumulado, QR pre-impreso en plicas si la identificación por dorsal da errores.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Dorsal manuscrito mal leído | Confirmación del bot salvo confianza alta; QR pre-impreso en Fase 4 |
| Cobertura móvil en el río | WhatsApp encola y reenvía; contar hora de envío |
| Aprobación de Meta Business lenta | Tramitar nº y verificación con antelación |
| LLM procesado dentro del webhook → timeouts | Encolar siempre (Inngest/QStash) |
| Clasificación errónea publicada | HITL + estado provisional con ventana de reclamación antes de la final |
| Fotos ilegibles / totales imposibles | Bucle de reenvío con el controlador + cola del comité |

---

## 13. Métricas de éxito

- % de plicas leídas correctamente de forma automática (sin tocar la cola HITL).
- Tiempo desde cierre de manga hasta clasificación provisional publicada.
- Nº de reclamaciones por manga (tendencia a la baja).
- Tiempo de cálculo manual eliminado por jornada.

---

## 14. Preguntas abiertas

- ¿Duración exacta de la ventana de reclamación (p.ej. 30 min)?
- ¿Cómo se cargará el censo de la manga (CSV, formulario, importación)?
- ¿Modelo de visión concreto y formato exacto del JSON de salida (a definir en Fase 1)?
- ¿Se quiere PWA instalable o basta web responsive en v1?
