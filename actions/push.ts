"use server";

import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushPublicKey, pushReady, pushTo, subscriptionProblem, type PushKeys } from "@/lib/push";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";

/** The key a browser subscribes with, or nothing when push isn't set up on this server. */
export async function pushKey(): Promise<string> {
  await requireUser();
  return pushReady() ? pushPublicKey() : "";
}

/** Keeps this browser's subscription for the person signed in. A browser moves to whoever signs in on it last. */
export async function savePushSubscription(input: PushKeys): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  if (!pushReady()) return { error: "Notifications aren't set up on this server yet." };
  const subscription = { endpoint: String(input?.endpoint ?? ""), keys: { p256dh: String(input?.keys?.p256dh ?? ""), auth: String(input?.keys?.auth ?? "") } };
  const problem = subscriptionProblem(subscription);
  if (problem) return { error: problem };
  if (!(await consumeRateLimit(`push-subscribe:${user.id}`, 20, 60 * 60 * 1000))) return { error: "Too many tries. Wait a few minutes." };
  const userAgent = ((await requestMeta()).userAgent ?? "").slice(0, 300);
  await prisma.pushSubscription.upsert({ where: { endpoint: subscription.endpoint }, create: { userId: user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent }, update: { userId: user.id, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent } });
  await audit({ actorId: user.id, action: "push.subscribed", entityType: "PushSubscription", entityId: user.id });
  return { ok: true };
}

/** Stops notifications to this browser. */
export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await prisma.pushSubscription.deleteMany({ where: { endpoint: String(endpoint ?? ""), userId: user.id } });
  await audit({ actorId: user.id, action: "push.unsubscribed", entityType: "PushSubscription", entityId: user.id });
  return { ok: true };
}

/** A test notification to every browser the person turned them on in. */
export async function testPush(): Promise<{ sent?: number; error?: string }> {
  const user = await requireUser();
  if (!(await consumeRateLimit(`push-test:${user.id}`, 5, 60 * 60 * 1000))) return { error: "That's enough tests for now. Try again later." };
  const sent = await pushTo(user.id, { title: "LendHous", body: "Notifications are on. You'll hear here when something on your loan needs you.", url: "/admin/account/notifications", tag: "push.test" });
  return sent ? { sent } : { error: "Nothing was sent: turn notifications on in this browser first." };
}
