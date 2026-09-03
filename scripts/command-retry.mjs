export function runCommandWithRetries({
  run,
  label,
  maxAttempts = 3,
  delaysMs = [1000, 3000],
  sleep = milliseconds => {
    if (milliseconds <= 0) return;
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, milliseconds);
  },
  onRetry = () => {},
}) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts must be a positive integer");

  let lastResult;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = run(attempt);
    lastResult = result;

    if (!result?.error && result?.status === 0) return result;

    // A spawn failure such as ENOENT is local configuration, not a transient
    // registry/network failure. Fail immediately rather than masking it with retries.
    if (result?.error) return result;

    if (attempt < maxAttempts) {
      const delayMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 0;
      onRetry({ attempt, nextAttempt: attempt + 1, maxAttempts, delayMs, label, result });
      sleep(delayMs);
    }
  }

  return lastResult;
}
