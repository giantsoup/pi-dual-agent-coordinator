/** Release every owned resource, including when an earlier release fails. */
export async function cleanupAll(actions: Array<() => void | Promise<void>>): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Resource cleanup failed.");
}
