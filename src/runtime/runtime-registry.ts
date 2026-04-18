import type { Role } from "../types/role.js";
import type { RoleRuntimeBinding } from "./create-role-runtime.js";

export class RuntimeRegistry {
  private readonly bindings = new Map<Role, RoleRuntimeBinding>();

  public get(role: Role): RoleRuntimeBinding | undefined {
    return this.bindings.get(role);
  }

  public set(binding: RoleRuntimeBinding): void {
    this.bindings.set(binding.role, binding);
  }

  public async replace(
    role: Role,
    target:
      | RoleRuntimeBinding
      | ((current: RoleRuntimeBinding | undefined) => Promise<RoleRuntimeBinding>)
  ): Promise<RoleRuntimeBinding> {
    const current = this.bindings.get(role);
    const next = typeof target === "function" ? await target(current) : target;
    if (current && current !== next) {
      await current.dispose();
    }
    this.bindings.set(role, next);
    return next;
  }

  public list(): RoleRuntimeBinding[] {
    return [...this.bindings.values()];
  }

  public async disposeAll(): Promise<void> {
    const bindings = this.list();
    this.bindings.clear();
    for (const binding of bindings) {
      await binding.dispose();
    }
  }
}
