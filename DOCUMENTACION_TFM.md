# Documentación técnica: Gestor de Carteras de Fondos Indexados

Este documento describe la arquitectura, el modelo de datos, la interfaz de programación (API REST) y el algoritmo de rebalanceo del sistema. Está redactado para su incorporación a la memoria del Trabajo Fin de Máster. Para la instalación y el uso de la aplicación, consúltese el [`README.md`](./README.md).

**Índice**

1. [Arquitectura del sistema](#1-arquitectura-del-sistema)
2. [Esquema de base de datos](#2-esquema-de-base-de-datos)
3. [Especificación de la API REST](#3-especificación-de-la-api-rest)
4. [Algoritmo de rebalanceo](#4-algoritmo-de-rebalanceo)
5. [Limitaciones y trabajo futuro](#5-limitaciones-y-trabajo-futuro)

Anexo A. [Guía de despliegue en la nube](#anexo-a-guía-de-despliegue-en-la-nube)

---

## 1. Arquitectura del sistema

### 1.1 Visión general

El sistema sigue una arquitectura **cliente-servidor de tres capas**, con una separación estricta entre presentación, lógica de negocio y persistencia:

1. **Capa de presentación.** Una aplicación de página única (*Single Page Application*, SPA) desarrollada con React y Vite. Se ejecuta íntegramente en el navegador, gestiona la navegación en el cliente y consume la API mediante peticiones HTTP con cuerpo JSON.
2. **Capa de aplicación.** Un servidor Node.js basado en Fastify que expone una API REST sin estado. Valida los datos de entrada, autentica a los usuarios mediante tokens JWT, aplica las reglas de negocio y accede a la base de datos a través del ORM Prisma.
3. **Capa de persistencia.** Una base de datos relacional PostgreSQL que garantiza la integridad de los datos mediante claves, restricciones de unicidad y tipos numéricos de precisión exacta.

Además, el servidor consulta un **proveedor externo de cotizaciones** (la API pública de Yahoo Finance) para mantener actualizados los valores liquidativos de los ETF del catálogo. Esta dependencia externa está aislada en un servicio propio con una estrategia de caché y recuperación ante fallos (sección 1.6), de modo que su indisponibilidad nunca afecta al funcionamiento de la aplicación.

El código fuente se organiza como un **monorepo** con dos proyectos independientes (`backend/` y `frontend/`) que comparten únicamente el contrato de la API, definido en la sección 3.

### 1.2 Diagrama de arquitectura

```mermaid
flowchart LR
    subgraph Cliente["Cliente · navegador"]
        SPA["SPA React + Vite<br/>React Router · Shadcn UI · Recharts"]
        LS[("localStorage<br/>token JWT")]
        SPA --- LS
    end

    subgraph Servidor["Servidor · Node.js"]
        API["API REST Fastify<br/>prefijo /api"]
        JWT["Plugin de autenticación<br/>verificación del JWT"]
        MOD["Módulos de dominio<br/>auth · funds · transactions · portfolio"]
        SVC["Servicios de negocio<br/>valoración de cartera · rebalanceo"]
        MD["Servicio de datos de mercado<br/>caché TTL · timeout · fallback"]
        MAIL["Servicio de correo<br/>Nodemailer · SMTP"]
        ORM["Prisma ORM"]
        API --> JWT --> MOD --> SVC --> ORM
        MOD --> MD --> ORM
        MOD --> MAIL
    end

    DB[("PostgreSQL<br/>User · Fund · Transaction · TargetAllocation")]
    YF["Yahoo Finance<br/>API pública de cotizaciones"]
    SMTP["Servidor SMTP<br/>Brevo en producción"]

    SPA -- "HTTP/JSON<br/>Authorization: Bearer JWT" --> API
    ORM -- "SQL" --> DB
    MD -. "HTTPS · timeout 3 s" .-> YF
    MAIL -. "SMTP" .-> SMTP
```

### 1.3 Responsabilidades por componente

| Componente | Tecnología | Responsabilidad |
|---|---|---|
| **SPA** | React 19, Vite, TypeScript | Interfaz de usuario, enrutado, formularios, gráficos y estado de sesión. Calcula en el cliente la vista previa del rebalanceo para responder de forma instantánea a cambios no guardados. |
| **Estilos y componentes** | Tailwind CSS 4, Shadcn UI | Sistema de diseño accesible y consistente (botones, tablas, diálogos, selectores). |
| **API REST** | Fastify 5 | Enrutado, serialización JSON, gestión de errores y ciclo de vida de la petición. |
| **Validación** | Zod 4 | Validación y normalización de todas las entradas antes de llegar a la lógica de negocio. |
| **Autenticación** | `@fastify/jwt`, `bcryptjs` | Emisión y verificación de JWT; cifrado de contraseñas; tokens de recuperación de contraseña. |
| **Correo** | Nodemailer, SMTP (Brevo) | Envío del enlace de recuperación de contraseña. Sin SMTP configurado, usa una cuenta de pruebas de Ethereal (solo desarrollo). |
| **Servicios** | TypeScript | Reglas de negocio: coste medio, valoración de la cartera y cálculo de rebalanceo. |
| **Datos de mercado** | `fetch` nativo, API de Yahoo Finance | Descarga de cotizaciones, actualización del valor liquidativo (`currentNAV`) y de la fecha de actualización de cada fondo, con caché y recuperación ante fallos. |
| **Acceso a datos** | Prisma 7 | Modelo tipado, consultas, transacciones de base de datos y migraciones. |
| **Base de datos** | PostgreSQL 17 | Almacenamiento persistente con integridad referencial. |

### 1.4 Flujo de una petición: consulta de rebalanceo

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant S as SPA (React)
    participant A as API (Fastify)
    participant D as PostgreSQL

    U->>S: Introduce la aportación
    S->>A: GET /api/portfolio/rebalance?newContribution=1000<br/>Authorization: Bearer JWT
    A->>A: Verifica el JWT y obtiene el id de usuario
    A->>A: Valida la consulta con Zod
    A->>D: SELECT transacciones y objetivos del usuario
    D-->>A: Filas
    A->>A: Reproduce el historial (coste medio) y valora la cartera
    A->>A: Calcula la aportación sugerida por fondo
    A-->>S: 200 OK · JSON con la tabla de rebalanceo
    S-->>U: Muestra la tabla comparativa
```

### 1.5 Decisiones de diseño relevantes

- **Autenticación sin estado (JWT).** El servidor no almacena sesiones: cada petición lleva un token firmado (HS256) con el identificador y el email del usuario, y caducidad configurable (7 días por defecto). Esto simplifica el escalado horizontal. Las contraseñas se almacenan con **bcrypt** (coste 12) y la API responde igual ante un usuario inexistente y ante una contraseña incorrecta, para no revelar qué emails están registrados. El registro es la excepción: ante un email ya existente responde `409` con un mensaje explícito, lo que permite comprobar si una dirección tiene cuenta. Es un compromiso habitual a favor de la usabilidad (el usuario sabe que debe iniciar sesión o recuperar la contraseña); eliminarlo exigiría confirmar el alta por correo y responder siempre lo mismo. La contraseña se limita a 72 **bytes** en UTF-8, no a 72 caracteres, porque bcrypt ignora lo que excede de ese tamaño: con tildes, eñes o el símbolo €, que ocupan 2 o 3 bytes, una contraseña de 72 caracteres se truncaría sin aviso.
- **Recuperación de contraseña.** El servidor genera un token aleatorio de 32 bytes, lo envía por correo dentro de un enlace al frontend y guarda en la base de datos **solo su hash SHA-256**, con caducidad a los 15 minutos. El token es de un solo uso: se borra al restablecer la contraseña. La solicitud responde siempre igual exista o no el email, y el envío no se espera (`await`) para que el tiempo de respuesta tampoco delate si la cuenta existe.
- **CORS.** Si `FRONTEND_URL` está definida, la API solo acepta peticiones de ese origen; sin ella (desarrollo o demos) acepta cualquiera.
- **Aritmética decimal exacta.** Los importes, precios y participaciones se almacenan como `NUMERIC` en PostgreSQL y se procesan en el servidor con la clase `Decimal` de Prisma (basada en `decimal.js`). Se evita así el error de representación de la coma flotante binaria. El redondeo se realiza únicamente al serializar la respuesta.
- **Validación en el borde.** Cada ruta valida su entrada con un esquema Zod antes de ejecutar lógica alguna. Los errores de validación se devuelven con un formato uniforme (sección 3.1).
- **Integridad ante concurrencia.** Al registrar una venta, el servidor bloquea la fila del usuario (`SELECT … FOR UPDATE`) dentro de una transacción de base de datos y reproduce el historial del fondo afectado. Esto impide que dos peticiones simultáneas vendan las mismas participaciones y que una operación con fecha pasada deje el historial incoherente.
- **Modularidad.** Cada dominio (`auth`, `funds`, `transactions`, `portfolio`) agrupa sus rutas, esquemas de validación y tipos de datos. Los cálculos de negocio residen en funciones puras (`portfolio.calc`, `rebalance.service`), lo que permite probarlos sin base de datos.
- **Cálculo del rebalanceo en dos lugares.** El servidor expone el cálculo por API (fuente de verdad documentada en esta memoria) y el cliente incorpora una implementación equivalente para ofrecer una vista previa inmediata mientras el usuario edita objetivos sin guardar. Las compras que se ejecutan al confirmar un rebalanceo las calcula el cliente: reparte la aportación en céntimos enteros para que sumen exactamente lo aportado (sección 4.8), mientras que la API redondea cada importe por separado. Por eso pueden diferir en algún céntimo de lo que devuelve `GET /api/portfolio/rebalance`. Ambas implementaciones están cubiertas por pruebas.
- **Precio de las operaciones.** La API acepta el `pricePerShare` que recibe y no lo contrasta con el valor liquidativo del fondo; es la SPA la que lo fija al valor liquidativo actual. Es una decisión deliberada: el contrato de la API ya admite el precio real de cada operación, de modo que la mejora descrita en la sección 5 solo requiere cambios en el cliente.
- **Pruebas.** Se emplea Vitest en ambos proyectos. El backend se prueba con una base de datos simulada en memoria y el frontend con React Testing Library, simulando las respuestas de la API; ninguna prueba requiere servicios externos.

### 1.6 Integración de datos de mercado

El valor liquidativo (`currentNAV`) de los ETF con cotización en bolsa se mantiene actualizado consultando la API pública de gráficos de **Yahoo Finance** (`/v8/finance/chart/{ticker}`) mediante peticiones HTTPS directas, sin dependencias adicionales. Cada fondo del catálogo lleva un **ticker** (por ejemplo, `EUNL.DE` para el iShares Core MSCI World en la bolsa de Fráncfort), y **el catálogo solo ofrece fondos que cotizan**: la API no lista los registros sin ticker y rechaza registrar compras sobre ellos. Esto garantiza que el valor de toda la cartera nueva procede de cotizaciones reales y no de datos introducidos a mano.

Al tratarse de un servicio de terceros, no oficial, sin garantías de disponibilidad ni de cuota, la integración se diseñó para que **ningún fallo del proveedor pueda afectar a la aplicación**. El diagrama siguiente resume el comportamiento:

```mermaid
sequenceDiagram
    autonumber
    participant S as SPA
    participant A as API (Fastify)
    participant M as Servicio de datos de mercado
    participant Y as Yahoo Finance
    participant D as PostgreSQL

    S->>A: GET /api/funds (o /api/portfolio)
    A->>M: refreshIfStale()
    M->>D: Lee los fondos y la fecha de su último precio
    alt Precio vigente, o fondo en periodo de espera
        M-->>A: No se consulta el proveedor
    else Precio caducado
        M->>Y: GET /v8/finance/chart/{ticker} · timeout de 3 s
        alt Respuesta válida, en euros
            Y-->>M: Precio actual
            M->>D: UPDATE currentNAV y lastPriceUpdate
        else Error de red, timeout, cuota superada o respuesta no válida
            Y--xM: Fallo
            M->>M: Captura el error y aplica el periodo de espera
            Note over M,D: La base de datos no se modifica
        end
    end
    A->>D: Lee fondos o cartera (última cotización guardada)
    A-->>S: 200 OK
```

**Estrategia de caché y recuperación:**

| Mecanismo | Descripción | Valor por defecto |
|---|---|---|
| **Caché con vigencia (TTL)** | Un precio se considera vigente durante un tiempo desde su última actualización (`lastPriceUpdate`); mientras tanto no se consulta al proveedor, aunque se pida el catálogo continuamente. Al guardarse en la base de datos, la caché sobrevive a los reinicios del servidor. | 15 minutos |
| **Timeout** | Cada consulta se cancela si el proveedor no responde a tiempo. | 3 segundos |
| **Recuperación (*fallback*)** | Cualquier fallo (red, timeout, cuota, respuesta no válida, error de escritura) se captura sin propagarse; la base de datos no se modifica y las consultas siguen devolviendo la última cotización guardada. | Siempre activa |
| **Periodo de espera tras fallo** | Un fondo cuya consulta falló no se reintenta durante un tiempo, para no añadir latencia a cada petición cuando el proveedor está caído. La actualización manual lo ignora. | 5 minutos |
| **Paralelismo acotado** | Las consultas de un mismo ciclo se lanzan en paralelo, por lo que el retraso máximo de una petición es el del timeout, no la suma de todos los fondos. | 12 simultáneas |
| **Una sola ronda** | Las peticiones simultáneas comparten la misma ronda de consultas en lugar de duplicarlas. | — |

**Validación de la respuesta.** Solo se acepta un precio numérico, finito y mayor que cero, expresado en **euros**: una cotización en otra divisa produciría un valor liquidativo erróneo, por lo que se descarta. El precio se redondea a 4 decimales, la precisión del campo `NUMERIC(12,4)`.

**Puntos de activación.** El refresco automático (solo de los precios caducados) se ejecuta al solicitar el catálogo (`GET /api/funds`), la cartera (`GET /api/portfolio`) y el rebalanceo (`GET /api/portfolio/rebalance`). Además, el endpoint `POST /api/funds/sync-prices` fuerza la actualización de todo el catálogo, ignorando la vigencia y el periodo de espera. Como el catálogo es común a todos los usuarios, los precios se comparten entre ellos.

**Configuración.** Mediante variables de entorno: `MARKET_DATA_ENABLED` (activa o desactiva la integración), `MARKET_DATA_TTL_MINUTES` y `MARKET_DATA_TIMEOUT_MS`.

---

## 2. Esquema de base de datos

### 2.1 Diagrama entidad-relación

```mermaid
erDiagram
    User ||--o{ Transaction : "realiza"
    Fund ||--o{ Transaction : "es objeto de"
    User ||--o{ TargetAllocation : "define"
    Fund ||--o{ TargetAllocation : "es objetivo en"

    User {
        uuid id PK
        string email UK "único, en minúsculas"
        string passwordHash "bcrypt, coste 12"
        datetime createdAt "por defecto: now()"
        string resetPasswordToken UK "opcional, hash SHA-256 del token de recuperación"
        datetime resetPasswordExpires "opcional, caducidad del token"
    }

    Fund {
        uuid id PK
        string isin UK "código ISIN"
        string name
        string category "Renta Variable o Renta Fija"
        decimal currentNAV "NUMERIC(12,4)"
        string ticker UK "opcional, símbolo en Yahoo Finance"
        datetime lastPriceUpdate "opcional, última sincronización de mercado"
    }

    Transaction {
        uuid id PK
        uuid userId FK "User.id, borrado en cascada"
        uuid fundId FK "Fund.id"
        enum type "BUY o SELL"
        decimal shares "NUMERIC(12,4)"
        decimal pricePerShare "NUMERIC(12,4)"
        datetime transactionDate
    }

    TargetAllocation {
        uuid userId PK, FK "User.id, borrado en cascada"
        uuid fundId PK, FK "Fund.id"
        decimal targetPercentage "NUMERIC(5,2)"
    }
```

### 2.2 Descripción de las entidades

**`User`**: usuario registrado en el sistema.

| Campo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | UUID | Clave primaria | Identificador generado automáticamente. |
| `email` | Texto | Único | Correo electrónico, normalizado a minúsculas. |
| `passwordHash` | Texto | — | Contraseña cifrada con bcrypt. |
| `createdAt` | Fecha y hora | Por defecto `now()` | Fecha de alta. |
| `resetPasswordToken` | Texto | Único; admite nulo | Hash SHA-256 del token de recuperación enviado por correo. Nunca se guarda el token en claro. Nulo si no hay una recuperación en curso. |
| `resetPasswordExpires` | Fecha y hora | Admite nulo | Instante en que caduca el token (15 minutos tras la solicitud). |

**`Fund`**: fondo indexado del catálogo.

| Campo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | UUID | Clave primaria | Identificador. |
| `isin` | Texto | Único | Código ISIN internacional del fondo. |
| `name` | Texto | — | Denominación del fondo. |
| `category` | Texto | — | Categoría de activo (por ejemplo, *Renta Variable*, *Renta Fija*). |
| `currentNAV` | `NUMERIC(12,4)` | — | Valor liquidativo (*Net Asset Value*) actual por participación, en euros. En los fondos con ticker se actualiza con datos de mercado (sección 1.6). |
| `ticker` | Texto | Único; admite nulo | Símbolo de cotización en Yahoo Finance (por ejemplo, `EUNL.DE`). Todos los fondos del catálogo lo tienen; el campo admite nulo únicamente para no invalidar registros heredados de versiones anteriores, que la API no muestra ni permite comprar. |
| `lastPriceUpdate` | Fecha y hora | Opcional | Última vez que `currentNAV` se actualizó con datos de mercado. Nulo si nunca se ha sincronizado. |

**`Transaction`**: operación de compra o venta de participaciones.

| Campo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `id` | UUID | Clave primaria | Identificador. |
| `userId` | UUID | Clave foránea → `User`; borrado en cascada | Propietario de la operación. |
| `fundId` | UUID | Clave foránea → `Fund` | Fondo operado. |
| `type` | Enumerado | `BUY` o `SELL` | Tipo de operación. |
| `shares` | `NUMERIC(12,4)` | — | Número de participaciones (hasta 4 decimales). |
| `pricePerShare` | `NUMERIC(12,4)` | — | Precio por participación en la operación. |
| `transactionDate` | Fecha y hora | — | Fecha efectiva de la operación. |

Índices: `(userId, transactionDate)`, para recuperar el historial ordenado de un usuario, y `(fundId)`.

**`TargetAllocation`**: porcentaje objetivo de un fondo en la cartera de un usuario.

| Campo | Tipo | Restricciones | Descripción |
|---|---|---|---|
| `userId` | UUID | Clave primaria compuesta; clave foránea → `User`; borrado en cascada | Usuario. |
| `fundId` | UUID | Clave primaria compuesta; clave foránea → `Fund` | Fondo. |
| `targetPercentage` | `NUMERIC(5,2)` | — | Porcentaje objetivo (0-100, dos decimales). |

### 2.3 Cardinalidades y reglas de integridad

- Un **usuario** puede tener muchas **transacciones** y muchos **objetivos**; cada transacción y cada objetivo pertenecen a un único usuario (relaciones 1:N).
- Un **fondo** puede aparecer en muchas transacciones y en muchos objetivos de distintos usuarios (relaciones 1:N).
- `User` y `Fund` mantienen entre sí una **relación N:M** a través de `TargetAllocation`, cuya clave primaria compuesta `(userId, fundId)` garantiza que un usuario defina **como máximo un objetivo por fondo**.
- El borrado de un usuario elimina en cascada sus transacciones y objetivos. Un fondo referenciado por alguna transacción o por algún objetivo no puede eliminarse (`ON DELETE RESTRICT`), lo que evita dejar el historial huérfano.
- La suma de los porcentajes objetivo de un usuario debe ser exactamente 100: esta regla **no** se impone en la base de datos, sino en la capa de aplicación al guardar los objetivos (sección 3.5), puesto que se trata de una restricción sobre un conjunto de filas.
- La coherencia de las ventas (no vender más participaciones de las poseídas en cada instante) tampoco se expresa como restricción declarativa: se valida en la aplicación reproduciendo el historial de forma transaccional.

### 2.4 Decisiones de modelado

- **Precisión numérica.** `NUMERIC(12,4)` admite hasta 8 dígitos enteros y 4 decimales, suficiente para participaciones fraccionarias y valores liquidativos habituales. `NUMERIC(5,2)` cubre porcentajes de 0,00 a 999,99.
- **Identificadores UUID** en lugar de enteros secuenciales, para no exponer el volumen de datos ni permitir la enumeración de recursos.
- **Cartera derivada, no almacenada.** Las posiciones, el precio medio y los resultados no se guardan: se calculan a partir del historial de transacciones. Esto evita incoherencias entre datos redundantes, a costa de recalcular en cada consulta (coste lineal en el número de operaciones del usuario).

---

## 3. Especificación de la API REST

### 3.1 Convenciones generales

| Aspecto | Descripción |
|---|---|
| **URL base** | `http://localhost:3001` en desarrollo. Todas las rutas cuelgan de `/api`. |
| **CORS** | Con `FRONTEND_URL` definida solo se acepta ese origen; sin ella, cualquiera (solo desarrollo). |
| **Formato** | JSON (`Content-Type: application/json`) en peticiones y respuestas. |
| **Autenticación** | Las rutas protegidas exigen la cabecera `Authorization: Bearer <JWT>`, con el token obtenido en el registro o el inicio de sesión. |
| **Decimales** | En la entrada se usa el punto como separador decimal. Los importes pueden enviarse como `number` o como cadena numérica; en ambos casos se validan igual. |
| **Fechas** | ISO 8601 en UTC, por ejemplo `2026-10-02T09:15:00.000Z`. |

**Formato de error.** Todas las respuestas de error comparten esta estructura; `details` solo aparece en errores de validación:

```json
{
  "error": "Datos no válidos",
  "details": [
    { "field": "password", "message": "La contraseña debe tener al menos 8 caracteres" }
  ]
}
```

**Errores comunes a todas las rutas protegidas:**

| Código | Cuerpo | Causa |
|---|---|---|
| `401` | `{ "error": "No autenticado" }` | Falta el token, es inválido o ha caducado. |

**Resumen de endpoints:**

| Método | Ruta | Autenticación | Descripción |
|---|---|---|---|
| `GET` | `/api/health` | No | Comprobación de disponibilidad. |
| `POST` | `/api/auth/register` | No | Alta de usuario. |
| `POST` | `/api/auth/login` | No | Inicio de sesión. |
| `POST` | `/api/auth/forgot-password` | No | Solicita el enlace de recuperación de contraseña por correo. |
| `POST` | `/api/auth/reset-password` | No | Establece una nueva contraseña con el token recibido. |
| `GET` | `/api/auth/me` | Sí | Datos del usuario autenticado. |
| `GET` | `/api/funds` | Sí | Catálogo de fondos (refresca los precios caducados). |
| `POST` | `/api/funds/sync-prices` | Sí | Fuerza la actualización de los precios de mercado de todo el catálogo. |
| `GET` | `/api/transactions` | Sí | Historial de operaciones del usuario. |
| `POST` | `/api/transactions` | Sí | Registro de una compra o venta. |
| `GET` | `/api/portfolio` | Sí | Resumen valorado de la cartera. |
| `GET` | `/api/portfolio/history` | Sí | Evolución del capital invertido y del valor de mercado. |
| `POST` | `/api/portfolio/targets` | Sí | Definición de los porcentajes objetivo. |
| `GET` | `/api/portfolio/rebalance` | Sí | Cálculo de rebalanceo por aportación. |

### 3.2 Comprobación de estado

#### `GET /api/health`

- **Cabeceras:** ninguna.
- **Respuesta `200 OK`:**

```json
{ "status": "ok" }
```

### 3.3 Autenticación

#### `POST /api/auth/register`: registro de usuario

- **Cabeceras:** `Content-Type: application/json`.
- **Entrada:**

| Campo | Tipo | Reglas |
|---|---|---|
| `email` | string | Formato de email, máximo 254 caracteres. Se normaliza a minúsculas. |
| `password` | string | Al menos 8 caracteres y como máximo 72 bytes en UTF-8 (límite de bcrypt, sección 1.5), con al menos una mayúscula, un número y un carácter especial (cualquiera que no sea letra ni dígito). |

```json
{ "email": "usuario@test.com", "password": "Password123!" }
```

- **Respuesta `201 Created`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "832c2b08-112f-499d-b7d7-e81f4c67a84a",
    "email": "usuario@test.com",
    "createdAt": "2026-10-02T09:19:26.417Z"
  }
}
```

- **Errores:**

| Código | Causa |
|---|---|
| `400` | Datos no válidos (con `details`). |
| `409` | `{ "error": "El email ya está registrado" }` |

#### `POST /api/auth/login`: inicio de sesión

- **Cabeceras:** `Content-Type: application/json`.
- **Entrada:** `email` (string) y `password` (string, 1 a 72 caracteres).

```json
{ "email": "usuario@test.com", "password": "Password123!" }
```

- **Respuesta `200 OK`:** misma estructura que el registro (`token` y `user`).
- **Errores:**

| Código | Causa |
|---|---|
| `400` | Datos no válidos. |
| `401` | `{ "error": "Credenciales incorrectas" }`: idéntico para email inexistente y contraseña errónea. |

#### `POST /api/auth/forgot-password`: solicitud de recuperación

- **Cabeceras:** `Content-Type: application/json`.
- **Entrada:** `email` (string, mismas reglas que en el registro).

```json
{ "email": "usuario@test.com" }
```

- **Comportamiento:** si el email pertenece a un usuario, se genera un token aleatorio, se guarda su hash con una caducidad de 15 minutos y se envía por correo un enlace `{FRONTEND_URL}/reset-password?token=…`. El envío no se espera: un fallo de SMTP se registra en el log pero no cambia la respuesta.
- **Respuesta `200 OK`:** idéntica exista o no el email, para impedir la enumeración de cuentas.

```json
{ "message": "Si el email existe en nuestro sistema, recibirás un enlace de recuperación" }
```

- **Errores:** `400` si el email no es válido.

#### `POST /api/auth/reset-password`: nueva contraseña

- **Cabeceras:** `Content-Type: application/json`.
- **Entrada:**

| Campo | Tipo | Reglas |
|---|---|---|
| `token` | string | El recibido por correo; obligatorio, máximo 256 caracteres. |
| `newPassword` | string | Misma política que en el registro (al menos 8 caracteres, como máximo 72 bytes, mayúscula, número y carácter especial). |

- **Respuesta `200 OK`:** `{ "message": "Contraseña actualizada correctamente" }`. El token queda invalidado.
- **Errores:**

| Código | Causa |
|---|---|
| `400` | Datos no válidos (por ejemplo, contraseña débil: en ese caso el token **no** se consume), o `{ "error": "El enlace no es válido o ha caducado" }` si el token no existe, ya se usó o está caducado. |

#### `GET /api/auth/me`: usuario autenticado

- **Cabeceras:** `Authorization: Bearer <JWT>`.
- **Respuesta `200 OK`:**

```json
{
  "id": "832c2b08-112f-499d-b7d7-e81f4c67a84a",
  "email": "usuario@test.com",
  "createdAt": "2026-10-02T09:19:26.417Z"
}
```

- **Errores:** `401` (token ausente, inválido, o usuario ya inexistente).

### 3.4 Fondos y transacciones

#### `GET /api/funds`: catálogo de fondos

- **Cabeceras:** `Authorization: Bearer <JWT>`.
- **Comportamiento:** antes de responder, refresca los precios de mercado que hayan caducado (sección 1.6). Si el proveedor externo falla, **no devuelve error**: responde con la última cotización guardada en la base de datos.
- **Respuesta `200 OK`:** lista ordenada por categoría y nombre.

```json
[
  {
    "id": "7c2d9a54-3f6e-4a1b-9d58-0b6e1f4c8a21",
    "isin": "IE00B4L5Y983",
    "name": "iShares Core MSCI World UCITS ETF USD Acc",
    "category": "Renta Variable",
    "currentNAV": 130.38,
    "ticker": "EUNL.DE",
    "lastPriceUpdate": "2026-10-02T08:55:12.000Z"
  },
  {
    "id": "5902db3e-1a26-4c36-91ed-6190c92f3dbf",
    "isin": "IE00BK5BQT80",
    "name": "Vanguard FTSE All-World UCITS ETF USD Acc",
    "category": "Renta Variable",
    "currentNAV": 171.6,
    "ticker": "VWCE.DE",
    "lastPriceUpdate": "2026-10-02T08:55:12.000Z"
  }
]
```

| Campo | Significado |
|---|---|
| `ticker` | Símbolo en Yahoo Finance. El catálogo solo incluye fondos con ticker, por lo que no es nulo en esta respuesta. |
| `lastPriceUpdate` | Momento (UTC) de la última actualización del precio con datos de mercado, o `null` si todavía no se ha sincronizado (por ejemplo, justo después de cargar el *seed*). |

#### `POST /api/funds/sync-prices`: actualización manual de precios

Recorre **todos** los fondos de la base de datos y consulta al proveedor de datos de mercado los que tienen ticker, ignorando la vigencia de la caché y el periodo de espera por fallos. Los registros heredados sin ticker, si los hubiera, se omiten. El catálogo es común a todos los usuarios, por lo que la actualización afecta a todos.

- **Cabeceras:** `Authorization: Bearer <JWT>`. No requiere cuerpo; si el cliente envía uno (con cualquier `Content-Type`), se ignora.
- **Respuesta `200 OK`:** resumen de la sincronización, con el detalle por fondo. Se responde `200` aunque algunos o todos los fondos fallen: el fallo del proveedor es información del resultado, no un error de la petición.

```json
{
  "total": 11,
  "updated": 11,
  "failed": 0,
  "skipped": 0,
  "syncedAt": "2026-10-02T08:55:12.000Z",
  "results": [
    {
      "fundId": "7c2d9a54-3f6e-4a1b-9d58-0b6e1f4c8a21",
      "isin": "IE00B4L5Y983",
      "ticker": "EUNL.DE",
      "status": "updated",
      "price": 130.38
    },
    {
      "fundId": "5902db3e-1a26-4c36-91ed-6190c92f3dbf",
      "isin": "IE00BK5BQT80",
      "ticker": "VWCE.DE",
      "status": "updated",
      "price": 171.6
    }
  ]
}
```

| Campo | Significado |
|---|---|
| `total` | Fondos de la base de datos, con o sin ticker. |
| `updated`, `failed`, `skipped` | Fondos actualizados, con error y omitidos. |
| `results[].status` | `updated`, `failed` o `skipped`. |
| `results[].price` | Nuevo valor liquidativo (solo si `updated`). |
| `results[].reason` | Si `failed`: `http` (el proveedor respondió con error, por ejemplo 429), `timeout`, `network`, `invalid` (respuesta sin un precio válido), `currency` (divisa distinta del euro) o `database`. Si `skipped`: `no-ticker` (registro heredado sin cotización). |
| `results[].detail` | Descripción del fallo, si lo hubo. |

El mismo servicio ejecuta el refresco automático (sección 1.6), que además omite fondos con los motivos `fresh` (precio vigente) y `cooldown` (periodo de espera tras un fallo). Este endpoint fuerza la consulta, por lo que esos dos motivos no aparecen en su respuesta.

Cuando hay fallos, la base de datos conserva la última cotización de esos fondos. Ejemplo con el proveedor inaccesible: `{ "total": 11, "updated": 0, "failed": 11, "skipped": 0, … }`, con `status: "failed"` y `reason: "timeout"` en los fondos afectados.

- **Errores:**

| Código | Causa |
|---|---|
| `401` | Token ausente o inválido. |
| `503` | `{ "error": "La sincronización de precios de mercado está desactivada" }`: la integración está desactivada por configuración (`MARKET_DATA_ENABLED=false`). |

#### `GET /api/transactions`: historial del usuario

- **Cabeceras:** `Authorization: Bearer <JWT>`.
- **Respuesta `200 OK`:** operaciones del usuario autenticado, de la más reciente a la más antigua. El ejemplo muestra las dos más recientes de las siete de la cartera de demostración.

```json
[
  {
    "id": "dcc3b3cd-0c4a-4ab8-806a-a08ff7f93e3b",
    "fundId": "e3a9f6d2-8c41-4b7e-9f05-c2d8a1b6e573",
    "isin": "IE00BG47KB92",
    "fundName": "Vanguard Global Aggregate Bond UCITS ETF EUR Hedged Acc",
    "type": "SELL",
    "shares": 20,
    "pricePerShare": 23,
    "total": 460,
    "transactionDate": "2026-09-02T09:00:00.000Z"
  },
  {
    "id": "61f0a8e2-4c7d-4b95-8e3a-d2b9c5f17a04",
    "fundId": "9d4b2e7f-1a6c-4f38-b0e2-5c7a9d3f1e86",
    "isin": "IE00B4WXJJ64",
    "fundName": "iShares Core Euro Government Bond UCITS ETF EUR Dist",
    "type": "BUY",
    "shares": 12,
    "pricePerShare": 103,
    "total": 1236,
    "transactionDate": "2026-08-03T09:00:00.000Z"
  }
]
```

`total` es `shares × pricePerShare`, redondeado a dos decimales.

#### `POST /api/transactions`: registro de una operación

- **Cabeceras:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`.
- **Entrada:**

| Campo | Tipo | Reglas |
|---|---|---|
| `fundId` | string (UUID) | Debe existir en el catálogo. |
| `type` | string | `"BUY"` o `"SELL"`. |
| `shares` | number o string | Mayor que 0; hasta 8 dígitos enteros y 4 decimales. |
| `pricePerShare` | number o string | Mayor que 0; hasta 8 dígitos enteros y 4 decimales. |
| `transactionDate` | string (ISO 8601) | Opcional; por defecto, el instante actual. No puede ser futura. |

La API no contrasta `pricePerShare` con el valor liquidativo del fondo. Es una decisión deliberada: el contrato admite el precio real de la operación, aunque la SPA lo fija hoy al valor liquidativo actual (véanse las secciones 1.5 y 5).

Ejemplo: la venta que aparece en primer lugar en el historial anterior.

```json
{
  "fundId": "e3a9f6d2-8c41-4b7e-9f05-c2d8a1b6e573",
  "type": "SELL",
  "shares": 20,
  "pricePerShare": 23,
  "transactionDate": "2026-09-02T09:00:00.000Z"
}
```

- **Respuesta `201 Created`:** la operación creada, con la misma estructura que un elemento de `GET /api/transactions` (en este caso, el primero del ejemplo anterior).
- **Errores:**

| Código | Causa |
|---|---|
| `400` | Datos no válidos (fecha futura, más de 4 decimales, UUID mal formado…). |
| `404` | `{ "error": "Fondo no encontrado" }` |
| `422` | `{ "error": "Este fondo no cotiza en bolsa y no está disponible para nuevas compras" }`: compra de un fondo sin ticker. |
| `422` | La venta excede las participaciones disponibles en esa fecha. Por ejemplo, vender 200 participaciones del fondo de renta fija agregada cuando se poseen 130: |

```json
{
  "error": "No tienes participaciones suficientes para esta venta",
  "details": [
    { "field": "shares", "message": "Disponibles a 2026-10-02T09:00:00.000Z: 130; solicitadas: 200" }
  ]
}
```

### 3.5 Cartera

#### `GET /api/portfolio`: resumen valorado

- **Cabeceras:** `Authorization: Bearer <JWT>`.
- **Comportamiento:** como `GET /api/funds`, antes de responder refresca los precios de mercado caducados (sección 1.6); si el proveedor falla, valora la cartera con la última cotización guardada.
- **Respuesta `200 OK`:** importes en euros con 2 decimales, participaciones y precios con hasta 4, porcentajes con 2. Las posiciones se ordenan de mayor a menor valor y los objetivos, de mayor a menor porcentaje. El ejemplo corresponde a la cartera de demostración y muestra solo 2 de sus 5 posiciones y objetivos; los totales sí corresponden a la cartera completa (compárese con la tabla de la sección 4.7).

```json
{
  "totalValue": 19535.86,
  "totalInvested": 17512,
  "pnl": 2023.86,
  "pnlPercentage": 11.56,
  "realizedPnl": 12,
  "positions": [
    {
      "fundId": "7c2d9a54-3f6e-4a1b-9d58-0b6e1f4c8a21",
      "isin": "IE00B4L5Y983",
      "name": "iShares Core MSCI World UCITS ETF USD Acc",
      "category": "Renta Variable",
      "shares": 60,
      "averageBuyPrice": 114.6667,
      "currentNAV": 130.38,
      "lastPriceUpdate": "2026-10-02T08:55:12.000Z",
      "currentValue": 7822.8,
      "invested": 6880,
      "pnl": 942.8,
      "pnlPercentage": 13.7,
      "portfolioPercentage": 40.04,
      "targetPercentage": 40
    },
    {
      "fundId": "4eb9e25b-998b-468f-91de-d8869293a498",
      "isin": "IE00B5BMR087",
      "name": "iShares Core S&P 500 UCITS ETF USD Acc",
      "category": "Renta Variable",
      "shares": 8,
      "averageBuyPrice": 640,
      "currentNAV": 741.58,
      "lastPriceUpdate": "2026-10-02T08:55:12.000Z",
      "currentValue": 5932.64,
      "invested": 5120,
      "pnl": 812.64,
      "pnlPercentage": 15.87,
      "portfolioPercentage": 30.37,
      "targetPercentage": 20
    }
  ],
  "targets": [
    {
      "fundId": "7c2d9a54-3f6e-4a1b-9d58-0b6e1f4c8a21",
      "isin": "IE00B4L5Y983",
      "name": "iShares Core MSCI World UCITS ETF USD Acc",
      "targetPercentage": 40,
      "currentPercentage": 40.04
    },
    {
      "fundId": "4eb9e25b-998b-468f-91de-d8869293a498",
      "isin": "IE00B5BMR087",
      "name": "iShares Core S&P 500 UCITS ETF USD Acc",
      "targetPercentage": 20,
      "currentPercentage": 30.37
    }
  ]
}
```

El MSCI World se compró en dos veces (40 participaciones a 112 € y 20 a 120 €), de ahí su coste medio de 114,6667 €. El `realizedPnl` de 12 € procede de la venta de 20 participaciones del fondo de renta fija agregada a 23 €, compradas a 22,40 €: 20 × (23 − 22,40) = 12 €.

| Campo | Significado |
|---|---|
| `totalValue` | Valor de mercado actual de todas las posiciones abiertas. |
| `totalInvested` | Coste de adquisición de las posiciones abiertas (método de coste medio). |
| `pnl`, `pnlPercentage` | Ganancia o pérdida **latente**: `totalValue − totalInvested` y su porcentaje sobre `totalInvested`. |
| `realizedPnl` | Ganancia o pérdida **ya realizada** mediante ventas. |
| `positions[].averageBuyPrice` | Coste medio por participación. |
| `positions[].lastPriceUpdate` | Momento de la última actualización del precio del fondo con datos de mercado, o `null` si nunca se sincronizó. |
| `positions[].portfolioPercentage` | Peso de la posición sobre `totalValue`. |
| `positions[].targetPercentage` | Objetivo del fondo, o `null` si no tiene. |
| `targets` | Objetivos definidos, incluidos los de fondos sin posición (con `currentPercentage` igual a 0). |

Las fórmulas se desarrollan en la sección 4.6.

#### `GET /api/portfolio/history`: evolución del patrimonio

- **Cabeceras:** `Authorization: Bearer <JWT>`.
- **Comportamiento:** refresca los precios caducados igual que `GET /api/portfolio` y devuelve una serie en orden cronológico, desde el día anterior a la primera operación (con 0 €, para que la gráfica no empiece cortada) hasta hoy. Hay un punto por día; si la serie supera los 400 días, uno por semana, conservando siempre los días con operaciones y el último. Sin operaciones devuelve `[]`.
- **Respuesta `200 OK`:**

```json
[
  { "date": "2026-09-30", "invested": 0, "currentValue": 0 },
  { "date": "2026-10-01", "invested": 1000, "currentValue": 1000 },
  { "date": "2026-10-02", "invested": 1000, "currentValue": 1050 }
]
```

| Campo | Significado |
|---|---|
| `date` | Día (`YYYY-MM-DD`, UTC). |
| `invested` | Coste de adquisición de las posiciones abiertas ese día (coste medio, igual que `totalInvested`). |
| `currentValue` | Participaciones que se tenían ese día × precio estimado del fondo ese día. |

**Precio estimado.** La aplicación no guarda un histórico de valores liquidativos, solo el último. Por eso el precio de cada fondo en cada día se obtiene por **interpolación lineal** entre los precios conocidos: el de cada operación de ese fondo y el NAV actual (situado en el día de hoy). Así el último punto coincide con `totalValue` y `totalInvested` de `GET /api/portfolio`, pero los valores intermedios son una aproximación y no reflejan la volatilidad real del mercado entre operaciones.

#### `POST /api/portfolio/targets`: definición de objetivos

Sustituye **por completo** los objetivos del usuario.

- **Cabeceras:** `Authorization: Bearer <JWT>`, `Content-Type: application/json`.
- **Entrada:**

| Campo | Tipo | Reglas |
|---|---|---|
| `targets` | array (máx. 100) | Lista de objetivos. Una lista vacía elimina todos los objetivos. |
| `targets[].fundId` | string (UUID) | Sin repeticiones dentro de la lista. |
| `targets[].targetPercentage` | number o string | Mayor que 0 y menor o igual que 100; hasta 2 decimales. |

La suma de los porcentajes debe ser **exactamente 100** (salvo en la lista vacía).

Ejemplo: el reparto objetivo de la cartera de demostración.

```json
{
  "targets": [
    { "fundId": "7c2d9a54-3f6e-4a1b-9d58-0b6e1f4c8a21", "targetPercentage": 40 },
    { "fundId": "4eb9e25b-998b-468f-91de-d8869293a498", "targetPercentage": 20 },
    { "fundId": "e3a9f6d2-8c41-4b7e-9f05-c2d8a1b6e573", "targetPercentage": 20 },
    { "fundId": "b1e7c3a0-6d2f-4e8b-a5c9-3f0d7e2b9c14", "targetPercentage": 10 },
    { "fundId": "9d4b2e7f-1a6c-4f38-b0e2-5c7a9d3f1e86", "targetPercentage": 10 }
  ]
}
```

- **Respuesta `200 OK`:** los objetivos guardados, ordenados de mayor a menor porcentaje, con el peso actual de cada fondo.

```json
[
  { "fundId": "7c2d9a54-3f6e-4a1b-9d58-0b6e1f4c8a21", "isin": "IE00B4L5Y983", "name": "iShares Core MSCI World UCITS ETF USD Acc", "targetPercentage": 40, "currentPercentage": 40.04 },
  { "fundId": "4eb9e25b-998b-468f-91de-d8869293a498", "isin": "IE00B5BMR087", "name": "iShares Core S&P 500 UCITS ETF USD Acc", "targetPercentage": 20, "currentPercentage": 30.37 },
  { "fundId": "e3a9f6d2-8c41-4b7e-9f05-c2d8a1b6e573", "isin": "IE00BG47KB92", "name": "Vanguard Global Aggregate Bond UCITS ETF EUR Hedged Acc", "targetPercentage": 20, "currentPercentage": 15.36 },
  { "fundId": "b1e7c3a0-6d2f-4e8b-a5c9-3f0d7e2b9c14", "isin": "IE00BKM4GZ66", "name": "iShares Core MSCI EM IMI UCITS ETF USD Acc", "targetPercentage": 10, "currentPercentage": 7.82 },
  { "fundId": "9d4b2e7f-1a6c-4f38-b0e2-5c7a9d3f1e86", "isin": "IE00B4WXJJ64", "name": "iShares Core Euro Government Bond UCITS ETF EUR Dist", "targetPercentage": 10, "currentPercentage": 6.41 }
]
```

- **Errores:**

| Código | Causa |
|---|---|
| `400` | Datos no válidos (porcentaje fuera de rango, fondos repetidos…). |
| `404` | `{ "error": "Algún fondo no existe" }` |
| `422` | La suma no es 100: |

```json
{
  "error": "Los porcentajes objetivo deben sumar 100",
  "details": [ { "field": "targets", "message": "Suma actual: 90" } ]
}
```

### 3.6 Rebalanceo

#### `GET /api/portfolio/rebalance`: cálculo de rebalanceo por aportación

- **Cabeceras:** `Authorization: Bearer <JWT>`.
- **Parámetros de consulta:**

| Parámetro | Tipo | Reglas |
|---|---|---|
| `newContribution` | string numérico | Opcional (por defecto `0`). Importe en euros ≥ 0, con hasta 2 decimales y punto decimal. |

Ejemplo: `GET /api/portfolio/rebalance?newContribution=1000`

- **Comportamiento:** como `GET /api/portfolio`, refresca antes los precios caducados (sección 1.6) y, si el proveedor falla, calcula con la última cotización guardada.
- **Respuesta `200 OK`:** una fila por fondo, ordenadas de mayor a menor aportación sugerida. El ejemplo corresponde a la cartera de demostración y reproduce el cálculo de la sección 4.7.

```json
{
  "totalValue": 19535.86,
  "newContribution": 1000,
  "targetTotal": 20535.86,
  "items": [
    {
      "fundId": "e3a9f6d2-8c41-4b7e-9f05-c2d8a1b6e573",
      "isin": "IE00BG47KB92",
      "name": "Vanguard Global Aggregate Bond UCITS ETF EUR Hedged Acc",
      "currentPercentage": 15.36,
      "targetPercentage": 20,
      "currentValue": 3000.53,
      "targetValue": 4107.17,
      "affordableContribution": 391.67
    },
    {
      "fundId": "9d4b2e7f-1a6c-4f38-b0e2-5c7a9d3f1e86",
      "isin": "IE00B4WXJJ64",
      "name": "iShares Core Euro Government Bond UCITS ETF EUR Dist",
      "currentPercentage": 6.41,
      "targetPercentage": 10,
      "currentValue": 1252.98,
      "targetValue": 2053.59,
      "affordableContribution": 283.35
    },
    {
      "fundId": "b1e7c3a0-6d2f-4e8b-a5c9-3f0d7e2b9c14",
      "isin": "IE00BKM4GZ66",
      "name": "iShares Core MSCI EM IMI UCITS ETF USD Acc",
      "currentPercentage": 7.82,
      "targetPercentage": 10,
      "currentValue": 1526.91,
      "targetValue": 2053.59,
      "affordableContribution": 186.4
    },
    {
      "fundId": "7c2d9a54-3f6e-4a1b-9d58-0b6e1f4c8a21",
      "isin": "IE00B4L5Y983",
      "name": "iShares Core MSCI World UCITS ETF USD Acc",
      "currentPercentage": 40.04,
      "targetPercentage": 40,
      "currentValue": 7822.8,
      "targetValue": 8214.34,
      "affordableContribution": 138.58
    },
    {
      "fundId": "4eb9e25b-998b-468f-91de-d8869293a498",
      "isin": "IE00B5BMR087",
      "name": "iShares Core S&P 500 UCITS ETF USD Acc",
      "currentPercentage": 30.37,
      "targetPercentage": 20,
      "currentValue": 5932.64,
      "targetValue": 4107.17,
      "affordableContribution": 0
    }
  ]
}
```

| Campo | Significado (símbolos de la sección 4) |
|---|---|
| `totalValue` | Patrimonio actual, `V`. |
| `newContribution` | Aportación, `C`. |
| `targetTotal` | Patrimonio objetivo, `V' = V + C`. |
| `currentPercentage` | Peso actual del fondo, `wᵢ`. |
| `targetPercentage` | Porcentaje objetivo, `tᵢ`. |
| `currentValue` | Valor actual del fondo, `Vᵢ`. |
| `targetValue` | Valor deseado del fondo, `Tᵢ = V′ · tᵢ / 100`. |
| `affordableContribution` | Aportación sugerida, `Aᵢ`. Suma exactamente `C` salvo redondeo de céntimos. |

Un fondo con posición pero sin objetivo se trata como objetivo 0 %; un fondo con objetivo pero sin posición figura con `currentValue` igual a 0.

- **Errores:**

| Código | Causa |
|---|---|
| `400` | `newContribution` no es un importe válido. |
| `422` | `{ "error": "Define primero tus porcentajes objetivo (POST /api/portfolio/targets)" }` |

---

## 4. Algoritmo de rebalanceo

### 4.1 Planteamiento del problema

Sea una cartera de `n` fondos y un reparto objetivo definido por el inversor. Dada una **nueva aportación** `C ≥ 0`, se trata de decidir cuánto se destina a cada fondo para que la cartera resultante se acerque lo más posible al reparto objetivo, con la restricción de que **no se vende ningún activo**: solo se compra, con dinero nuevo. El rebalanceo por aportación evita los costes fiscales y de transacción de las ventas y es la práctica habitual de los inversores pasivos.

### 4.2 Notación

| Símbolo | Definición |
|---|---|
| `i = 1, …, n` | Índice de cada fondo considerado (con posición, con objetivo, o ambas cosas). |
| `qᵢ` | Participaciones poseídas del fondo `i`. |
| `Pᵢ` | Valor liquidativo actual (NAV) del fondo `i`. |
| `Vᵢ` | Valor actual de la posición en el fondo `i`. |
| `V` | Patrimonio total actual. |
| `wᵢ` | Porcentaje actual del fondo `i` en la cartera. |
| `tᵢ` | Porcentaje objetivo del fondo `i`, con `tᵢ ≥ 0` y `Σ tᵢ = 100`. |
| `dᵢ` | Desviación del fondo `i` respecto a su objetivo. |
| `C` | Aportación nueva, en euros. |
| `V′` | Patrimonio objetivo tras la aportación. |
| `Tᵢ` | Valor deseado del fondo `i` tras la aportación. |
| `Dᵢ` | Déficit del fondo `i`: lo que le falta para alcanzar su valor deseado. |
| `Aᵢ` | Aportación sugerida al fondo `i`. |

### 4.3 Magnitudes de la cartera

**Valor de cada posición y patrimonio total:**

$$V_i = q_i \cdot P_i \qquad\qquad V = \sum_{i=1}^{n} V_i$$

**Porcentaje actual** de cada fondo (se define como 0 si `V = 0`):

$$w_i = \frac{V_i}{V} \cdot 100$$

**Desviación** respecto al objetivo, en puntos porcentuales:

$$d_i = w_i - t_i$$

Un valor `dᵢ > 0` indica un fondo **sobreponderado** (pesa más de lo deseado) y `dᵢ < 0` uno **infraponderado**. Como `Σ wᵢ = Σ tᵢ = 100` cuando `V > 0`, las desviaciones suman cero: `Σ dᵢ = 0`.

### 4.4 Cálculo de la aportación sugerida

**Paso 1. Patrimonio objetivo.** Se parte del patrimonio actual más la aportación:

$$V' = V + C$$

**Paso 2. Valor deseado de cada fondo.** Es la parte de `V′` que le corresponde según su objetivo:

$$T_i = V' \cdot \frac{t_i}{100}$$

**Paso 3. Déficit.** Lo que le falta a cada fondo para alcanzar su valor deseado, sin permitir valores negativos (**no se vende**):

$$D_i = \max\bigl(0,\; T_i - V_i\bigr)$$

Los fondos sobreponderados, cuyo valor ya excede el deseado, tienen `Dᵢ = 0`.

**Paso 4. Reparto de la aportación.** Si el déficit total es positivo, la aportación se reparte **proporcionalmente al déficit** de cada fondo:

$$A_i = \begin{cases} C \cdot \dfrac{D_i}{\sum_{j=1}^{n} D_j} & \text{si } \sum_j D_j > 0 \\[2ex] 0 & \text{en otro caso} \end{cases}$$

#### ¿Por qué hace falta el paso 4?

La fórmula directa `Dᵢ = max(0, Tᵢ − Vᵢ)` puede sugerir más dinero del que se dispone. Definiendo `gᵢ = Tᵢ − Vᵢ`, se cumple:

$$\sum_i g_i = \sum_i T_i - \sum_i V_i = V' - V = C$$

Separando los fondos infraponderados (`gᵢ > 0`) de los sobreponderados (`gᵢ < 0`) y llamando `E` al **exceso total** de estos últimos, `E = Σ max(0, −gᵢ) ≥ 0`:

$$\sum_i D_i = \sum_i g_i + E = C + E \;\ge\; C$$

Es decir, la suma de los déficits es la aportación **más** el exceso de los fondos sobreponderados, que no se pueden vender. Si hay algún fondo sobreponderado, el déficit total supera a la aportación y no es posible cubrirlos todos. Escalar por `C / ΣDⱼ` reparte exactamente el dinero disponible, dando prioridad a los fondos que más lo necesitan.

### 4.5 Propiedades del algoritmo

Se demuestran de forma inmediata a partir de las fórmulas anteriores (las propiedades 1 a 6 suponen `C > 0`):

1. **Sin ventas.** `Aᵢ ≥ 0` para todo `i`.
2. **Presupuesto exacto.** `Σ Aᵢ = C`: se invierte toda la aportación y nada más.
3. **Los sobreponderados no reciben nada.** Si `Vᵢ ≥ Tᵢ`, entonces `Dᵢ = 0` y `Aᵢ = 0`.
4. **Ningún fondo supera su objetivo por la aportación.** Como `C ≤ ΣDⱼ`, el factor de escala es como máximo 1 y `Aᵢ ≤ Dᵢ`. Por tanto `Vᵢ + Aᵢ ≤ Tᵢ`: tras comprar, el peso de un fondo receptor `(Vᵢ + Aᵢ) / V′` es como mucho `tᵢ / 100`.
5. **Convergencia exacta cuando no hay sobreponderados.** Si `E = 0`, entonces `ΣDⱼ = C`, `Aᵢ = Dᵢ` y la cartera resultante coincide con el objetivo: `(Vᵢ + Aᵢ) / V′ = tᵢ / 100` para todo `i`.
6. **Dilución pasiva de los sobreponderados.** Aunque no reciban dinero, su peso baja a `Vᵢ / V′ < Vᵢ / V`, porque el patrimonio total aumenta.
7. **Caso `C = 0`.** Todas las aportaciones son 0: sin dinero nuevo no se puede acercar la cartera al objetivo sin vender.
8. **Coste computacional.** `O(n)` para los cálculos, más `O(n log n)` para ordenar el resultado por aportación sugerida.

**Porcentaje resultante** tras ejecutar las compras sugeridas:

$$w_i' = \frac{V_i + A_i}{V'} \cdot 100$$

### 4.6 Valoración previa de la cartera (método del coste medio)

Los valores `qᵢ` y el coste de adquisición de cada posición se obtienen reproduciendo el historial de transacciones del usuario en **orden cronológico** (a igual fecha, las compras preceden a las ventas). Para cada fondo se mantienen tres acumuladores: participaciones `q`, coste `K` y resultado realizado `R`, inicialmente nulos.

- **Compra** de `x` participaciones al precio `p`:

$$q \leftarrow q + x \qquad K \leftarrow K + x\,p$$

- **Venta** de `x` participaciones al precio `p` (con `x ≤ q`; en caso contrario la operación se rechaza):

$$\bar{c} = \frac{K}{q} \qquad R \leftarrow R + x\,(p - \bar{c}) \qquad K \leftarrow K - \bar{c}\,x \qquad q \leftarrow q - x$$

Con ello, para cada posición abierta:

$$\text{precio medio} = \frac{K}{q} \qquad \text{P\&L} = V_i - K \qquad \text{P\&L (\%)} = \frac{V_i - K}{K} \cdot 100$$

y para el conjunto de la cartera, con `K_total = Σ K`:

$$\text{P\&L global} = V - K_{total} \qquad \text{P\&L global (\%)} = \frac{V - K_{total}}{K_{total}} \cdot 100$$

El resultado realizado total es la suma de los `R` de todos los fondos.

### 4.7 Ejemplo numérico

Se emplea la cartera de demostración que carga el *seed* (cinco ETF), valorada con los **valores liquidativos iniciales** del propio *seed*, que son cotizaciones reales de referencia. Con la sincronización de datos de mercado activa (sección 1.6), los precios varían a diario y, con ellos, las cifras concretas de la cartera; el procedimiento de cálculo es el mismo.

| Fondo | Participaciones `qᵢ` | NAV `Pᵢ` | Valor `Vᵢ` | `wᵢ` (%) | Objetivo `tᵢ` (%) | Desviación `dᵢ` (pp) |
|---|---:|---:|---:|---:|---:|---:|
| iShares Core MSCI World | 60 | 130,38 | 7.822,80 | 40,04 | 40 | +0,04 |
| iShares Core S&P 500 | 8 | 741,58 | 5.932,64 | 30,37 | 20 | +10,37 |
| Vanguard Global Aggregate Bond | 130 | 23,081 | 3.000,53 | 15,36 | 20 | −4,64 |
| iShares Core MSCI EM IMI | 31 | 49,255 | 1.526,91 | 7,82 | 10 | −2,18 |
| iShares Core Euro Government Bond | 12 | 104,415 | 1.252,98 | 6,41 | 10 | −3,59 |
| **Total** | | | **`V` = 19.535,86** | 100 | 100 | 0 |

**Aportación `C` = 1.000 €.** El patrimonio objetivo es `V′ = 19.535,86 + 1.000 = 20.535,86 €`.

| Fondo | Valor deseado `Tᵢ` | `Tᵢ − Vᵢ` | Déficit `Dᵢ` | Aportación `Aᵢ` | `wᵢ′` (%) |
|---|---:|---:|---:|---:|---:|
| Vanguard Global Aggregate Bond | 4.107,17 | +1.106,64 | 1.106,64 | **391,67** | 16,52 |
| iShares Core Euro Government Bond | 2.053,59 | +800,61 | 800,61 | **283,35** | 7,48 |
| iShares Core MSCI EM IMI | 2.053,59 | +526,68 | 526,68 | **186,40** | 8,34 |
| iShares Core MSCI World | 8.214,34 | +391,54 | 391,54 | **138,58** | 38,77 |
| iShares Core S&P 500 | 4.107,17 | −1.825,47 | 0 | **0,00** | 28,89 |
| **Total** | 20.535,86 | `C` = 1.000 | `ΣD` = 2.825,47 | **1.000,00** | |

*Los importes se muestran redondeados a dos decimales; por eso la suma de las columnas puede diferir en un céntimo del total indicado.*

Observaciones:

- El fondo **iShares Core S&P 500** está sobreponderado (`E` = 1.825,47 €) y no recibe nada: no se vende, pero su peso baja del 30,37 % al 28,89 % por dilución.
- El déficit total (2.825,47 €) es igual a `C + E` = 1.000 + 1.825,47, como predice la sección 4.4. Por eso se escala por `C / ΣD` = 1.000 / 2.825,47 ≈ 0,354.
- El fondo **iShares Core MSCI World** está prácticamente en su objetivo (`d` = +0,04 pp) y aun así recibe 138,58 €: al crecer el patrimonio hasta `V′`, su valor deseado (8.214,34 €) supera el actual, de modo que mantiene su peso del 40 % en lugar de diluirse.
- Ningún fondo receptor supera su objetivo tras la compra (propiedad 4): por ejemplo, MSCI World queda en el 38,77 % frente a un objetivo del 40 %.
- La mayor desviación absoluta de la cartera pasa de 10,37 a 8,89 puntos porcentuales (el fondo sobreponderado), y con aportaciones sucesivas continúa reduciéndose.

### 4.8 Detalles de implementación

- **Precisión.** En el servidor todos los cálculos intermedios usan aritmética decimal exacta. Los resultados se redondean a 2 decimales (mitad hacia arriba) solo al construir la respuesta.
- **Redondeo del reparto.** El servidor redondea cada `Aᵢ` de forma independiente, por lo que la suma puede diferir de `C` en uno o dos céntimos. El cliente, que además crea las compras, trabaja en céntimos enteros y asigna los céntimos sobrantes a los fondos con mayor resto fraccionario (*método del mayor resto*), de modo que la suma es exactamente `C`.
- **Conversión a compras.** Cada aportación se transforma en participaciones al valor liquidativo actual: `participaciones = Aᵢ / Pᵢ`, redondeado a 4 decimales. Por ello el importe real de la compra puede diferir de `Aᵢ` en unos céntimos.
- **Fondos sin objetivo.** Un fondo con posición pero sin objetivo se considera `tᵢ = 0`: su valor deseado es 0, no recibe aportación y su peso se diluye.

---

## 5. Limitaciones y trabajo futuro

- **Datos de mercado.** El catálogo se limita a ETF con cotización en bolsa, únicos para los que existe un precio en tiempo real accesible. La API pública de Yahoo Finance no es oficial: puede cambiar o limitar el acceso sin previo aviso (de ahí la estrategia de recuperación de la sección 1.6) y devuelve el precio de cotización en bolsa, que puede diferir ligeramente del valor liquidativo oficial. Los fondos de inversión tradicionales, que se valoran una vez al día fuera de bolsa, quedan fuera del alcance. Una evolución natural es emplear un proveedor con contrato de servicio que permita ampliar la cobertura.
- **Precio de las operaciones.** El formulario registra las operaciones al valor liquidativo actual, aunque la fecha sea pasada. La API ya admite el precio real (sección 1.5); exponerlo en el formulario permitiría una valoración histórica precisa del coste medio.
- **Rebalanceo con ventas.** El algoritmo se limita deliberadamente al rebalanceo por aportación. Un modo alternativo podría proponer ventas cuando la desviación supere un umbral, teniendo en cuenta su coste fiscal.
- **Historial de transacciones.** El Dashboard muestra el historial completo, pero sin filtros por fondo, tipo o fechas, y las operaciones registradas no pueden editarse ni anularse. Una mejora natural es añadir filtros, paginación en servidor y la corrección de operaciones erróneas.
- **Evolución temporal.** No se almacena la serie histórica del patrimonio; añadirla permitiría mostrar gráficos de evolución y rentabilidades anualizadas.
- **Divisa y fiscalidad.** El sistema trabaja en euros y no modela comisiones ni impuestos.

---

## Anexo A. Guía de despliegue en la nube

Este anexo describe la publicación de la aplicación con servicios que ofrecen plan gratuito: **Neon** (PostgreSQL), **Render** (backend) y **Vercel** (frontend). Se parte de que el código está en un repositorio de GitHub. El orden de los pasos importa, porque cada servicio necesita la URL del anterior.

| Servicio | Qué aloja | Variables que necesita |
|---|---|---|
| Neon | Base de datos | — (genera `DATABASE_URL`) |
| Render | API Fastify | `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` |
| Vercel | Frontend React | `VITE_API_URL` |

### A.1 Base de datos en Neon

1. Se crea una cuenta en [neon.tech](https://neon.tech) y un proyecto nuevo, en una región próxima a la de Render (por ejemplo, Fráncfort).
2. En **Connect** se copia la cadena de conexión **directa** (sin `-pooler` en el host), que termina en `?sslmode=require`.
3. Desde una máquina local, con esa cadena como `DATABASE_URL` y `SEED_DEMO_USER=false` en `backend/.env`, se genera el cliente de Prisma, se crean las tablas y se carga el catálogo:

   ```bash
   cd backend
   npx prisma generate     # el seed usa el cliente generado, que no se versiona
   npx prisma db push      # crea las tablas
   npx prisma db seed      # carga el catálogo de fondos
   ```

   El seed es imprescindible: sin el catálogo, el formulario de transacciones no tiene fondos que elegir. Con `SEED_DEMO_USER=false` no crea el usuario de demostración, cuya contraseña es pública en el repositorio. Si se hubiera cargado, debe eliminarse ese usuario de la base de datos de producción (por ejemplo, con `npx prisma studio`); sus operaciones y objetivos se borran en cascada.

   Terminado este paso, conviene restaurar en `backend/.env` la cadena de la base de datos local para no trabajar por error contra producción.

### A.2 Backend en Render

1. En [render.com](https://render.com) se crea un servicio con **New → Web Service** y se conecta el repositorio de GitHub.
2. Configuración:

   | Campo | Valor |
   |---|---|
   | Root Directory | `backend` |
   | Runtime | Node |
   | Build Command | `npm install && npm run build` |
   | Start Command | `npm start` |

   `npm run build` ejecuta `prisma generate` (el cliente de Prisma no se versiona) y después `tsc`, que deja el resultado en `dist/`. `npm start` lanza `node dist/server.js`, que escucha en `0.0.0.0` y en el puerto que Render inyecta en `PORT`.
3. Variables en **Environment**:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | La cadena de Neon del paso A.1 |
   | `JWT_SECRET` | Un valor largo y aleatorio (por ejemplo, `openssl rand -base64 48`) |
   | `FRONTEND_URL` | Se completa en el paso A.4 |

4. Tras el despliegue, `https://<servicio>.onrender.com/api/health` debe responder `{"status":"ok"}`.

> En el plan gratuito, Render suspende el servicio tras unos minutos sin tráfico; la primera petición posterior puede tardar hasta un minuto.

### A.3 Frontend en Vercel

1. En [vercel.com](https://vercel.com) se importa el mismo repositorio con **Add New → Project**.
2. Se indica **Root Directory** = `frontend`. Vercel detecta Vite (build `npm run build`, salida `dist`).
3. En **Environment Variables** se añade `VITE_API_URL` con la URL de Render, **sin barra final** (por ejemplo, `https://gestor-api.onrender.com`).
4. Se despliega. El archivo `frontend/vercel.json` redirige todas las rutas a `index.html`, lo que permite abrir directamente enlaces como `/reset-password?token=…`.

### A.4 Configuración de CORS

Con `FRONTEND_URL` definida, el backend solo acepta peticiones de ese origen. En Render se asigna a `FRONTEND_URL` la URL de Vercel (por ejemplo, `https://gestor-carteras.vercel.app`, sin barra final) y se guarda; el servicio se reinicia. La misma variable sirve para construir el enlace del correo de recuperación de contraseña.

Si `FRONTEND_URL` no está definida, el backend acepta cualquier origen y el enlace del correo apunta a `http://localhost:5173`. Es aceptable en desarrollo, pero no en producción.

### A.5 Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `DATABASE_URL` | Backend | Cadena de conexión PostgreSQL (Neon, con `sslmode=require`) |
| `JWT_SECRET` | Backend | Secreto de firma de los tokens; distinto del de desarrollo |
| `FRONTEND_URL` | Backend | Origen del frontend: CORS y enlaces de los correos |
| `PORT` | Backend | Lo inyecta Render; en local, 3001 por defecto |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Backend | Opcionales. Sin ellas, el correo de recuperación usa una cuenta de pruebas de Ethereal y no llega a ningún buzón real |
| `SEED_DEMO_USER` | Seed (local) | Con `false`, el seed carga solo el catálogo, sin el usuario de demostración |
| `VITE_API_URL` | Frontend | URL pública del backend. Se incrusta al compilar: si cambia, hay que volver a desplegar |

Las plantillas están en `backend/.env.example` y `frontend/.env.example`. Los archivos `.env` reales están en `.gitignore` y nunca deben subirse al repositorio.

### A.6 Solución de problemas

| Síntoma | Causa probable |
|---|---|
| Error de CORS en la consola del navegador | `FRONTEND_URL` no coincide exactamente con el origen de Vercel (esquema, subdominio) |
| El frontend llama a `/api/...` en su propio dominio y obtiene 404 | Falta `VITE_API_URL`; hay que definirla y volver a desplegar |
| `500` en login o registro | Las tablas no existen (falta `prisma db push`) o `DATABASE_URL` es incorrecta |
| `Cannot find module .../generated/prisma` en Render | El Build Command no ejecutó `npm run build` |
| `Cannot find module .../generated/prisma` al ejecutar el seed | Falta `npx prisma generate` en la máquina local |
| Primera petición muy lenta | Render está reactivando el servicio gratuito |

### A.7 Correo de recuperación de contraseña con Brevo

Sin variables `SMTP_*`, el backend usa una cuenta de pruebas de Ethereal, que no entrega a buzones reales. En producción puede usarse el SMTP gratuito de [Brevo](https://www.brevo.com) (unos 300 correos al día).

1. Se crea una cuenta en Brevo y, en **Senders, Domains & Dedicated IPs → Senders**, se añade y verifica una dirección de remitente mediante el correo de confirmación que envía Brevo. No hace falta dominio propio.
2. En **SMTP & API → SMTP** figuran el servidor (`smtp-relay.brevo.com`) y el *login*; allí se genera una **clave SMTP**, que actúa como contraseña (no es la de la cuenta de Brevo).
3. En Render, en **Environment**, se añaden:

   | Variable | Valor |
   |---|---|
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `2525` (no `587`: Render lo bloquea) |
   | `SMTP_USER` | El login SMTP de Brevo |
   | `SMTP_PASS` | La clave SMTP generada |
   | `SMTP_FROM` | `"Gestor de Carteras" <remitente-verificado@dominio.com>` |
   | `FRONTEND_URL` | La URL de Vercel, sin barra final |

4. Al guardar, Render reinicia el servicio. Para comprobarlo, se solicita una recuperación desde `/forgot-password` con un usuario real y se revisa el buzón (incluida la carpeta de correo no deseado).

> Los planes gratuitos de Render bloquean la salida por los puertos SMTP habituales (25, 465 y 587): con `587` la conexión no llega a Brevo y este no registra nada. Con `2525` el envío funciona (verificado en producción). Si el correo no llega, los **Logs** de Render muestran cualquier error de conexión o de autenticación con el mensaje «No se pudo enviar el email de recuperación».
