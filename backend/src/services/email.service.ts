import nodemailer, { type Transporter } from "nodemailer";

let transporter: Promise<Transporter> | null = null;

/** SMTP real si hay SMTP_HOST/USER/PASS; si no, cuenta de pruebas de Ethereal (solo desarrollo). */
function getTransporter(): Promise<Transporter> {
  if (!transporter) {
    const created = (async () => {
      const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT } = process.env;
      if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
        const port = Number(SMTP_PORT) || 587;
        return nodemailer.createTransport({
          host: SMTP_HOST,
          port,
          secure: port === 465,
          auth: { user: SMTP_USER, pass: SMTP_PASS },
        });
      }
      const account = await nodemailer.createTestAccount();
      return nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
    })();
    // Si falla la creación (p. ej. sin red) se permite reintentar en el siguiente envío.
    created.catch(() => {
      transporter = null;
    });
    transporter = created;
  }
  return transporter;
}

/** Remitente: SMTP_FROM o, en su defecto, la cuenta SMTP_USER. */
export function getFromAddress(): string {
  const { SMTP_FROM, SMTP_USER } = process.env;
  if (SMTP_FROM) return SMTP_FROM;
  return SMTP_USER ? `Gestor de Carteras <${SMTP_USER}>` : '"Gestor de Carteras" <no-reply@gestor-carteras.local>';
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface ActionEmail {
  title: string;
  intro: string;
  button: string;
  footer: string;
  url: string;
}

/** Plantilla común: título, texto, botón con el enlace y el enlace en claro por si el botón no funciona. */
function actionEmailHtml({ title, intro, button, footer, url: rawUrl }: ActionEmail): string {
  const url = escapeHtml(rawUrl);
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px;max-width:100%">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
        <p style="font-size:14px;line-height:1.5;margin:0 0 24px">${intro}</p>
        <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:bold">${button}</a></p>
        <p style="font-size:12px;color:#71717a;line-height:1.5;margin:0">${footer}<br>Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${url}</span></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export const resetPasswordHtml = (resetUrl: string) =>
  actionEmailHtml({
    title: "Restablece tu contraseña",
    intro:
      "Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Gestor de Carteras. El enlace caduca en 15 minutos.",
    button: "Restablecer contraseña",
    footer: "Si no lo has solicitado, ignora este correo: tu contraseña no cambiará.",
    url: resetUrl,
  });

export const verifyEmailHtml = (verifyUrl: string) =>
  actionEmailHtml({
    title: "Confirma tu email",
    intro:
      "Gracias por registrarte en Gestor de Carteras. Confirma tu dirección de correo para activar la cuenta. El enlace caduca en 24 horas.",
    button: "Activar cuenta",
    footer: "Si no has creado esta cuenta, ignora este correo.",
    url: verifyUrl,
  });

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  const info = await (await getTransporter()).sendMail({ from: getFromAddress(), to, subject, text, html });
  console.info(
    `[email] Enviado a ${to}: id=${info.messageId} aceptados=${JSON.stringify(info.accepted)} rechazados=${JSON.stringify(info.rejected)} respuesta="${info.response}"`,
  );
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.info(`[email] Vista previa (Ethereal): ${preview}`);
}

export const sendResetPasswordEmail = (email: string, resetUrl: string) =>
  sendEmail(
    email,
    "Restablece tu contraseña",
    `Para restablecer tu contraseña abre este enlace (caduca en 15 minutos): ${resetUrl}`,
    resetPasswordHtml(resetUrl),
  );

export const sendVerificationEmail = (email: string, verifyUrl: string) =>
  sendEmail(
    email,
    "Activa tu cuenta de Gestor de Carteras",
    `Para activar tu cuenta abre este enlace (caduca en 24 horas): ${verifyUrl}`,
    verifyEmailHtml(verifyUrl),
  );
