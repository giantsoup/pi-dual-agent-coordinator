import type { Terminal } from "@earendil-works/pi-tui";

export class MemoryTerminal implements Terminal {
  public columns = 80;
  public rows = 24;
  public kittyProtocolActive = false;
  public output = "";
  public input: (data: string) => void = () => {};
  public resize: () => void = () => {};
  public start(input: (data: string) => void, resize: () => void): void { this.input = input; this.resize = resize; }
  public stop(): void {}
  public async drainInput(): Promise<void> {}
  public write(text: string): void { this.output += text; }
  public moveBy(): void {}
  public hideCursor(): void {}
  public showCursor(): void {}
  public clearLine(): void {}
  public clearFromCursor(): void {}
  public clearScreen(): void {}
  public setProgress(): void {}
  public setTitle(): void {}
  public setProgramStatus(): void {}
}
