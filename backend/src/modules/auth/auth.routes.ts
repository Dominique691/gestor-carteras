import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "../../db.js";
import { validationError } from "../../lib/http.js";
import { sendResetPasswordEmail, sendVerificationEmail } from "../../services/email.service.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.schemas.js";
import type { AuthResponseDto, AuthUserDto, ErrorResponseDto, MessageResponseDto } from "./auth.types.js";

const BCRYPT_ROUNDS = 12;
// Hash válido de relleno: evita distinguir "usuario no existe" por tiempo de respuesta.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);

export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const FORGOT_MESSAGE = "Si el email existe en nuestro sistema, recibirás un enlace de recuperación";

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_MESSAGE = "Si hay una cuenta pendiente de verificar con ese email, recibirás un nuevo enlace de activación";
export const UNVERIFIED_MESSAGE =
  "Debes verificar tu email antes de iniciar sesión. Revisa tu bandeja de entrada o solicita un nuevo enlace de activación.";

/** En base de datos solo se guarda el hash del token: una fuga de la BD no permite restablecer ni activar cuentas. */
export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");

const frontendUrl = (path: string, token: string) =>
  `${(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "")}${path}?token=${token}`;

/** Token de activación nuevo: devuelve el token en claro (para el enlace) y los campos a guardar. */
function newVerificationToken() {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    data: {
      emailVerificationToken: hashResetToken(token),
      emailVerificationExpires: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    },
  };
}

/** Envía el enlace de activación sin bloquear la respuesta; un fallo solo se registra en el log. */
function sendVerification(request: FastifyRequest, email: string, token: string) {
  const verifyUrl = frontendUrl("/verify-email", token);
  if (process.env.NODE_ENV !== "production") {
    request.log.info(`Enlace de verificación para ${email}: ${verifyUrl}`);
  }
  sendVerificationEmail(email, verifyUrl).catch((err) =>
    request.log.error({ err }, "No se pudo enviar el email de verificación"),
  );
}

export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;
export const DEMO_MAX_PER_IP = 10;
const DEMO_WINDOW_MS = 60 * 60 * 1000;
// Valor que no es un hash bcrypt válido: ninguna contraseña lo satisface, la cuenta demo solo se abre vía /demo.
const UNUSABLE_PASSWORD_HASH = "!cuenta-demo-sin-contrasena";

const toUserDto = (u: { id: string; email: string; createdAt: Date }): AuthUserDto => ({
  id: u.id,
  email: u.email,
  createdAt: u.createdAt.toISOString(),
});

const authRoutes: FastifyPluginAsync = async (app) => {
  // Límite por IP en memoria (se reinicia con el servidor): basta para evitar que se llene la BD de cuentas demo.
  const demoHits = new Map<string, number[]>();

  // Cada visita recibe una cuenta nueva y vacía; no hay contraseña ni datos compartidos entre visitantes.
  app.post("/demo", async (request, reply): Promise<AuthResponseDto | ErrorResponseDto> => {
    const now = Date.now();
    for (const [ip, hits] of demoHits) {
      const recent = hits.filter((t) => now - t < DEMO_WINDOW_MS);
      if (recent.length) demoHits.set(ip, recent);
      else demoHits.delete(ip);
    }
    const hits = demoHits.get(request.ip) ?? [];
    if (hits.length >= DEMO_MAX_PER_IP) {
      return reply.code(429).send({ error: "Demasiadas demos desde esta conexión. Inténtalo más tarde." });
    }
    demoHits.set(request.ip, [...hits, now]);

    // Limpieza oportunista de demos caducadas (las tablas relacionadas se borran en cascada).
    await prisma.user.deleteMany({ where: { isDemo: true, createdAt: { lt: new Date(now - DEMO_TTL_MS) } } });

    const user = await prisma.user.create({
      data: {
        email: `demo-${randomBytes(6).toString("hex")}@demo.invalid`,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        isEmailVerified: true,
        isDemo: true,
      },
    });
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return { token, user: toUserDto(user) };
  });

  // El registro no inicia sesión: la cuenta queda pendiente hasta abrir el enlace enviado por email.
  app.post("/register", async (request, reply): Promise<MessageResponseDto | ErrorResponseDto> => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }
    const { email, password } = parsed.data;

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
      const { token, data } = newVerificationToken();
      const user = await prisma.user.create({ data: { email, passwordHash, ...data } });
      sendVerification(request, user.email, token);
      return reply.code(201).send({
        message: `Te hemos enviado un email a ${user.email} para activar tu cuenta. El enlace caduca en 24 horas.`,
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return reply.code(409).send({ error: "El email ya está registrado" });
      }
      throw err;
    }
  });

  app.post("/login", async (request, reply): Promise<AuthResponseDto | ErrorResponseDto> => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return reply.code(401).send({ error: "Credenciales incorrectas" });
    }
    // Solo tras comprobar la contraseña: sin ella no se revela si una cuenta está pendiente de verificar.
    if (!user.isEmailVerified) {
      return reply.code(403).send({ error: UNVERIFIED_MESSAGE });
    }

    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return { token, user: toUserDto(user) };
  });

  app.post("/forgot-password", async (request, reply): Promise<MessageResponseDto | ErrorResponseDto> => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user) {
      const token = randomBytes(32).toString("hex");
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: hashResetToken(token),
          resetPasswordExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const resetUrl = frontendUrl("/reset-password", token);
      if (process.env.NODE_ENV !== "production") {
        request.log.info(`Enlace de restablecimiento para ${user.email}: ${resetUrl}`);
      }
      // Sin await: el tiempo de respuesta no debe delatar si el email existe.
      sendResetPasswordEmail(user.email, resetUrl).catch((err) =>
        request.log.error({ err }, "No se pudo enviar el email de recuperación"),
      );
    } else {
      request.log.info("forgot-password: no hay usuario con ese email, no se envía correo");
    }
    // Misma respuesta exista o no el usuario (evita enumeración).
    return { message: FORGOT_MESSAGE };
  });

  app.post("/reset-password", async (request, reply): Promise<MessageResponseDto | ErrorResponseDto> => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }
    const { token, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { resetPasswordToken: hashResetToken(token) } });
    if (!user?.resetPasswordExpires || user.resetPasswordExpires.getTime() < Date.now()) {
      return reply.code(400).send({ error: "El enlace no es válido o ha caducado" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        resetPasswordToken: null,
        resetPasswordExpires: null,
        // Abrir el enlace enviado al email demuestra que es suyo: la cuenta queda verificada.
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    });
    return { message: "Contraseña actualizada correctamente" };
  });

  app.post("/verify-email", async (request, reply): Promise<MessageResponseDto | ErrorResponseDto> => {
    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }

    const user = await prisma.user.findUnique({
      where: { emailVerificationToken: hashResetToken(parsed.data.token) },
    });
    if (!user) {
      return reply.code(400).send({ error: "El enlace de activación no es válido o ya se ha usado" });
    }
    // 410 distingue la caducidad para que el cliente ofrezca pedir un enlace nuevo.
    if (!user.emailVerificationExpires || user.emailVerificationExpires.getTime() < Date.now()) {
      return reply.code(410).send({ error: "El enlace de activación ha caducado. Solicita uno nuevo." });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true, emailVerificationToken: null, emailVerificationExpires: null },
    });
    return { message: "Email verificado. Ya puedes iniciar sesión." };
  });

  app.post("/resend-verification", async (request, reply): Promise<MessageResponseDto | ErrorResponseDto> => {
    const parsed = resendVerificationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user && !user.isEmailVerified) {
      const { token, data } = newVerificationToken();
      await prisma.user.update({ where: { id: user.id }, data });
      sendVerification(request, user.email, token);
    }
    // Misma respuesta en todos los casos (evita enumeración).
    return { message: RESEND_MESSAGE };
  });

  app.get("/me", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(401).send({ error: "No autenticado" });
    return toUserDto(user);
  });
};

export default authRoutes;
