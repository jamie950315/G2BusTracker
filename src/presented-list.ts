export class PresentedList<T> {
  #items: readonly T[]

  constructor(items: readonly T[] = []) {
    this.#items = [...items]
  }

  commit(items: readonly T[]): void {
    this.#items = [...items]
  }

  commitIf(items: readonly T[], complete: boolean): boolean {
    if (!complete) return false
    this.commit(items)
    return true
  }

  at(index: number): T | undefined {
    return this.#items[index]
  }

  get length(): number {
    return this.#items.length
  }

  snapshot(): readonly T[] {
    return this.#items
  }
}
