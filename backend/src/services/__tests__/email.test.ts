import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendMail: vi.fn(async () => ({})),
  createTransport: vi.fn(),
  createTestAccount: vi.fn(),
}));
vi.mock("nodemailer", () => {
  mail.createTransport.mockImplementation(() => ({ sendMail: mail.sendMail }));
  return {
    default: {
      createTransport: mail.createTransport,
      createTestAccount: mail.createTestAccount,
      getTestMessageUrl: () => false,
    },
  };
});

const load = async () => {
  vi.resetModules();
  return import("../email.service.js");
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) vi.stubEnv(k, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("email.service", () => {
  it("usa el SMTP configurado con puerto numérico", async () => {
    vi.stubEnv("SMTP_HOST", "smtp-relay.brevo.com");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "login@smtp-brevo.com");
    vi.stubEnv("SMTP_PASS", "clave");
    const { sendResetPasswordEmail } = await load();

    await sendResetPasswordEmail("ana@example.com", "https://app/reset?token=abc");

    expect(mail.createTestAccount).not.toHaveBeenCalled();
    expect(mail.createTransport).toHaveBeenCalledWith({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: { user: "login@smtp-brevo.com", pass: "clave" },
    });
  });

  it("usa 587 si SMTP_PORT falta o no es numérico", async () => {
    vi.stubEnv("SMTP_HOST", "h");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");
    vi.stubEnv("SMTP_PORT", "abc");
    const { sendResetPasswordEmail } = await load();
    await sendResetPasswordEmail("a@b.com", "https://x");
    expect(mail.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587 }));
  });

  it("sin variables SMTP cae a Ethereal", async () => {
    mail.createTestAccount.mockResolvedValue({
      user: "eu",
      pass: "ep",
      smtp: { host: "smtp.ethereal.email", port: 587, secure: false },
    });
    const { sendResetPasswordEmail } = await load();
    await sendResetPasswordEmail("a@b.com", "https://x");
    expect(mail.createTestAccount).toHaveBeenCalledOnce();
    expect(mail.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.ethereal.email" }));
  });

  it("remitente: SMTP_FROM, o SMTP_USER por defecto", async () => {
    const { getFromAddress } = await load();
    vi.stubEnv("SMTP_USER", "login@smtp-brevo.com");
    expect(getFromAddress()).toBe("Gestor de Carteras <login@smtp-brevo.com>");
    vi.stubEnv("SMTP_FROM", "Yo <yo@gmail.com>");
    expect(getFromAddress()).toBe("Yo <yo@gmail.com>");
  });

  it("propaga el error de envío para que la ruta lo capture", async () => {
    vi.stubEnv("SMTP_HOST", "h");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");
    mail.sendMail.mockRejectedValueOnce(new Error("535 auth failed"));
    const { sendResetPasswordEmail } = await load();
    await expect(sendResetPasswordEmail("a@b.com", "https://x")).rejects.toThrow("535");
  });
});
