import { randomUUID } from "node:crypto";

export function createHandoffId(): string {
  return randomUUID();
}
