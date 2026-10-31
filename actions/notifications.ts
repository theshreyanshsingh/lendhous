"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { markAllRead } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export async function markNoticesRead() {
  const user = await requireUser();
  await markAllRead(user);
  revalidatePath("/admin", "layout");
}

export async function saveNoticePreferences(formData: FormData) {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { notifyEmail: formData.get("email") === "on", notifyInApp: formData.get("inApp") === "on" } });
  revalidatePath("/admin", "layout");
}
