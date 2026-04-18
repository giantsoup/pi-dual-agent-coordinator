import type { Role } from "../types/role.js";
import type { RoleRuntimeBinding } from "./create-role-runtime.js";

export type RuntimeReplacementAction =
  | { type: "new"; role: Role }
  | { type: "switch"; role: Role; sessionPath: string };

export async function applyRuntimeOperation(
  binding: RoleRuntimeBinding,
  action: RuntimeReplacementAction
): Promise<RoleRuntimeBinding> {
  if (action.type === "new") {
    const result = await binding.runtime.newSession();
    if (result.cancelled) {
      throw new Error(`Runtime replacement cancelled for role ${binding.role}`);
    }
    await binding.rebind();
    return binding;
  }

  const result = await binding.runtime.switchSession(action.sessionPath);
  if (result.cancelled) {
    throw new Error(`Runtime switch cancelled for role ${binding.role}`);
  }
  await binding.rebind();
  return binding;
}
