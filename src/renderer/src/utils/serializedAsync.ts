export function createSerializedAsyncRunner<TArgs extends unknown[]>(
  worker: (...args: TArgs) => Promise<void> | void
): (...args: TArgs) => Promise<void> {
  let inFlight: Promise<void> | null = null
  let pendingArgs: TArgs | null = null

  const drain = async (initialArgs: TArgs) => {
    let nextArgs: TArgs | null = initialArgs
    while (nextArgs) {
      const currentArgs = nextArgs
      nextArgs = null
      await worker(...currentArgs)
      if (pendingArgs) {
        nextArgs = pendingArgs
        pendingArgs = null
      }
    }
  }

  return (...args: TArgs) => {
    if (inFlight) {
      pendingArgs = args
      return inFlight
    }
    inFlight = drain(args).finally(() => {
      inFlight = null
    })
    return inFlight
  }
}
