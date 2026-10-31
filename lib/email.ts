// Mail, ported from UPB Capital's lib/email.ts: Resend, then SMTP, then the server log, and always an in-app notice.
// Lendhous adds legal notices (Spec v3 12.1 "(L)"), which go out whatever the user's preferences say.
import { notDeleted, prisma } from "@/lib/prisma";
import { deliverable, deskRecipients, resolveMailTransport, type MailTransport } from "@/lib/mail-config";

async function deliver(transport: MailTransport, toEmail: string, subject: string, body: string) {
  const from = process.env.EMAIL_FROM || "Lendhous <team@localhost>";
  if (transport === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [toEmail], subject, text: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Resend ${response.status}: ${detail.slice(0, 300)}`);
    }
    return;
  }
  if (transport === "smtp") {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || "" } : undefined,
    });
    await transporter.sendMail({ from, to: toEmail, subject, text: body });
  }
}

export async function notify(toEmail: string, subject: string, body: string, options: { eventCode?: string; legal?: boolean } = {}) {
  const user = await prisma.user.findUnique({ where: { email: toEmail }, select: { id: true, notifyEmail: true, notifyInApp: true } });
  const legal = Boolean(options.legal);
  const sendEmail = legal || !user || user.notifyEmail;
  const keepInApp = legal || !user || user.notifyInApp;
  if (!sendEmail && !keepInApp) return;
  const transport = deliverable(toEmail) ? resolveMailTransport() : "log";
  let delivery: string = sendEmail ? transport : "skipped";
  if (sendEmail && transport === "log") {
    console.info(`[lendhous-mail] to=${toEmail} subject=${subject}\n${body}`);
  } else if (sendEmail) {
    try {
      await deliver(transport, toEmail, subject, body);
    } catch (error) {
      delivery = "failed";
      console.error(`[lendhous-mail] ${transport} failed for ${toEmail}:`, error);
      console.info(`[lendhous-mail] to=${toEmail} subject=${subject}\n${body}`);
    }
  }
  if (!keepInApp) return;
  await prisma.notification.create({ data: { toEmail, userId: user?.id, subject, body, delivery, legal, eventCode: options.eventCode ?? "" } });
}

/**
 * For mail that carries something live, a sign-in code or a password link. It skips notify(), so the secret never sits
 * in the notifications table or, when delivery fails, in the log. Returns how it went so the screen can say so.
 */
async function sendSecret(toEmail: string, subject: string, body: string): Promise<"sent" | "logged" | "failed"> {
  const transport = deliverable(toEmail) ? resolveMailTransport() : "log";
  if (transport === "log") {
    console.info(`[lendhous-mail] to=${toEmail} subject=${subject}\n${body}`);
    return "logged";
  }
  try {
    await deliver(transport, toEmail, subject, body);
    return "sent";
  } catch (error) {
    console.error(`[lendhous-mail] ${transport} failed for ${toEmail}:`, error);
    return "failed";
  }
}

export async function sendLoginCode(toEmail: string, code: string) {
  const outcome = await sendSecret(toEmail, "Your LendHous sign-in code", `Your LendHous sign-in code is ${code}. It expires in ten minutes.\n\nIf you didn't try to sign in, someone may have your password. Contact your LendHous administrator.`);
  return outcome !== "failed";
}

export function sendPasswordLink(toEmail: string, link: string, reason: { invitedBy: string; roles: string } | "admin" | "self") {
  const invited = typeof reason === "object";
  const opening = invited ? `${reason.invitedBy} added you to LendHous as ${reason.roles}.` : reason === "admin" ? "Your LendHous administrator sent you a new password link." : "Someone asked to reset the password on your LendHous account.";
  return sendSecret(toEmail, invited ? "You're invited to LendHous" : "Set a new LendHous password", `${opening}\n\nSet your password here:\n${link}\n\nThe link works once and expires in seven days. If you weren't expecting this, ignore it and nothing changes.`);
}

/** Team alerts go to every approved owner-admin, and to TEAM_EMAIL when it is set. */
export async function notifyTeam(subject: string, body: string, eventCode = "") {
  const owners = await prisma.user.findMany({
    where: { accountStatus: "APPROVED", ...notDeleted, roles: { some: { role: "ADMIN_OWNER" } } },
    select: { email: true },
  });
  const recipients = deskRecipients(owners.map((owner) => owner.email), process.env.TEAM_EMAIL);
  if (!recipients.length) console.warn(`[lendhous-mail] no team recipient for ${subject}`);
  for (const email of recipients) await notify(email, subject, body, { eventCode });
}
