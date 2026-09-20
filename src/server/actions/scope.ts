"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setScopeAction(value: string) {
  (await cookies()).set("ggs_brand", value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
