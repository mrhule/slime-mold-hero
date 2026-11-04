import type { Transport } from './client';
import type { ClientMsg, ServerMsg } from './protocol';
import type { Relay, RelayConn } from './relay';

/** a Transport wired straight to a Relay in the same process; used by the tests */
export class MemoryTransport implements Transport {
  onmessage: (m: ServerMsg) => void = () => {};
  onclose: () => void = () => {};
  private isOpen = false;
  /** the relay's end of the pipe */
  private conn: RelayConn = {
    send: (msg) => queueMicrotask(() => this.isOpen && this.onmessage(msg)),
    close: () => this.close(),
  };

  constructor(private relay: Relay) {}

  open(): Promise<void> {
    this.isOpen = true;
    return Promise.resolve();
  }

  send(msg: ClientMsg): void {
    if (this.isOpen) this.relay.handle(this.conn, msg);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.relay.disconnect(this.conn);
    this.onclose();
  }

  /** simulate the network dropping without the client asking to leave */
  drop(): void {
    this.close();
  }
}
