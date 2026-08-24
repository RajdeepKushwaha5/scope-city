/** Invalidates slow launch responses when the operator has already stopped. */
export class LaunchGuard {
  #version = 0;

  begin(): number {
    this.#version += 1;
    return this.#version;
  }

  cancel(): void {
    this.#version += 1;
  }

  isCurrent(version: number): boolean {
    return version === this.#version;
  }
}
