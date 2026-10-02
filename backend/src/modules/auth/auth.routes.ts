import bcrypt from "bcryptjs";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../db.js";
import { validationError } from "../../lib/http.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import type { AuthResponseDto, AuthUserDto, ErrorResponseDto } from "./auth.types.js";

const BCRYPT_ROUNDS = 12;
// Hash válido de relleno: evita distinguir "usuario no existe" por tiempo de respuesta.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);

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

  app.get("/me", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(401).send({ error: "No autenticado" });
    return toUserDto(user);
  });
};

export default authRoutes;
