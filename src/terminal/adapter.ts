export interface TerminalAdapter {
  name: string;
  openPane(taskId: string, cwd: string): Promise<string>;
  runInPane(paneId: string, command: string): Promise<void>;
  waitForExit(paneId: string): Promise<number>;
  closePane(paneId: string): Promise<void>;
  cleanup(): Promise<void>;
}
