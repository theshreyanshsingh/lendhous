import { requirePermission } from "@/lib/auth";
import { isOwner } from "@/lib/member-rules";
import { notDeleted, prisma } from "@/lib/prisma";
import { MembersBoard, type MemberRow } from "./members-board";

export const metadata = { title: "Members" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const me = await requirePermission("manage_users");
  const users = await prisma.user.findMany({ where: notDeleted, include: { roles: true }, orderBy: { createdAt: "asc" }, take: 500 });
  const rows: MemberRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    title: user.title ?? "",
    roles: user.roles.map((row) => row.role),
    extraPermissions: user.extraPermissions,
    deniedPermissions: user.deniedPermissions,
    signedIn: Boolean(user.lastLoginAt),
  }));
  return <MembersBoard rows={rows} meId={me.id} meIsOwner={isOwner(me.roleCodes)} />;
}
