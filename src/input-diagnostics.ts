export type InputDiagnosticKind = 'event' | 'gesture' | 'lifecycle' | 'bridge' | 'state' | 'probe'

export interface InputDiagnosticFields {
  page?: 'loading' | 'home' | 'favorites' | 'list' | 'detail' | 'route' | 'error'
  active?: boolean
  disposed?: boolean
  envelope?: 'list' | 'text' | 'sys'
  eventType?: number
  source?: number
  containerID?: number
  selectedIndex?: number
  operation?: 'bridge' | 'startup' | 'rebuild' | 'text' | 'image' | 'exit'
  callID?: number
  phase?: 'queued' | 'dispatch' | 'complete' | 'error'
  action?: 'suspend' | 'dispose' | 'resume-request' | 'resumed' | 'pagehide' | 'pageshow'
  result?: boolean | number | null
  persisted?: boolean
  code?: number
}

export interface InputDiagnosticEntry {
  readonly sequence: number
  readonly elapsedMs: number
  readonly kind: InputDiagnosticKind
  readonly fields: Readonly<InputDiagnosticFields>
}

const CAPACITY = 64
const kinds: readonly InputDiagnosticKind[] = ['event', 'gesture', 'lifecycle', 'bridge', 'state', 'probe']
const enumFields = {
  page: ['loading', 'home', 'favorites', 'list', 'detail', 'route', 'error'],
  envelope: ['list', 'text', 'sys'],
  operation: ['bridge', 'startup', 'rebuild', 'text', 'image', 'exit'],
  phase: ['queued', 'dispatch', 'complete', 'error'],
  action: ['suspend', 'dispose', 'resume-request', 'resumed', 'pagehide', 'pageshow'],
} as const
const booleanFields = ['active', 'disposed', 'persisted'] as const
const numberFields = ['eventType', 'source', 'containerID', 'selectedIndex', 'callID', 'code'] as const

function safeFields(fields: InputDiagnosticFields): Readonly<InputDiagnosticFields> {
  const safe: Record<string, string | number | boolean | null> = {}
  if (fields === null || typeof fields !== 'object') return Object.freeze(safe)

  for (const key of Object.keys(enumFields) as Array<keyof typeof enumFields>) {
    if (!Object.hasOwn(fields, key)) continue
    const value = fields[key]
    if (typeof value === 'string' && (enumFields[key] as readonly string[]).includes(value)) safe[key] = value
  }
  for (const key of booleanFields) {
    if (Object.hasOwn(fields, key) && typeof fields[key] === 'boolean') safe[key] = fields[key]
  }
  for (const key of numberFields) {
    const value = Object.hasOwn(fields, key) ? fields[key] : undefined
    if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value
  }
  if (Object.hasOwn(fields, 'result')) {
    const result = fields.result
    if (result === null || typeof result === 'boolean' || (typeof result === 'number' && Number.isFinite(result))) {
      safe.result = result
    }
  }
  return Object.freeze(safe) as Readonly<InputDiagnosticFields>
}

// Local operational state only. No raw events, text content, personal identifiers, location or URLs.
export class InputDiagnostics {
  #entries: Array<InputDiagnosticEntry | undefined> = new Array(CAPACITY)
  #next = 0
  #size = 0
  #sequence = 0
  #started: number
  #elapsedMs = 0
  #now: () => number

  constructor(now: () => number = () => performance.now()) {
    this.#now = now
    const started = now()
    this.#started = Number.isFinite(started) ? started : 0
  }

  record(kind: InputDiagnosticKind, fields: InputDiagnosticFields = {}): void {
    if (!kinds.includes(kind)) return
    const elapsed = this.#now() - this.#started
    if (Number.isFinite(elapsed)) this.#elapsedMs = Math.max(this.#elapsedMs, elapsed, 0)
    this.#entries[this.#next] = Object.freeze({
      sequence: ++this.#sequence,
      elapsedMs: this.#elapsedMs,
      kind,
      fields: safeFields(fields),
    })
    this.#next = (this.#next + 1) % CAPACITY
    this.#size = Math.min(this.#size + 1, CAPACITY)
  }

  snapshot(): readonly InputDiagnosticEntry[] {
    const snapshot: InputDiagnosticEntry[] = []
    const start = (this.#next - this.#size + CAPACITY) % CAPACITY
    for (let index = 0; index < this.#size; index++) {
      const entry = this.#entries[(start + index) % CAPACITY]!
      snapshot.push(Object.freeze({ ...entry, fields: Object.freeze({ ...entry.fields }) }))
    }
    return Object.freeze(snapshot)
  }

  reportLines(): readonly string[] {
    return Object.freeze(this.snapshot().map((entry) => {
      const fields = Object.entries(entry.fields).map(([key, value]) => `${key}=${value}`).join(' ')
      return `#${entry.sequence} +${Math.round(entry.elapsedMs)}ms ${entry.kind}${fields ? ` ${fields}` : ''}`
    }))
  }
}
