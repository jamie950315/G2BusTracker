export interface VersionedStoredValue {
  revision: number
  value: unknown
}

function decodeStoredValue(stored: string): VersionedStoredValue | null {
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'revision' in parsed &&
      'value' in parsed &&
      Number.isSafeInteger((parsed as { revision?: unknown }).revision) &&
      Number((parsed as { revision: number }).revision) >= 0
    ) {
      const envelope = parsed as { revision: number; value: unknown }
      return { revision: envelope.revision, value: envelope.value }
    }
    return { revision: 0, value: parsed }
  } catch {
    return null
  }
}

export function chooseNewestStoredValue(
  storedValues: readonly string[],
): VersionedStoredValue | null {
  let newest: VersionedStoredValue | null = null
  for (const stored of storedValues) {
    const candidate = decodeStoredValue(stored)
    if (candidate && (!newest || candidate.revision >= newest.revision)) {
      newest = candidate
    }
  }
  return newest
}

export function encodeStoredValue(value: unknown, revision: number): string {
  return JSON.stringify({ revision, value })
}
