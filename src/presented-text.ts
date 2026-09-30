interface TextContent {
  containerID?: number
  containerName?: string
  content?: string
}

// Only remember text that the Host has accepted for the current layout.
export class PresentedText {
  #content = new Map<string, string | undefined>()

  reset(containers: readonly TextContent[] = []): void {
    this.#content.clear()
    for (const container of containers) this.commit(container)
  }

  matches(container: TextContent): boolean {
    const key = this.#key(container)
    return this.#content.has(key) && this.#content.get(key) === container.content
  }

  commit(container: TextContent): void {
    this.#content.set(this.#key(container), container.content)
  }

  #key(container: TextContent): string {
    return `${container.containerID}:${container.containerName}`
  }
}
