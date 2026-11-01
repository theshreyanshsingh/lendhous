// The in-app notices lib/email.ts saves, read back for the person they went to.
import { readField } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

type Person = { id: string; email: string };

const forPerson = (person: Person) => ({ OR: [{ userId: person.id }, { toEmail: person.email }] });
// On MongoDB `readAt: null` only matches a stored null, and a new notice has no readAt at all (see notDeleted).
const unread = { OR: [{ readAt: null }, { readAt: { isSet: false } }] };

export const unreadCount = (person: Person) => prisma.notification.count({ where: { AND: [forPerson(person), unread] } });

export const noticeContext = (field: "subject" | "body", id: string) => `Notification.${field}:${id}`;

export async function recentNotices(person: Person) {
  const notices = await prisma.notification.findMany({ where: forPerson(person), orderBy: { createdAt: "desc" }, take: 100 });
  return notices.map((notice) => ({ ...notice, subject: readField(notice.subject, noticeContext("subject", notice.id)), body: readField(notice.body, noticeContext("body", notice.id)) }));
}

export const markAllRead = (person: Person) => prisma.notification.updateMany({ where: { AND: [forPerson(person), unread] }, data: { readAt: new Date() } });
