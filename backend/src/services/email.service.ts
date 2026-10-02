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

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function resetPasswordHtml(resetUrl: string): string {
  const url = escapeHtml(resetUrl);
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px;max-width:100%">
      <tr><td>
        <h1 style="font-size:20px;margin:0 0 16px">Restablece tu contraseña</h1>
        <p style="font-size:14px;line-height:1.5;margin:0 0 24px">Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Gestor de Carteras. El enlace caduca en 15 minutos.</p>
        <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:bold">Restablecer contraseña</a></p>
        <p style="font-size:12px;color:#71717a;line-height:1.5;margin:0">Si no lo has solicitado, ignora este correo: tu contraseña no cambiará.<br>Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${url}</span></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function sendResetPasswordEmail(email: string, resetUrl: string): Promise<void> {
  const info = await (await getTransporter()).sendMail({
    from: process.env.SMTP_FROM ?? '"Gestor de Carteras" <no-reply@gestor-carteras.local>',
    to: email,
    subject: "Restablece tu contraseña",
    text: `Para restablecer tu contraseña abre este enlace (caduca en 15 minutos): ${resetUrl}`,
    html: resetPasswordHtml(resetUrl),
  });
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.info(`[email] Vista previa (Ethereal): ${preview}`);
}
