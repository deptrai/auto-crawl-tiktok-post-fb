export async function waitFor<T>(
  fn: () => Promise<T>,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<T> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      return await fn()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}
