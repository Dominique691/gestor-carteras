# Gestor de Carteras de Fondos Indexados

Aplicación web *full-stack* para registrar, valorar y **rebalancear una cartera de fondos indexados**. El usuario anota sus compras y ventas, ve en un panel cuánto vale su cartera y cuánto ha ganado o perdido, define el reparto objetivo entre fondos y la aplicación le indica **en qué fondos debe invertir una nueva aportación** para acercarse a ese objetivo sin tener que vender nada.

> Este repositorio es el código del Trabajo Fin de Máster. La parte teórica (arquitectura, modelo de datos, especificación de la API y algoritmo de rebalanceo) está en [`DOCUMENTACION_TFM.md`](./DOCUMENTACION_TFM.md).

## Índice

1. [Descripción general](#1-descripción-general)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Instalación y ejecución](#3-instalación-y-ejecución)
4. [Estructura del proyecto](#4-estructura-del-proyecto)
5. [Funcionalidades principales](#5-funcionalidades-principales)
6. [Credenciales de prueba](#6-credenciales-de-prueba)
7. [Tests](#7-tests)
8. [Solución de problemas](#8-solución-de-problemas)
9. [Limitaciones conocidas](#9-limitaciones-conocidas)

---

## 1. Descripción general

Quien invierte en fondos indexados suele seguir una estrategia pasiva: fija un reparto objetivo (por ejemplo, 60 % renta variable y 40 % renta fija) y aporta dinero periódicamente. Con el tiempo, los distintos fondos rinden de forma desigual y la cartera se desvía del reparto original. Corregirlo vendiendo tiene un coste fiscal y de comisiones, por lo que la forma habitual de rebalancear es **dirigir las nuevas aportaciones a los fondos que están por debajo de su objetivo**.

El Gestor de Carteras automatiza ese proceso:

- Mantiene el **histórico de operaciones** de cada usuario y calcula las posiciones con el método de **coste medio**.
- Muestra un **panel** con el patrimonio, la inversión, la ganancia o pérdida y la distribución por categoría.
- Calcula, para una aportación dada, el **importe sugerido por fondo** y permite **crear las compras** correspondientes con un clic.

Todos los importes se calculan con aritmética decimal exacta (no con coma flotante) para evitar errores de redondeo en cifras monetarias.

## 2. Stack tecnológico

| Capa | Tecnologías |
|---|---|
| **Frontend** | [React 19](https://react.dev) · [Vite 8](https://vite.dev) · TypeScript · [Tailwind CSS 4](https://tailwindcss.com) · [Shadcn UI](https://ui.shadcn.com) (sobre Radix UI) · React Router 7 · Recharts · Lucide |
| **Backend** | [Fastify 5](https://fastify.dev) · TypeScript · [Prisma ORM 7](https://www.prisma.io) · Zod 4 (validación) · `@fastify/jwt` + `bcryptjs` (autenticación) · Nodemailer (correos de activación y recuperación) |
| **Base de datos** | [PostgreSQL](https://www.postgresql.org) (probado con la versión 17) |
| **Datos de mercado** | API pública de [Yahoo Finance](https://finance.yahoo.com) consultada con `fetch` nativo (sin dependencias adicionales) |
| **Testing** | [Vitest 5](https://vitest.dev) en ambos proyectos · React Testing Library + jsdom en el frontend |

## 3. Instalación y ejecución

### 3.1 Requisitos previos

- **Node.js** `20.19+`, `22.12+` o `24+` (probado con 24). Incluye `npm`.
- **PostgreSQL** accesible en local. Lo más cómodo es usar Docker (ver más abajo).
- **Git**.

### 3.2 Obtener el código e instalar dependencias

```bash
git clone https://github.com/Dominique691/gestor-carteras.git
cd gestor-carteras
npm run install:all
```

`install:all` instala las dependencias de la raíz, del backend y del frontend.

### 3.3 Levantar PostgreSQL

Con Docker:

```bash
docker run -d --name gestor-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=gestor_carteras \
  -p 5432:5432 -v gestor_pg_data:/var/lib/postgresql/data postgres:17
```

En ejecuciones posteriores basta con `docker start gestor-pg`. Si ya tienes un PostgreSQL propio, crea una base de datos vacía y ajusta `DATABASE_URL` en el paso siguiente.

### 3.4 Variables de entorno

Copia la plantilla del backend y edítala:

```bash
# macOS / Linux / Git Bash
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend\.env.example backend\.env
```

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3001` |
| `HOST` | Interfaz de escucha | `0.0.0.0` |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL | `postgresql://postgres:postgres@localhost:5432/gestor_carteras?schema=public` |
| `JWT_SECRET` | Secreto con el que se firman los tokens. **Mínimo 32 caracteres**; el servidor no arranca si es más corto | *(sin valor útil: cámbialo)* |
| `JWT_EXPIRES_IN` | Caducidad del token | `7d` |
| `MARKET_DATA_ENABLED` | Activa la actualización de precios con datos de mercado reales (Yahoo Finance). Con `false` la aplicación funciona sin conexión a internet, con los últimos precios guardados | `true` |
| `MARKET_DATA_TTL_MINUTES` | Minutos durante los que un precio se considera vigente antes de volver a consultarlo | `15` |
| `MARKET_DATA_TIMEOUT_MS` | Tiempo máximo de espera por consulta al proveedor, en milisegundos | `3000` |
| `FRONTEND_URL` | Origen del frontend, sin barra final. Se usa para CORS y para los enlaces de los correos de activación y de recuperación. Sin definir, el backend acepta cualquier origen y el enlace apunta a `http://localhost:5173` (solo desarrollo). La plantilla `.env.example` ya trae `http://localhost:5173` | *(sin valor)* |
| `SEED_DEMO_USER` | Con `false`, `prisma db seed` carga solo el catálogo de fondos, sin el usuario de demostración. Úsalo en cualquier base de datos que no sea local | `true` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Opcionales. Servidor SMTP para los correos de activación de cuenta y de recuperación de contraseña. Sin ellas se usa una cuenta de pruebas de Ethereal: el correo no llega a ningún buzón y el enlace se imprime en el log del backend | *(vacío)* |

Variable del **frontend** (`frontend/.env.example`): `VITE_API_URL`, la URL pública del backend. Solo se necesita en producción; en desarrollo se deja vacía y Vite redirige `/api` al backend.

Genera un `JWT_SECRET` aleatorio con:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> `backend/.env` está en el `.gitignore` y **no debe subirse al repositorio**. El frontend no necesita variables de entorno en desarrollo: Vite redirige `/api` al backend.

### 3.5 Base de datos: cliente, esquema y datos iniciales

Desde la carpeta `backend`:

```bash
cd backend
npx prisma generate     # genera el cliente de Prisma en src/generated
npx prisma db push      # crea las tablas a partir de prisma/schema.prisma
npx prisma db seed      # carga el catálogo de fondos y el usuario de demostración
```

- `prisma generate` es necesario porque el cliente generado (`backend/src/generated/`) no se versiona.
- `prisma db push` sincroniza el esquema directamente, sin historial de migraciones. El repositorio incluye además las migraciones versionadas en `backend/prisma/migrations/`; si prefieres usarlas, ejecuta en su lugar `npx prisma migrate deploy` (despliegue) o `npx prisma migrate dev` (desarrollo). No mezcles ambos métodos sobre la misma base de datos.
- `prisma db seed` es **idempotente**: puedes ejecutarlo varias veces sin duplicar fondos. Recrea cada vez la cartera del usuario de demostración y no pisa los precios ya sincronizados. Si la base de datos viene de una versión anterior con fondos sin cotización, los retira siempre que nadie los use (nunca borra operaciones ni objetivos de un usuario) y avisa de los que conserva.

### 3.6 Arrancar la aplicación

Desde la raíz del proyecto:

```bash
npm run dev               # backend y frontend a la vez
```

o cada uno por separado, en dos terminales:

```bash
npm run dev:backend       # API en http://localhost:3001
npm run dev:frontend      # web en http://localhost:5173
```

Abre **http://localhost:5173** (usa `localhost`, no `127.0.0.1`: Vite escucha en IPv6 en algunos sistemas) e inicia sesión con las [credenciales de prueba](#6-credenciales-de-prueba).

Comprobación rápida de que la API responde: `http://localhost:3001/api/health` debe devolver `{"status":"ok"}`.

### 3.7 Build de producción

```bash
npm run build                      # compila backend (tsc → backend/dist) y frontend (vite → frontend/dist)
npm run start --prefix backend     # arranca la API compilada
```

El frontend compilado (`frontend/dist`) es estático y se sirve con cualquier servidor web. Define `VITE_API_URL` con la URL pública del backend **antes de compilar** (se incrusta en el build) y `FRONTEND_URL` en el backend para que acepte ese origen (CORS). Si el frontend y la API comparten dominio, puedes dejar `VITE_API_URL` vacía y servir la API en `/api` con un proxy inverso.

Para publicarla en la nube con Neon (base de datos), Render (backend) y Vercel (frontend), sigue la [guía de despliegue](./DOCUMENTACION_TFM.md#anexo-a-guía-de-despliegue-en-la-nube) (anexo A de la documentación técnica).

### 3.8 Resumen de scripts

| Comando | Dónde | Acción |
|---|---|---|
| `npm run install:all` | raíz | Instala todas las dependencias |
| `npm run dev` | raíz | Backend + frontend en paralelo |
| `npm run dev:backend` / `dev:frontend` | raíz | Cada uno por separado |
| `npm run build` | raíz | Compila ambos proyectos |
| `npm run test` | raíz | Ejecuta todos los tests (backend y frontend) |
| `npm run test:watch` | `backend/` o `frontend/` | Tests en modo vigilancia |
| `npm run db:generate` / `db:migrate` / `db:seed` / `db:studio` | `backend/` | Atajos de Prisma (`studio` abre un explorador de la base de datos) |

## 4. Estructura del proyecto

```
gestor-carteras/
├── package.json                  # Scripts de la raíz (dev, build, test, install:all)
├── .gitignore                    # Excluye node_modules, dist, .env, cliente generado…
├── README.md                     # Este archivo
├── DOCUMENTACION_TFM.md          # Documentación técnica para la memoria
│
├── backend/                      # API REST (Fastify + Prisma)
│   ├── prisma/
│   │   ├── schema.prisma         # Modelo de datos: User, Fund, Transaction, TargetAllocation
│   │   ├── migrations/           # Migraciones SQL versionadas
│   │   └── seed.ts               # Catálogo de fondos + usuario y cartera de demostración
│   ├── prisma.config.ts          # Configuración de Prisma (URL de la BD, comando de seed)
│   ├── vitest.config.ts
│   └── src/
│       ├── server.ts             # Punto de entrada: lee el entorno y escucha en el puerto
│       ├── app.ts                # Construye la app Fastify y registra plugins y rutas
│       ├── db.ts                 # Instancia única del cliente de Prisma
│       ├── plugins/auth.ts       # Plugin JWT y hook `authenticate` para rutas protegidas
│       ├── modules/              # Un módulo por dominio (rutas + esquemas Zod + tipos DTO)
│       │   ├── auth/             #   registro, verificación de email, login, /me y recuperación de contraseña
│       │   ├── funds/            #   catálogo de fondos
│       │   ├── transactions/     #   alta y listado de operaciones
│       │   └── portfolio/        #   cartera, objetivos y cálculo de coste medio
│       ├── services/             # Lógica de negocio: valoración de cartera, rebalanceo, datos de mercado y envío de email
│       ├── lib/                  # Utilidades: aritmética decimal, formato de errores
│       ├── routes/__tests__/     # Tests de integración: autenticación, recuperación de contraseña, CORS, fondos y transacciones
│       └── generated/            # Cliente de Prisma generado (no se versiona)
│
└── frontend/                     # SPA (React + Vite)
    ├── components.json           # Configuración de Shadcn UI
    ├── vite.config.ts            # Alias `@/`, plugin de Tailwind y proxy de `/api`
    ├── vercel.json               # Redirige todas las rutas a index.html (SPA) en Vercel
    ├── .env.example              # Plantilla de VITE_API_URL
    ├── vitest.config.ts          # Entorno jsdom y archivo de arranque de tests
    └── src/
        ├── main.tsx              # Monta React con el enrutador, el tema y el contexto de sesión
        ├── App.tsx               # Rutas: /login, /forgot-password, /reset-password, /verify-email, /dashboard, /rebalance
        ├── pages/                # Pantallas: Login, ForgotPassword, ResetPassword, Dashboard, Rebalance (+ tests)
        ├── components/           # AppLayout, RouteGuards, tema (ModeToggle), medidor de contraseña, historial y diálogos
        │   └── ui/               #   componentes base de Shadcn (button, card, table, dialog…)
        ├── context/AuthContext.tsx   # Sesión: guarda el JWT en localStorage
        ├── lib/                  # Cliente HTTP, tipos, formato monetario y cálculo de rebalanceo
        └── test/setup.ts         # Configuración común de los tests
```

## 5. Funcionalidades principales

### Registro e inicio de sesión

- Registro con **email** y **contraseña** (al menos 8 caracteres y como máximo 72 bytes, con al menos una mayúscula, un número y un carácter especial; un medidor de fortaleza guía al usuario). El límite es en bytes porque bcrypt ignora lo que pasa de 72: las tildes, la ñ o el € ocupan 2 o 3. El email se normaliza a minúsculas y no puede repetirse.
- Las contraseñas se guardan cifradas con **bcrypt** (coste 12); nunca se almacenan ni se devuelven en claro.
- **Verificación del email:** el registro no inicia sesión. Se envía un enlace a `/verify-email?token=…` que caduca a las **24 horas** y es de un solo uso (en la base de datos solo se guarda su hash SHA-256). Hasta abrirlo, el login responde 403 y ofrece reenviar el enlace; un enlace caducado también permite pedir otro. Restablecer la contraseña verifica la cuenta, porque demuestra el acceso al buzón.
- El inicio de sesión devuelve un **JWT** que el frontend guarda en `localStorage` y envía en cada petición. Si el servidor responde 401 (token caducado o inválido), la sesión se cierra automáticamente.
- Las rutas `/dashboard` y `/rebalance` están protegidas: sin sesión se redirige a `/login`. Las rutas `/login`, `/forgot-password` y `/reset-password` son solo para usuarios sin sesión; `/verify-email` es accesible siempre.
- La aplicación incluye un selector de tema (claro, oscuro o el del sistema), que se recuerda en el navegador.

### Recuperación de contraseña

- Desde `/forgot-password` el usuario indica su email y recibe un enlace a `/reset-password?token=…`. La respuesta es siempre la misma exista o no el email, para no revelar qué cuentas están registradas.
- El token es aleatorio, **caduca a los 15 minutos** y es de un solo uso. En la base de datos solo se guarda su hash SHA-256.
- El correo se envía por SMTP (en producción, Brevo; ver el [apartado A.7 de la documentación técnica](./DOCUMENTACION_TFM.md#a7-correo-de-activación-y-de-recuperación-de-contraseña-con-brevo)). Sin SMTP configurado, en desarrollo se usa Ethereal y el enlace aparece en el log del backend.

### Dashboard con KPIs

- **Cuatro indicadores:** patrimonio total, inversión total, ganancia/pérdida en euros y rentabilidad en %. Las ganancias salen en verde y las pérdidas en rojo, con flecha para no depender solo del color.
- **Gráfico circular** con la distribución de la cartera por categoría (Renta Variable frente a Renta Fija).
- **Evolución del patrimonio:** gráfico de líneas del capital invertido frente al valor de mercado desde la primera operación. Los valores intermedios se estiman interpolando entre los precios de las operaciones y el precio actual.
- **Tabla de fondos en cartera:** nombre, ISIN, participaciones, precio actual (con la fecha y hora de su última actualización), valor total, P&L (€ y %) y peso sobre la cartera.
- **Botón «Actualizar precios de mercado»:** descarga al momento las cotizaciones reales de los ETF, muestra un indicador de carga y avisa con una notificación del resultado. Ver [Precios de mercado](#precios-de-mercado-reales).

### Catálogo y transacciones

- **Catálogo de fondos:** `GET /api/funds` devuelve los fondos disponibles (nombre, ISIN, categoría, valor liquidativo actual, ticker y fecha de la última actualización). El catálogo contiene **solo fondos que cotizan en bolsa**: 11 ETF populares (iShares Core MSCI World, Vanguard FTSE All-World, iShares Core S&P 500, Vanguard S&P 500, Xtrackers MSCI World, Amundi MSCI World, iShares Core MSCI EM IMI y 4 de renta fija). La API no lista ni permite comprar fondos sin ticker. El catálogo se carga al abrir el formulario de nueva transacción.
- **Alta de transacciones** desde el botón **«Añadir transacción»**: compra o venta, fondo, fecha y cantidad, indicada **en euros** (por defecto; las participaciones se calculan como importe ÷ precio) **o en participaciones**. En el formulario, el precio es el valor liquidativo actual del fondo y no es editable. La API, en cambio, acepta cualquier precio por participación: es una decisión deliberada para poder registrar más adelante el precio real de cada operación (ver la [sección 1.5 de la documentación técnica](./DOCUMENTACION_TFM.md#15-decisiones-de-diseño-relevantes)).
- **Validaciones:** no se puede vender más de lo que se posee en esa fecha (incluidas las operaciones con fecha pasada), ni registrar fechas futuras. El saldo se valida bloqueando las escrituras concurrentes del mismo usuario.
- **Histórico de transacciones:** en la parte inferior del Dashboard, la tarjeta **«Historial de transacciones»** lista todas las operaciones del usuario, de la más reciente a la más antigua: fecha, tipo (compra o venta), fondo con su ISIN, participaciones, precio e importe. Muestra las 10 últimas y un botón **«Ver todas»** despliega el resto. Se actualiza solo al registrar una operación nueva. Los datos vienen de `GET /api/transactions`, y las posiciones y el precio medio se calculan reproduciendo ese historial en orden cronológico.

### Precios de mercado reales

Los valores liquidativos de los ETF se actualizan con cotizaciones reales de **Yahoo Finance** (consulta HTTP directa, sin claves de API ni dependencias extra). Cada ETF del catálogo tiene un *ticker* (por ejemplo, `EUNL.DE`, `VWCE.DE`, `SXR8.DE`).

- **Actualización automática:** al abrir el Dashboard, el catálogo o el rebalanceo, se refrescan solo los precios que llevan más de 15 minutos sin actualizarse (configurable). Si el precio está vigente, no se consulta nada, y la respuesta es inmediata.
- **Actualización manual:** el botón **«Actualizar precios de mercado»** del Dashboard (o `POST /api/funds/sync-prices`) fuerza la consulta de todo el catálogo.
- **Resiliente a fallos:** si el proveedor no responde (límite de cuota, sin conexión, más de 3 s de espera o respuesta no válida), el error se captura, **no se modifica la base de datos** y la aplicación sigue mostrando la última cotización guardada, sin errores. Tras un fallo, ese fondo no se reintenta durante 5 minutos para no ralentizar las peticiones.
- **Fecha visible:** junto al precio de cada fondo (y en la cabecera del Dashboard) se muestra cuándo se actualizó por última vez.
- **Solo euros:** se descartan las cotizaciones en otra divisa.
- **Sin conexión:** con `MARKET_DATA_ENABLED=false` la aplicación no consulta internet y trabaja con los precios guardados.

Todos los fondos del catálogo cotizan en bolsa y tienen ticker, por lo que todos sus precios son reales. La arquitectura se detalla en el [apartado 1.6 de la documentación técnica](./DOCUMENTACION_TFM.md#16-integración-de-datos-de-mercado).

### Módulo de rebalanceo inteligente por aportación

1. Introduce la **nueva aportación (€)**.
2. Ajusta los **porcentajes objetivo** de cada fondo; deben sumar exactamente 100 %. Puedes añadir fondos del catálogo y guardar el reparto.
3. La tabla de resultados muestra, por fondo: **% actual, % objetivo, valor actual y aportación sugerida**. Las sugerencias mayores de 0 € se resaltan en verde. Los resultados se recalculan al instante con cada cambio, incluso con objetivos sin guardar.
4. **«Ejecutar rebalanceo»** abre una simulación con las compras necesarias (importe, participaciones y precio). Al confirmar, se crean como transacciones reales de compra.

El algoritmo **nunca propone vender**: reparte la aportación entre los fondos que están por debajo de su objetivo, en proporción a lo que les falta. Su formulación matemática se detalla en [`DOCUMENTACION_TFM.md`](./DOCUMENTACION_TFM.md#4-algoritmo-de-rebalanceo).

## 6. Credenciales de prueba

El comando `npx prisma db seed` crea un usuario de demostración con una cartera de ejemplo (siete operaciones en cinco fondos y un reparto objetivo del 100 %):

| Campo | Valor |
|---|---|
| **Email** | `usuario@test.com` |
| **Contraseña** | `Password123!` |

> ⚠️ Son credenciales de **desarrollo**, públicas en este repositorio. En cualquier base de datos que no sea local, ejecuta el seed con `SEED_DEMO_USER=false` (carga solo el catálogo) y, si este usuario llegó a crearse, elimínalo.
>
> Cada ejecución del seed **recrea** las operaciones y los objetivos de este usuario, por lo que se perderán los cambios que hayas hecho con él. Si prefieres empezar con una cartera vacía, regístrate con tu propio email desde la pantalla de acceso.

## 7. Tests

Todo el proyecto usa **Vitest**. Los tests no necesitan base de datos ni servidor en marcha: el backend sustituye Prisma por una versión simulada y el frontend simula las respuestas de la API.

```bash
npm run test                    # desde la raíz: backend y después frontend
npm run test --prefix backend   # solo backend
npm run test --prefix frontend  # solo frontend
```

Para vigilar cambios mientras desarrollas:

```bash
cd backend      # o cd frontend
npm run test:watch
```

Para ejecutar un archivo concreto o un test por nombre:

```bash
cd backend
npx vitest run src/services/__tests__/rebalance.test.ts
npx vitest run -t "nunca genera aportaciones negativas"
```

**Qué cubren:**

| Proyecto | Tipo | Contenido |
|---|---|---|
| Backend | Unitarios | Cálculo de coste medio y validación de ventas (`portfolio.calc.test.ts`); algoritmo de rebalanceo: cartera 70/30, aportación de 1.000 €, ausencia de aportaciones negativas (`rebalance.test.ts`) |
| Backend | Unitarios | Servicio de precios de mercado con la API externa simulada: respuesta correcta, errores HTTP/429, sin conexión, timeout, respuestas no válidas, divisa distinta del euro, caché, periodo de espera y **recuperación con la última cotización guardada** (`marketData.test.ts`) |
| Backend | Unitarios | Esquemas de validación y política de contraseñas, incluido el límite de 72 bytes (`auth.schemas.test.ts`); servicio de correo: SMTP configurado, puerto por defecto, caída a Ethereal, remitente y propagación de errores (`email.test.ts`) |
| Backend | Integración | Flujo completo de registro, verificación de email (token con caducidad, de un solo uso, reenvío y login denegado con 403), login y rutas protegidas sobre la aplicación Fastify (`auth.test.ts`); recuperación de contraseña: token con caducidad, solo se guarda el hash, respuesta idéntica para emails inexistentes, token caducado o inválido y contraseña débil (`resetPassword.test.ts`); política de CORS con y sin `FRONTEND_URL` (`cors.test.ts`); catálogo y sincronización de precios, con proveedor operativo y caído (`funds.test.ts`); solo se pueden comprar fondos que cotizan (`transactions.test.ts`) |
| Frontend | Unitarios | Cálculo de rebalanceo en el cliente, reparto en céntimos y *parsing* de importes (`rebalance.test.ts`); medidor de fortaleza de contraseña (`PasswordStrengthMeter.test.tsx`) |
| Frontend | Integración | Rutas y sesión (`App.test.tsx`); KPIs, gráfico, tabla de fondos, historial de transacciones y modal de alta (`Dashboard.test.tsx`); recálculo dinámico y ejecución del rebalanceo (`Rebalance.test.tsx`); solicitud y restablecimiento de contraseña (`ResetPassword.test.tsx`); activación de la cuenta con enlace válido, caducado o no válido (`VerifyEmail.test.tsx`); selector de tema claro/oscuro/sistema (`theme.test.tsx`) |

Para comprobar que todo el proyecto está sano antes de entregar: `npm run build` y `npm run test`.

## 8. Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `npm` o `node` «no se reconoce» (Windows) | El PATH de la terminal es anterior a la instalación de Node. Cierra y vuelve a abrir la terminal o VS Code. |
| `ECONNREFUSED` al hacer el seed o al arrancar | PostgreSQL no está en marcha. Ejecuta `docker start gestor-pg` o comprueba `DATABASE_URL`. |
| `Cannot find module './generated/prisma/client.js'` | Falta generar el cliente: `cd backend && npx prisma generate`. |
| El backend no arranca: `JWT_SECRET debe estar definido…` | Falta `backend/.env` o el secreto tiene menos de 32 caracteres. |
| `EADDRINUSE` en el puerto 3001 o 5173 | Ya hay otra instancia en marcha. Ciérrala o cambia `PORT` en `backend/.env`. |
| La web carga pero todo da error de red | El backend no está arrancado, o accedes por una dirección distinta de `http://localhost:5173`. |

## 9. Limitaciones conocidas

- **Solo fondos cotizados:** el catálogo se limita a 11 ETF con cotización real. Los fondos de inversión tradicionales, que no cotizan en bolsa y se valoran una vez al día, no están soportados.
- **Proveedor no oficial:** los precios proceden de la API pública de Yahoo Finance, que no tiene contrato de servicio y puede cambiar o limitar el acceso sin previo aviso. Es el precio de cotización en bolsa, que puede diferir ligeramente del valor liquidativo oficial, y puede tener retraso. Si el proveedor falla, la aplicación sigue funcionando con los últimos precios guardados.
- **ISIN:** son los de fondos reales, pero conviene verificarlos antes de cualquier uso fuera del entorno académico.
- **Precio de las operaciones:** el formulario registra cada transacción al valor liquidativo *actual*, aunque la fecha sea pasada. Por tanto, el precio medio y el P&L de operaciones históricas son aproximados. La API ya admite el precio real; falta exponerlo en el formulario.
- **Historial sin filtros:** el historial de transacciones se muestra completo, sin filtros por fondo, tipo o fechas, y no permite editar ni eliminar operaciones ya registradas.
- **Una sola divisa:** todos los importes se expresan en euros.
- **Fiscalidad y comisiones:** no se modelan.
