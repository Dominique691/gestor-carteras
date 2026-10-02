import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db.js";
import { validationError } from "../../lib/http.js";
import { sendResetPasswordEmail } from "../../services/email.service.js";
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "./auth.schemas.js";
import type { AuthResponseDto, AuthUserDto, ErrorResponseDto, MessageResponseDto } from "./auth.types.js";

const BCRYPT_ROUNDS = 12;
// Hash válido de relleno: evita distinguir "usuario no existe" por tiempo de respuesta.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);

export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const FORGOT_MESSAGE = "Si el email existe en nuestro sistema, recibirás un enlace de recuperación";

/** En base de datos solo se guarda el hash del token: una fuga de la BD no permite restablecer cuentas. */
export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");

const toUserDto = (u: { id: string; email: string; createdAt: Date }): AuthUserDto => ({
  id: u.id,
  email: u.email,
  createdAt: u.createdAt.toISOString(),
});

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (request, reply): Promise<AuthResponseDto | ErrorResponseDto> => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }
    const { email, password } = parsed.data;

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
      const user = await prisma.user.create({ data: { email, passwordHash } });
      const token = app.jwt.sign({ sub: user.id, email: user.email });
      return reply.code(201).send({ token, user: toUserDto(user) });
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

      const baseUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      if (process.env.NODE_ENV !== "production") {
        request.log.info(`Enlace de restablecimiento para ${user.email}: ${resetUrl}`);
      }
      // Sin await: el tiempo de respuesta no debe delatar si el email existe.
      sendResetPasswordEmail(user.email, resetUrl).catch((err) =>
        request.log.error({ err }, "No se pudo enviar el email de recuperación"),
      );
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
      },
    });
    return { message: "Contraseña actualizada correctamente" };
  });

  app.get("/me", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(401).send({ error: "No autenticado" });
    return toUserDto(user);
  });
};

export default authRoutes;
