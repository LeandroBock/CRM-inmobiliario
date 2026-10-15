# CRM Inmobiliario Cognitivo (Argentina)

Monorepo: NestJS (Clean Architecture) + TypeORM/PostgreSQL+PostGIS + React + microservicio Python (XGBoost).

## Estructura de carpetas

```
crm-cognitivo/
├── docker-compose.yml
├── package.json                      # npm workspaces
├── apps/
│   ├── api/                          # NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── config/               # configuración tipada (env)
│   │   │   ├── shared/
│   │   │   │   ├── domain/           # value objects (Money, ExchangeRate)
│   │   │   │   └── infrastructure/   # transformers, filtros, logger
│   │   │   └── modules/
│   │   │       ├── properties/       # inventario (domain/app/infra/presentation)
│   │   │       ├── avo/              # Módulo 1: tasación
│   │   │       │   ├── domain/
│   │   │       │   ├── application/  # use-cases
│   │   │       │   ├── infrastructure/ # cliente HTTP al servicio Python
│   │   │       │   └── presentation/ # controller + DTOs
│   │   │       ├── social-media/     # Módulo 2: contenido + publicación + métricas
│   │   │       │   ├── domain/       # interfaces SocialPublisher
│   │   │       │   ├── application/  # generar copy, programar, optimizar horarios
│   │   │       │   └── infrastructure/ # meta.publisher, linkedin.publisher, tiktok.publisher
│   │   │       ├── communication/    # Módulo 3: WhatsApp + LLM + RAG
│   │   │       │   ├── domain/
│   │   │       │   ├── application/
│   │   │       │   ├── infrastructure/ # whatsapp.client, llm.client, rag
│   │   │       │   └── presentation/   # webhook controller
│   │   │       ├── lead-engine/      # Módulo 4: scoring + matching
│   │   │       └── leads/            # CRUD de clientes
│   │   └── migrations/
│   ├── web/                          # React + Vite + TS
│   │   └── src/
│   │       ├── api/                  # cliente HTTP
│   │       ├── components/
│   │       └── pages/Dashboard.tsx
│   └── avm-service/                  # Python (FastAPI + XGBoost)
│       ├── main.py
│       ├── train.py
│       └── requirements.txt
└── packages/
    └── shared-types/                 # DTOs/enums compartidos API <-> web
```

## Decisiones clave

- **Clean Architecture**: cada módulo separa `domain` (entidades puras y puertos/interfaces), `application` (casos de uso), `infrastructure` (TypeORM, HTTP, SDKs) y `presentation` (controllers). Los casos de uso dependen de puertos, no de SDKs.
- **Moneda**: el modelo de tasación trabaja solo en USD. Los ARS se derivan con la cotización registrada en `Property` (`fxRate`, `fxSource`, `fxRateDate`).
- **Geolocalización**: columna `geography(Point,4326)` con índice GIST para búsquedas por radio.
- **Webhooks**: se responde 200 de inmediato y se procesa en segundo plano (WhatsApp reintenta si tarda).
- **Publicación en redes**: cada plataforma implementa la interfaz `SocialPublisher`; las credenciales y aprobación de apps (Meta App Review, LinkedIn, TikTok Content Posting API) son requisitos externos.
- **Nota de nombres**: usé `AvoModule` / `AvoPrediction` como pediste (es el AVM, Automated Valuation Model).

## Docker

- `docker-compose.yml`: para desarrollo y pruebas locales (base en el 5433, `DB_SYNC=true`, http).
- `docker-compose.prod.yml`: para producción, con HTTPS. Ver **Producción** más abajo.

Las imágenes de la API y la web se construyen desde la raíz del repo, porque usan el `package-lock.json` del
monorepo y así instalan siempre las mismas versiones (`docker build -f apps/api/Dockerfile .`).

## Autenticación

Todos los endpoints exigen `Authorization: Bearer <token>`, salvo `POST /auth/login` y el webhook de WhatsApp
(que se protege con su verify token y la firma HMAC de Meta).

- Roles: `admin` (gestiona usuarios) y `agent` (usa el CRM).
- El primer administrador se crea solo al arrancar si la tabla `users` está vacía, con `ADMIN_EMAIL` y `ADMIN_PASSWORD` del `.env`.
- El login admite 5 intentos por minuto por IP. Detrás de un proxy inverso hay que poner `TRUST_PROXY` (cantidad de proxies) para que cuente la IP real; `docker-compose.prod.yml` ya lo hace.
- Cambiar la contraseña invalida los tokens anteriores; desactivar un usuario o cambiarle el rol rige de inmediato.

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@tuinmobiliaria.com","password":"tu-contraseña"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
curl http://localhost:3000/leads -H "Authorization: Bearer $TOKEN"
```

| Método y ruta | Qué hace |
|---|---|
| `POST /auth/login` | Devuelve `accessToken` y los datos del usuario |
| `GET /auth/me` | Usuario de la sesión actual |
| `POST /auth/change-password` | Cambia la contraseña y devuelve una sesión nueva |
| `POST/GET /users`, `PATCH /users/:id` | Alta, listado y edición de usuarios (solo admin) |

## Endpoints principales

| Método y ruta | Qué hace |
|---|---|
| `POST /properties` | Alta de propiedad. Enviar `priceUsd` (o `priceArs`); la cotización se consulta sola si no se manda `fxRate` |
| `GET /properties` | Listado paginado. Filtros: `status`, `type`, `operation`, `neighborhood`, `minPriceUsd`, `maxPriceUsd`, `minRooms`, `q`, y cercanía con `lat`+`lng`+`radiusM` |
| `GET/PATCH/DELETE /properties/:id` | Detalle, edición (recalcula el bloque bimonetario si cambia precio o cotización) y baja |
| `POST /properties/refresh-fx` | Recalcula los precios en pesos con la cotización de hoy (también corre solo a las 9:00, lunes a viernes) |
| `POST /leads` | Alta de lead. El teléfono se normaliza a +549… y se calcula su puntaje |
| `GET /leads` | Listado paginado ordenado por puntaje. Filtros: `stage`, `temperature`, `q`, `assignedTo` (`me`, `none` o id de asesor) |
| `PATCH /leads/:id/assign` | Asigna el lead a un asesor (`userId`) o lo deja sin asignar (`null`). Un asesor solo puede tomar leads libres o pasar los suyos |
| `GET /users/team` | Asesores activos (id y nombre) para los selectores. `GET/POST/PATCH /users` es solo para admins |
| `GET/PATCH/DELETE /leads/:id` | Detalle, edición y baja |
| `GET /leads/:id/chats` | Conversación del lead con el asistente de WhatsApp |
| `POST /avo/appraise` | Tasación en USD con plusvalía a 3 años |
| `POST /leads/:id/messages` | El asesor le escribe por WhatsApp (pausa al asistente). Solo dentro de las 24 h del último mensaje del cliente |
| `GET /leads/:id/messages/window` | Si la ventana de 24 h está abierta, hasta cuándo, y si hay plantilla configurada |
| `POST /leads/:id/messages/template` | Manda la plantilla `WHATSAPP_REENGAGE_TEMPLATE` para retomar una conversación vieja |
| `POST /lead-engine/leads/:id/match` | Recalcula el top de propiedades ideales para el lead |
| `GET /lead-engine/leads/:id/matches` | Matches guardados (sin recalcular) |
| `PATCH /lead-engine/matches/:id/feedback` | Respuesta del cliente a una sugerencia: `me_gusta`, `no_me_interesa`, `visito` |
| `GET/POST /visits`, `PATCH/DELETE /visits/:id` | Agenda de visitas. Filtros: `from`, `to`, `leadId`, `status`. No deja superponer visitas a la misma propiedad |
| `GET /notifications`, `GET /notifications/unread-count` | Avisos del equipo (visita por confirmar, cliente esperando, lead caliente) |
| `PATCH /notifications/:id/read`, `POST /notifications/read-all` | Marcar avisos como leídos |
| `PATCH /auth/me/preferences` | Preferencias propias, p. ej. `{ "emailAlerts": false }` para no recibir avisos por email |
| `GET /chat-media/:messageId` | Audio o foto que mandó un cliente por WhatsApp (privado: requiere sesión) |
| `POST /media/photos` | Sube fotos (multipart, campo `files`): las achica a 1920 px, las pasa a JPG y les borra el GPS. Devuelve sus URLs |
| `POST /media/photos/cleanup` | (admin) Borra fotos huérfanas con más de 24 h. También corre sola cada noche |
| `POST /social/generate` | Genera un copy o guion con IA y puede programarlo |
| `GET /dashboard` | Datos del panel (embudo, leads calientes, posts, horarios) |
| `GET/POST /webhooks/whatsapp` | Verificación y recepción de mensajes de WhatsApp |

Ejemplo de alta de propiedad:

```bash
curl -X POST http://localhost:3000/properties -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{
  "title": "Depto 2 amb. con balcón en Pichincha",
  "type": "departamento", "operation": "venta",
  "address": "Balcarce 1200", "neighborhood": "Pichincha", "city": "Rosario", "province": "Santa Fe",
  "lat": -32.9442, "lng": -60.6505,
  "coveredM2": 52, "totalM2": 58, "rooms": 2, "bedrooms": 1, "bathrooms": 1,
  "priceUsd": 98000, "fxSource": "blue"
}'
```

## Variables de entorno (apps/api/.env)

Desarrollo local (API con `npm run start:dev` y solo la base en Docker con `docker compose up -d db`):
usar `localhost`. El host `db` / `avm` solo existe dentro de la red de Docker Compose, que ya lo define sola.

```
DATABASE_URL=postgres://crm:crm@localhost:5433/crm
DB_SYNC=true
AVM_SERVICE_URL=http://localhost:8000
ANTHROPIC_API_KEY=
OPENAI_API_KEY=                  # transcripción de audios de WhatsApp (Whisper)
TRANSCRIBE_MODEL=whisper-1
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_REENGAGE_TEMPLATE=      # plantilla aprobada para retomar conversaciones (ver .env.example)
WHATSAPP_TEMPLATE_LANG=es_AR
UPLOAD_DIR=uploads               # carpeta de fotos subidas
AUTO_ASSIGN_LEADS=true           # reparte los leads de WhatsApp al asesor con menos leads abiertos
SMTP_HOST= / SMTP_PORT= / SMTP_USER= / SMTP_PASS= / SMTP_FROM=   # avisos por email (opcional)
PUBLIC_URL=http://localhost:3000 # base de los links de fotos; pública para publicar en redes
LLM_MODEL=claude-sonnet-5-5
WEB_ORIGIN=http://localhost:5173
META_ACCESS_TOKEN=
META_PAGE_ID=
META_IG_USER_ID=
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_AUTHOR_URN=
TIKTOK_ACCESS_TOKEN=
```

## Dependencias de la API

```
npm i @nestjs/typeorm typeorm pg @nestjs/config @nestjs/axios axios rxjs @nestjs/schedule \
      class-validator class-transformer @anthropic-ai/sdk
npm i -D @types/geojson
```

## Base de datos y migraciones

- **Desarrollo:** `DB_SYNC=true` (así está en `docker-compose.yml`). TypeORM ajusta las tablas a las entidades al arrancar.
  Ojo: si cambia el *tipo* de una columna, TypeORM la borra y la vuelve a crear (se pierden los datos de esa columna).
- **Producción:** sin `DB_SYNC`. Al arrancar, la API aplica sola las migraciones pendientes de `apps/api/src/migrations`.

Comandos (desde la raíz, con la base levantada):

```bash
# Después de cambiar una entidad: genera la migración con la diferencia contra la base
npm run migration:generate -w apps/api -- src/migrations/NombreDelCambio
npm run migration:run -w apps/api       # aplica las pendientes
npm run migration:revert -w apps/api    # deshace la última

# Base que ya existía creada con DB_SYNC (ej. la de desarrollo): marca la migración inicial
# como aplicada sin ejecutarla, antes de pasar a DB_SYNC=false
npm run migration:baseline -w apps/api
```

Las fechas se guardan como `timestamptz`: la base trabaja en UTC y la API/web muestran hora argentina.

## Tests

```bash
docker compose up -d db   # los tests usan la misma base de Docker, en otra base: crm_test
npm test                  # desde la raíz (o npm test -w apps/api)
```

- `apps/api/src/**/*.spec.ts`: funciones sueltas (teléfonos, cifrado de tokens, chequeo de producción).
- `apps/api/test/*.e2e-spec.ts`: la API completa contra `crm_test`, que se crea sola y se vacía antes de cada test.
  Cubren login, tokens y permisos; leads (reparto, asignación, puntaje, matching); visitas; propiedades (precios en
  dos monedas, búsqueda por cercanía) y tasación; fotos (procesamiento, limpieza, adjuntos privados); avisos y emails;
  Google Calendar; y el asistente de WhatsApp completo (herramientas, audios, fotos, mensajes seguidos, ventana de
  24 h, plantilla, mensajes del asesor).
- Los servicios externos se reemplazan por dobles: Claude, WhatsApp y Whisper (`test/fakes.ts`), Google (se intercepta
  `fetch`), SMTP, DolarApi y el tasador (un servidor HTTP falso). No se gasta nada ni sale nada a internet.
- Con `NODE_ENV=test` la API **no lee el `.env`**: los tests nunca usan las claves reales (no mandan WhatsApp ni
  emails). Solo corren contra una base cuyo nombre termine en `_test` (`TEST_DATABASE_URL` para cambiarla).

Correrlos antes de cada deploy: si algo falla, no subir.

## Ficha PDF de la propiedad

**Propiedades → Ficha** arma un PDF A4 para mandar por WhatsApp o imprimir: portada con la foto principal, precio en
USD (opcional la referencia en pesos), datos en recuadros, comodidades y descripción, y una segunda hoja con hasta 6
fotos más. Lleva la marca de la inmobiliaria (logo, nombre, color y contacto, los mismos de los reels). Por defecto
muestra solo barrio y ciudad; la dirección exacta es opcional. `POST /properties/:id/sheet` (pdfkit, en el servidor).
Desde el chat de un lead, **📄 Mandar ficha de una propiedad** se la manda por WhatsApp como documento (primero
aparecen las propiedades sugeridas para ese cliente). Rige la ventana de 24 h, como cualquier mensaje.

## Alquileres

Pestaña **Alquileres**: contratos con inquilino, propietario, plazo, moneda (pesos o dólares), día de pago, depósito y
comisión de administración. Desde el DNU 70/2023 el índice y la periodicidad se pactan libremente, así que cada contrato
elige: **ICL** (BCRA), **IPC** (INDEC), **porcentaje fijo** o **sin índice** (monto a mano), cada 1 a 12 meses.

- **Índices automáticos**: todos los días a las 8:30 se descargan el ICL (API del BCRA, variable 40, diario) y el IPC
  (API de series de datos.gob.ar, `148.3_INIVELNAL_DICI_M_26`). Si una API falla, se reintenta al día siguiente.
  La serie pública del IPC llega con atraso y a veces con meses vacíos: un admin puede cargar el valor a mano (no lo pisa
  la descarga automática).
- **Cálculo**: ICL = valor del día del ajuste / valor del día del ajuste anterior (método del BCRA). IPC = variación de
  los últimos N meses publicados antes del ajuste (acepta hasta un mes de atraso). El monto se puede corregir antes de
  aplicarlo, queda el historial con los valores usados y el último ajuste se puede deshacer.
- **Pagos** mes por mes (parciales también); la deuda cuenta los meses vencidos. Al cargar un contrato que ya venía de
  antes, se puede marcar hasta qué mes está pago.
- **Avisos** (campana y email a los admins): ajuste a aplicar (7 días antes; se puede aplicar desde 30 días antes),
  contrato por vencer (60 días) y alquiler impago (se cierra solo al pagar).
- Una propiedad con contratos no se puede borrar (primero se borra el contrato; solo admin).

## Cargar en portales (Zonaprop, Argenprop, MercadoLibre)

Zonaprop y Argenprop no tienen API pública (la habilitan a pedido, con convenio), así que por ahora la carga es manual
pero rápida: **Propiedades → Portales** muestra el título (≤ 60 caracteres, el límite de MercadoLibre) y la descripción
en texto plano (sin emojis, teléfonos ni links), los datos en el orden de los formularios con un botón para copiar cada
uno (en los numéricos copia solo el número) y descarga las fotos en un ZIP numerado (`GET /properties/:id/photos.zip`;
01 = portada). Con Claude configurado, **✨ Mejorar título y descripción con IA** (`POST /social/ai/listing`).

## Fotos con IA (Cloudflare, gratis)

En cualquier foto subida al CRM, **✨ IA** abre el editor: **Amueblar** (amoblamiento virtual de un ambiente vacío),
**Mejorar luz y colores**, **Ordenar** u **Otra cosa** (con indicaciones). El resultado es una foto **nueva** (la original
no se toca) que se agrega al lado o la reemplaza, y lleva grabada la leyenda **"Imagen ilustrativa"**: el cliente tiene
que saber que no es el estado real del inmueble. Revisá siempre que la IA no haya cambiado ventanas, paredes ni medidas.

Usa Workers AI de Cloudflare (modelo FLUX.2 klein 4B). La cuenta gratis trae 10.000 "neuronas" por día, que alcanzan
para unas 50–60 fotos; se renuevan a las 21 h (hora argentina). Para activarlo:

1. Crear una cuenta en https://dash.cloudflare.com (plan Free).
2. **Account ID**: en el panel, menú de la cuenta → *Account home*, columna derecha (o en la URL, después de `dash.cloudflare.com/`).
3. **Token**: *Manage account → Account API tokens → Create token* → plantilla **Workers AI** (permiso *Workers AI: Read/Edit*).
4. En Render → crm-api → *Environment*: `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_AI_TOKEN`.

`IMAGE_AI_MODEL` permite cambiar de modelo (p. ej. `@cf/black-forest-labs/flux-2-klein-9b`, mejor pero gasta ~10 veces más cupo).

## Tasación por comparables

En **Propiedades**, el botón **Tasar** (arriba, para algo que no está cargado) o **Tasar** en cada fila. Busca
propiedades parecidas del CRM (mismo tipo y operación, superficie parecida, publicadas en los últimos 24 meses) a
menos de 1 km si la propiedad tiene ubicación (o en el mismo barrio), y amplía la búsqueda si hay pocas. Muestra el
valor estimado (mediana del USD/m² × m²), un rango, la confianza y las comparables usadas; descarta precios fuera de
lo normal. Con menos de 3 comparables no estima. Mejora a medida que se cargan propiedades (con ubicación).
Endpoint: `POST /avo/comparables`. El modelo de tasación en Python (`/avo/appraise`) sigue disponible para cuando
haya datos para entrenarlo.

## Redes sociales (Facebook, Instagram y TikTok)

Pestaña **Redes**: crear, editar, borrar, publicar ya o programar publicaciones, con texto, hashtags y **hasta 10
fotos** (con más de una, carrusel) **o un video** (MP4 o MOV, hasta 50 MB). Un video sale como **Reel** en Instagram,
como video en Facebook y en **TikTok**. Desde **Propiedades → Publicar** arranca con el texto, los hashtags y las
fotos de la propiedad. Si una falla, queda con el motivo para corregir y reintentar. Las programadas se publican
solas (el programador corre cada minuto). Un video puede tardar minutos en procesarse: queda "publicando" y la
pantalla se actualiza sola. LinkedIn todavía no.

**Con IA (Claude):** en el formulario, **✨ Escribir con IA** arma el texto y los hashtags con los datos de la
propiedad, y **Reescribir** mejora el texto que ya está (con un tono y con indicaciones como "más corto"). En el armador
de reels escribe la portada y el texto de cada foto. Hay **Deshacer**. Necesita `ANTHROPIC_API_KEY`; sin ella los
botones aparecen deshabilitados. `CONTENT_LLM_MODEL` permite usar un modelo más barato solo para esto.

### Facebook e Instagram

**Configuración (una vez):**
1. Una **página de Facebook** y una **cuenta de Instagram profesional** (de empresa o creador) **vinculada a esa
   página** (desde Instagram: Configuración → Tipo de cuenta y herramientas; y en Meta Business Suite, vincular
   la cuenta a la página).
2. En **business.facebook.com → Configuración → Usuarios del sistema**, al usuario `crm` (el del token de WhatsApp)
   **asignale la página y la cuenta de Instagram** con control total.
3. **Generar token** para ese usuario: tu app, vencimiento **Nunca**, permisos `pages_show_list`,
   `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` y
   `business_management`.
4. En la API: `META_ACCESS_TOKEN` = ese token y `META_PAGE_ID` = el ID de la página (en la página: Información →
   Transparencia de la página, o en Meta Business → Cuentas → Páginas). El CRM pide solo el token de la página y
   encuentra la cuenta de Instagram vinculada (o se puede fijar con `META_IG_USER_ID`).

Las fotos tienen que tener un link público `https://` (las que sube el CRM a Supabase Storage o R2 ya lo tienen) y,
para Instagram, ser JPG (las que sube el CRM ya se convierten). Versión de la API de Meta: `META_GRAPH_VERSION`
(por defecto `v25.0`, la usan también WhatsApp).

### TikTok

TikTok solo acepta video. **Mientras TikTok no audite la app, solo deja publicar en cuentas privadas** (si la cuenta
es pública, la publicación falla con ese motivo). Para publicar en la cuenta pública hay que pedir la auditoría en
TikTok for Developers. TikTok también limita a ~15 publicaciones por día por cuenta.

1. En **developers.tiktok.com → Manage apps → Connect an app**: crear la app (plataforma Web). Pide la web de la
   inmobiliaria y links a términos y política de privacidad.
2. Agregar los productos **Login Kit** y **Content Posting API** (con *Direct Post*), y los permisos
   `user.info.basic` y `video.publish`.
3. Términos y privacidad: `https://<WEB>/terminos` y `https://<WEB>/privacidad` (páginas públicas del CRM;
   el nombre y el email de contacto salen de `VITE_AGENCY_NAME` y `VITE_LEGAL_EMAIL` en crm-web).
4. En Login Kit, **Redirect URI**: `https://<API>/integrations/tiktok/callback`
   (p. ej. `https://crm-api-grv3.onrender.com/integrations/tiktok/callback`).
5. Mientras la app está en *sandbox*, agregar la cuenta de TikTok de la inmobiliaria como usuario de prueba.
6. En la API: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` y `TOKEN_ENCRYPTION_KEY` (la misma de Google, o una nueva:
   `openssl rand -base64 32`).
7. En el CRM, un administrador: **Redes → Conectar TikTok**. El permiso se renueva solo (dura un año; si se revoca,
   el CRM lo avisa para reconectar).

Al publicar en TikTok el CRM muestra la cuenta, pide elegir quién puede verlo (sin valor por defecto, como exige
TikTok) y si se permiten comentarios, dúos y stitch.

## Google Calendar (un calendario por asesor)

Cada asesor conecta su cuenta desde **Agenda → Conectar**. Desde ese momento, las visitas pendientes y confirmadas
de sus leads aparecen en su Google Calendar, con la dirección y el teléfono del cliente (las pendientes dicen
"Por confirmar"). Si la visita se reprograma, se actualiza; si se cancela o se borra, desaparece; si el lead pasa a
otro asesor, el evento se mueve a su calendario. Si Google falla, el CRM sigue funcionando y lo deja en el log.

Configuración (una sola vez):

1. En [Google Cloud Console](https://console.cloud.google.com/) creá un proyecto y habilitá **Google Calendar API**.
2. *APIs y servicios → Pantalla de consentimiento OAuth*: tipo **Externo** (o Interno si usan Google Workspace),
   con los permisos `openid`, `email` y `.../auth/calendar.events`. Mientras esté en modo prueba, agregá como
   *usuarios de prueba* los emails de los asesores.
3. *Credenciales → Crear ID de cliente OAuth → Aplicación web*. En **URI de redireccionamiento autorizados** poné
   `https://TU-API/integrations/google/callback` (en desarrollo: `http://localhost:3000/integrations/google/callback`).
4. Completá en `apps/api/.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `TOKEN_ENCRYPTION_KEY`
   (`openssl rand -base64 32`). `WEB_ORIGIN` tiene que ser la URL de la web: Google vuelve ahí después de conectar.

Los tokens de Google se guardan cifrados (AES-256-GCM). Si un asesor revoca el acceso desde su cuenta de Google,
el CRM lo detecta y le vuelve a mostrar "Conectar".

## Audios y fotos por WhatsApp

- **Audios:** se transcriben con Whisper (`OPENAI_API_KEY`) y el asistente responde a la transcripción. Sin clave
  o si falla, le pide al cliente que lo escriba. El asesor ve la transcripción en el chat y puede escuchar el original.
- **Fotos:** se achican a 1568 px, se les borra el GPS y Claude las ve (las 2 más recientes de la conversación).
- **Ubicaciones** se pasan como texto; **videos, documentos y stickers** reciben una respuesta pidiendo texto.
- Los archivos son datos personales: se guardan en `uploads/chat-media`, que **no** se publica (solo `uploads/photos`
  es público), se leen con sesión por `GET /chat-media/:id`, y se borran de noche si el lead se eliminó.

**Mensajes seguidos:** el asistente espera unos segundos antes de contestar (`WHATSAPP_REPLY_DELAY_MS`, 4000 por
defecto) por si el cliente sigue escribiendo; "Hola" / "busco depto" / "en Centro" reciben una sola respuesta. Si la
API se reinicia durante esa espera, al arrancar contesta lo que quedó pendiente (mensajes de los últimos 15 minutos).

## Avisos por email

Con SMTP configurado (`SMTP_*` en `.env`), cada aviso **nuevo** también llega por email al asesor del lead (o a los
admins si el lead no tiene asesor), con un botón que abre el lead en el CRM (`WEB_ORIGIN/?lead=<id>`). Si el cliente
sigue escribiendo, el aviso se actualiza sin mandar otro email hasta que el asesor lo lea. Cada usuario puede apagar
los emails desde la campana de avisos.

## Archivos en S3/R2 (producción)

En desarrollo los archivos van a disco (`STORAGE_DRIVER=local`). En producción conviene un almacenamiento en la nube,
porque en muchos hostings el disco del contenedor se borra en cada deploy. Con `STORAGE_DRIVER=s3`:

- **Fotos de propiedades** → `S3_PUBLIC_BUCKET`, con acceso público (las ven portales y redes) y caché de 1 año.
- **Audios y fotos de clientes** → `S3_PRIVATE_BUCKET`, **sin** acceso público; el CRM los sirve con sesión.
  Tienen que ser buckets distintos: en R2 el acceso público es de todo el bucket.

Con Cloudflare R2: creá los dos buckets; en el público activá *Public access* (dominio `r2.dev` o uno propio) y
usá esa URL como `S3_PUBLIC_URL`; creá un *API token* con permiso de lectura y escritura sobre los dos buckets
(`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`), `S3_ENDPOINT=https://<id-de-cuenta>.r2.cloudflarestorage.com` y
`S3_REGION=auto`. Si falta alguna variable, la API no arranca y dice cuál.

Para pasar archivos que ya están en disco (fotos subidas, adjuntos de chat) y actualizar sus URLs en la base:

```bash
npm run storage:to-s3 -w apps/api -- --dry-run   # muestra qué haría
npm run storage:to-s3 -w apps/api                # lo hace (se puede repetir sin problema)
# después: STORAGE_DRIVER=s3 y reiniciar la API
```

### El día que se configura R2 (checklist)

En el servidor, con `C="docker compose -f docker-compose.prod.yml --env-file deploy/.env"`:

1. Cargar las variables `S3_*` en `apps/api/.env.production`, **dejando `STORAGE_DRIVER=local`** por ahora, y
   recrear la API para que las tome: `$C up -d api`.
2. **Verificar la configuración** (sube un archivo de prueba a cada bucket, comprueba que el público se vea desde
   internet, y lo borra; no toca nada del CRM):
   ```bash
   $C exec api node dist/scripts/check-storage.js
   ```
   Si marca algo, dice qué revisar (clave mal copiada, nombre de bucket, acceso público sin activar, URL pública
   equivocada...). Corregir y repetir hasta que diga "Todo bien". En la máquina de desarrollo:
   `npm run storage:check -w apps/api`.
3. En Cloudflare, confirmar que el bucket **privado** tenga *Public access* desactivado (r2.dev apagado y sin dominio).
4. Pasar los archivos que ya estaban en disco: `$C exec api node dist/scripts/migrate-storage-to-s3.js --dry-run`,
   revisar lo que muestra, y repetir sin `--dry-run`.
5. Poner `STORAGE_DRIVER=s3` y `$C up -d api`.
6. **Probar desde el CRM (5 minutos):**
   - Subir una foto a una propiedad: se ve en el formulario y en el listado.
   - Abrir esa foto en una ventana de incógnito (sin sesión): tiene que verse (la usan portales y redes).
   - Una propiedad que ya tenía fotos (migradas en el paso 4): se siguen viendo.
   - Mandar al WhatsApp del CRM un audio y una foto: en el lead se escuchan / ven.

Si algo falla en el paso 6: volver a `STORAGE_DRIVER=local` y `$C up -d api`. Las fotos de propiedades subidas
mientras tanto se siguen viendo (su link apunta al bucket); los audios y fotos de clientes recibidos en ese rato
no se van a poder abrir hasta volver a `s3`.

## Deploy en Render + Supabase (plan gratis)

Para arrancar sin pagar (ninguno pide tarjeta): la API y la web en **Render**; la base y los archivos en **Supabase**
(Database + Storage). `render.yaml` (Blueprint) crea los dos servicios de Render ya configurados.

**Límites del plan gratis:** la API de Render se duerme a los 15 minutos sin uso (la primera carga tarda ~1 minuto y
un WhatsApp que llega con el servicio dormido se contesta un minuto tarde); Supabase se pausa tras 7 días sin
actividad y no hace backups; la base tiene 500 MB y el Storage 1 GB (unas 3.000 fotos, más audios y backups), con
5 GB por mes de descarga. El paso 6 (monitor) evita que se duerman. Para atender clientes
reales conviene pasar la API a Render **Starter** (en `render.yaml`: `plan: starter`).

### 1. Supabase (base de datos)

1. Crear un proyecto en la región **East US (North Virginia)**: la misma zona que la API en Render (la API hace
   muchas consultas por pedido; la cercanía entre las dos importa más que la cercanía con Argentina).
   Contraseña de la base: solo letras y números (va dentro de una URL). Guardarla.
2. **Database → Extensions** → activar **postgis** (en el esquema `extensions`). `uuid-ossp` ya viene activa.
3. **Seguridad — Project Settings → Data API → desactivar la Data API.** El CRM no la usa, y si queda activa las
   tablas del CRM serían accesibles con la clave pública del proyecto.
4. Botón **Connect** → **Session pooler** → copiar la URL (puerto 5432, usuario `postgres.<id>`) y reemplazar
   `[YOUR-PASSWORD]`. Esa es la `DATABASE_URL`. (La "Direct connection" no sirve: en el plan gratis es solo IPv6,
   y Render no la alcanza.)

### 2. Supabase Storage (fotos y audios)

1. **Storage → New bucket** dos veces:
   - `crm-fotos` con **Public bucket activado** (las fotos de propiedades las ven portales y redes).
   - `crm-privado` con Public bucket **desactivado** (audios y fotos de clientes, y los backups).
2. **Project Settings → Storage → S3 Connection** (o Storage → Settings): copiar el **Endpoint** (`S3_ENDPOINT`,
   termina en `/storage/v1/s3`) y la **Region** (`S3_REGION`; con East US es `us-east-1`). Ahí mismo,
   **New access key** da `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` (el secreto se ve una sola vez: guardarlo).
3. La URL pública de las fotos es `https://<id-del-proyecto>.supabase.co/storage/v1/object/public/crm-fotos`
   (`S3_PUBLIC_URL`, sin barra al final; el id es el de la dirección del proyecto).
4. **Verificar** desde tu máquina (Render gratis no tiene consola): crear `apps/api/.env.storage` (no se sube a git)
   con:
   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<id-del-proyecto>.supabase.co/storage/v1/s3
   S3_REGION=us-east-1
   S3_FORCE_PATH_STYLE=true
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_PUBLIC_BUCKET=crm-fotos
   S3_PUBLIC_URL=https://<id-del-proyecto>.supabase.co/storage/v1/object/public/crm-fotos
   S3_PRIVATE_BUCKET=crm-privado
   ```
   y correr:
   ```bash
   set -a; source apps/api/.env.storage; set +a; npm run storage:check -w apps/api
   ```
   Repetir hasta que diga "Todo bien".

Si más adelante se llena el GB gratis, se puede pasar a Cloudflare R2 (10 GB gratis, pide tarjeta): crear los buckets
ahí, copiar los archivos de un bucket al otro (por ejemplo con rclone) y cambiar las variables `S3_*` (con R2:
`S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`).

### 3. Render (API y web)

1. **New → Blueprint** → elegir el repositorio. Render lee `render.yaml` y pide los valores que faltan:
   - `DATABASE_URL`: la del paso 1.4.
   - `WEB_ORIGIN`: `https://crm-web.onrender.com` · `VITE_API_URL`: `https://crm-api.onrender.com`.
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` (mínimo 10 caracteres): el primer administrador.
   - Los `S3_*` del paso 2 (`S3_REGION` y `S3_FORCE_PATH_STYLE` ya vienen puestos para Supabase en East US).
   - Claude y WhatsApp se pueden dejar vacíos y cargar después (**crm-api → Environment**).
2. Si Render le pone otra dirección a algún servicio (porque el nombre estaba tomado, p. ej. `crm-api-x1y2`),
   corregir `WEB_ORIGIN` en crm-api y `VITE_API_URL` en crm-web con las direcciones reales, y en crm-web hacer
   **Manual Deploy** (la dirección de la API queda fija al construir la web).
3. Revisar el primer deploy en **crm-api → Logs**: tiene que decir `Nest application successfully started`, y
   `https://crm-api.onrender.com/health` tiene que responder `{"status":"ok"}`. Errores comunes:
   - `Configuración inválida para producción`: el mensaje dice qué variable corregir.
   - `ENETUNREACH` o similar al conectar a la base: se usó la "Direct connection" en vez del Session pooler.
   - `type "geography" does not exist`: falta activar PostGIS (paso 1.2).
   - `Max client connections reached`: bajar `DATABASE_POOL_MAX`.
4. Entrar a la web con el administrador y probar los archivos: subir una foto a una propiedad y abrirla en una
   ventana de incógnito (tiene que verse); mandar un audio y una foto al WhatsApp del CRM y verlos en el lead.
5. **Límite de intentos de login:** desde el celular con datos móviles (no el wifi), poner 5 veces una contraseña
   mala; después, desde la compu, entrar normal. Si la compu también quedó bloqueada, el CRM no está viendo la IP
   real de cada uno: hay que ajustar `TRUST_PROXY` (en Render son 3 intermediarios: Cloudflare, el balanceador y un
   proxy interno).

### 4. WhatsApp y Claude

En **crm-api → Environment** cargar las `WHATSAPP_*` y, si se quiere el asistente automático, `ANTHROPIC_API_KEY`.
**Sin `ANTHROPIC_API_KEY` el asistente queda apagado:** los mensajes llegan al CRM, se crea el lead y el asesor
recibe el aviso "Fulano te escribió"; al cliente no se le contesta nada automático (ni las respuestas fijas) hasta
que responda una persona desde el CRM. Al cargar la clave, el asistente empieza a contestar solo. En Meta, el webhook es
`https://crm-api.onrender.com/webhooks/whatsapp` y el *verify token* es el valor de `WHATSAPP_VERIFY_TOKEN` que
generó Render (se ve en Environment).

### 5. Backups diarios (GitHub Actions)

Supabase gratis no hace backups. `.github/workflows/backup-db.yml` hace uno por día (04:00, hora argentina) en
`crm-privado/backups/` (Supabase Storage) y guarda 30 días.

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**, uno por cada uno:
   `BACKUP_DATABASE_URL` (la misma `DATABASE_URL`), `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
   Van en la pestaña **Secrets** (no Variables) como **Repository secrets**. El bucket es `CRM-privado` salvo que se
   cargue otro en `S3_PRIVATE_BUCKET`.
2. **Actions → Backup de la base → Run workflow** para probarlo, y confirmar en Supabase (Storage → crm-privado →
   backups) que apareció el archivo.
   Si alguna vez falla, GitHub te avisa por email.

**Restaurar** (reemplaza todos los datos): en Render, **Suspend** crm-api; bajar el `.dump` desde Supabase Storage;
y correr
```bash
deploy/restore-backup.sh crm-AAAAMMDD-HHMM.dump "<DATABASE_URL>" --si-borrar-todo
```
Después, **Resume** crm-api.

### 6. Que no se duerma (y avise si se cae)

En [UptimeRobot](https://uptimerobot.com) (gratis): monitor HTTP a `https://crm-api.onrender.com/health` cada 5
minutos. Mantiene la API despierta (las 750 horas gratis del mes alcanzan para tenerla prendida siempre), hace que
Supabase vea actividad, y te manda un email si el CRM deja de responder.

## Producción en un servidor propio (VPS)

Un servidor (VPS) con Docker alcanza: 2 GB de RAM para empezar. `docker-compose.prod.yml` levanta todo con HTTPS
automático (Caddy pide y renueva los certificados de Let's Encrypt), la base sin acceso desde internet, reinicio
automático y backups diarios.

1. **Dominios:** dos registros A apuntando a la IP del servidor, p. ej. `crm.tu-inmobiliaria.com.ar` (la web) y
   `api.crm.tu-inmobiliaria.com.ar` (la API). Abrir los puertos 80 y 443.
2. **Configuración:**
   ```bash
   cp deploy/.env.example deploy/.env                     # dominios, email, contraseña de la base
   cp apps/api/.env.example apps/api/.env.production      # claves de la API
   ```
   En `apps/api/.env.production`: borrar `DB_SYNC`, poner `JWT_SECRET` (`openssl rand -base64 48`),
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` del primer administrador y las claves de las integraciones que se usen.
   No hace falta poner `DATABASE_URL`, `PUBLIC_URL` ni `WEB_ORIGIN`: el compose los arma con los dominios.
3. **Levantar:**
   ```bash
   docker compose -f docker-compose.prod.yml --env-file deploy/.env up -d --build
   ```
   Al arrancar, la API aplica las migraciones pendientes. Con `NODE_ENV=production` se niega a arrancar si la
   configuración es de desarrollo (`DB_SYNC`, el `JWT_SECRET` de ejemplo, URLs sin https...) y dice qué corregir:
   `docker compose -f docker-compose.prod.yml logs api`.
4. **Después:** en Meta (WhatsApp), el webhook es `https://<API_DOMAIN>/webhooks/whatsapp`; en Google Cloud, la
   redirección es `https://<API_DOMAIN>/integrations/google/callback`.

Las integraciones son opcionales: si falta la clave de una (Claude, WhatsApp, redes), la API arranca igual y esa
función responde "Falta configurar ... en el .env de la API".

**Actualizar a una versión nueva:** copiar el código nuevo y repetir el `up -d --build`. Antes conviene un backup a
mano (abajo).

**Monitoreo:** `https://<API_DOMAIN>/health` responde `{"status":"ok"}` si la API y la base andan. Sirve para un
monitor gratuito tipo UptimeRobot que avise si se cae.

### Backups

El servicio `backup` hace un `pg_dump` al arrancar y después cada 24 h en `./backups` (guarda 14 días,
`BACKUP_KEEP_DAYS`). **Esa carpeta está en el mismo servidor:** si se pierde el servidor se pierden los backups.
Copiarla seguido a otro lado (otra máquina, Google Drive, un bucket de R2 con `rclone sync ./backups r2:backups`).

Las fotos no están en la base: con `STORAGE_DRIVER=s3` quedan en R2/S3; con `local`, en el volumen `uploads`.

```bash
# Backup a mano ahora
docker compose -f docker-compose.prod.yml --env-file deploy/.env restart backup

# Restaurar (reemplaza TODOS los datos actuales por los del backup)
docker compose -f docker-compose.prod.yml --env-file deploy/.env stop api
docker compose -f docker-compose.prod.yml --env-file deploy/.env exec -T db \
  pg_restore -U crm -d crm --clean --if-exists --no-owner < backups/crm-AAAAMMDD-HHMM.dump
docker compose -f docker-compose.prod.yml --env-file deploy/.env start api
```

### Seguridad incluida

- HTTPS obligatorio (http redirige a https) y HSTS.
- La web manda una política de contenido (CSP) que solo le permite hablar con la API; la API manda cabeceras de
  seguridad (helmet) y CORS solo para `WEB_ORIGIN`.
- Los contenedores no corren como root; la base y el servicio de tasación no están expuestos a internet.
- Dependencias con versión exacta (`package-lock.json`, `requirements.txt`): un build no trae versiones nuevas sin aviso.
