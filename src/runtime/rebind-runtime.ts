import type { RoleRuntimeBinding } from "./create-role-runtime.js";

export async function rebindRuntime(
  binding: RoleRuntimeBinding,
  onSessionBound?: (binding: RoleRuntimeBinding) => Promise<void> | void
): Promise<RoleRuntimeBinding> {
  await binding.rebind();
  await onSessionBound?.(binding);
  return binding;
}
