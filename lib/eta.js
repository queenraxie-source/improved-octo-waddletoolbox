export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.ceil(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function calculateEta(received, total, elapsedMs, previous = null) {
  if (!received || !total || elapsedMs < 250) return previous ?? null;
  const rate = received / (elapsedMs / 1000);
  const estimate = Math.max(0, (total - received) / Math.max(rate, 1));
  return previous == null ? estimate : (previous * 0.7) + (estimate * 0.3);
}