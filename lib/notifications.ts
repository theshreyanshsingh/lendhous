// The in-app notices lib/email.ts saves, read back for the person they went to.
import { readField } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

type Person = { id: string; email: string };

const forPerson = (person: Person) => ({ OR: [{ userId: person.id }, { toEmail: person.email }] });
// On MongoDB `readAt: null` only matches a stored null, and a new notice has no readAt at all (see notDeleted).
const unread = { OR: [{ readAt: null }, { readAt: { isSet: false } }] };

export const unreadCount = (person: Person) => prisma.notification.count({ where: { AND: [forPerson(person), unread] } });

export const noticeContext = (field: "subject" | "body", id: string) => `Notification.${field}:${id}`;

const opened = <T extends { id: string; subject: string; body: string }>(notice: T) => ({ ...notice, subject: readField(notice.subject, noticeContext("subject", notice.id)), body: readField(notice.body, noticeContext("body", notice.id)) });

/** The newest notices, and every unread one however old, so nothing unread falls off the page. */
export async function recentNotices(person: Person, take = 150) {
  const [recent, older] = await Promise.all([
    prisma.notification.findMany({ where: forPerson(person), orderBy: { createdAt: "desc" }, take }),
    prisma.notification.findMany({ where: { AND: [forPerson(person), unread] }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const seen = new Set(recent.map((notice) => notice.id));
  return [...recent, ...older.filter((notice) => !seen.has(notice.id))].map(opened);
}

export const markAllRead = (person: Person) => prisma.notification.updateMany({ where: { AND: [forPerson(person), unread] }, data: { readAt: new Date() } });

/** Marks the given notices read, and only the person's own. */
export const markRead = (person: Person, ids: string[]) => prisma.notification.updateMany({ where: { AND: [forPerson(person), unread, { id: { in: ids.slice(0, 500) } }] }, data: { readAt: new Date() } });

/** One of the person's notices, or null. */
export const noticeFor = (person: Person, id: string) => prisma.notification.findFirst({ where: { AND: [forPerson(person), { id }] }, select: { id: true, link: true, readAt: true } });
