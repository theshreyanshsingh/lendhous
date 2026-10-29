import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { homeFor } from "@/lib/permissions";

export default async function Home() {
  const user = await requireUser();
  redirect(homeFor(user.roleCodes));
}
