import { resolve } from "node:path";

export function reservePath(cwd: string, candidate: string): string {
  return resolve(cwd, candidate);
}
