"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { CHOICES, readChoices, TOPICS, type NoticeChoices } from "@/lib/notice-topics";
import { markAllRead, markRead } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export async function markNoticesRead() {
  const user = await requireUser();
  await markAllRead(user);
  revalidatePath("/admin", "layout");
}

/** One loan's notices, or one notice: the ids come from the page, and only the person's own are touched. */
export async function markGroupRead(formData: FormData) {
  const user = await requireUser();
  const ids = String(formData.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length) await markRead(user, ids);
  revalidatePath("/admin", "layout");
}

export async function saveNoticePreferences(formData: FormData) {
  const user = await requireUser();
  // Topics not on the form (another workspace's) keep what they were.
  const topics: NoticeChoices = { ...readChoices(user.noticeTopics) };
  for (const topic of Object.keys(TOPICS) as (keyof typeof TOPICS)[]) {
    const choice = formData.get(`topic.${topic}`);
    if (typeof choice === "string" && choice in CHOICES) topics[topic] = choice as keyof typeof CHOICES;
  }
  await prisma.user.update({ where: { id: user.id }, data: { notifyEmail: formData.get("email") === "on", notifyInApp: formData.get("inApp") === "on", noticeTopics: topics } });
  revalidatePath("/admin", "layout");
}
