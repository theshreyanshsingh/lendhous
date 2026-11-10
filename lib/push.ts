// Notifications on a person's phone or computer (Web Push, RFC 8030 with VAPID and encrypted payloads, RFC 8291/8292),
// alongside the email and the in-app copy (lib/email.ts). Someone turns them on in a browser; that browser's subscription
// is kept here, and each notification they'd get goes to it too. Only the loan number and what happened go out, like the
// email, and the payload is encrypted for that browser alone. A subscription the push service says is gone is dropped.
import { sendNotification } from "web-push";
import { prisma } from "./prisma";

export const pushPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";
export const pushReady = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/**
 * The push services browsers use. A subscription's endpoint must be one of them: the server posts to it, so anything else
 * would let someone aim the server at an address of their choosing.
 */
const PUSH_SERVICE = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
export const pushEndpointOk = (endpoint: string) => PUSH_SERVICE.test(endpoint) && endpoint.length <= 1000;
const KEY = /^[A-Za-z0-9_-]+={0,2}$/;
export type PushKeys = { endpoint: string; keys: { p256dh: string; auth: string } };
/** Why a browser's subscription can't be kept, or null. */
export function subscriptionProblem(input: PushKeys) {
  if (!pushEndpointOk(input.endpoint)) return "That browser's push service isn't one we send to.";
  if (!KEY.test(input.keys.p256dh) || input.keys.p256dh.length < 80 || input.keys.p256dh.length > 100) return "That subscription's key isn't valid.";
  if (!KEY.test(input.keys.auth) || input.keys.auth.length < 16 || input.keys.auth.length > 32) return "That subscription's key isn't valid.";
  return null;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/** A notification's words for a lock screen: its subject, and the body's first paragraph without the sign-in link. */
export function pushMessage(subject: string, body: string, url: string, tag?: string): PushMessage {
  const first = body.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return { title: subject.slice(0, 90), body: first.length > 180 ? `${first.slice(0, 177).trimEnd()}…` : first, url: url.startsWith("/") ? url : "/admin", ...(tag ? { tag } : {}) };
}

/** Sends to every browser the person turned notifications on in. Returns how many took it; never throws. */
export async function pushTo(userId: string, message: PushMessage) {
  if (!pushReady()) return 0;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  for (const item of subscriptions) {
    try {
      await sendNotification({ endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } }, JSON.stringify(message), {
        vapidDetails: { subject: process.env.VAPID_SUBJECT || "mailto:servicing@lendhous.com", publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
        TTL: 24 * 3600,
      });
      sent++;
      await prisma.pushSubscription.update({ where: { id: item.id }, data: { lastSentAt: new Date() } });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // Gone or never valid: the browser unsubscribed or the person cleared it. Anything else is tried again next time.
      if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: item.id } }).catch(() => {});
      else console.error(`[lendhous-push] couldn't send to a subscription (${status ?? "no response"})`);
    }
  }
  return sent;
}
