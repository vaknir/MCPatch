import type { Implementation, Role, VersionedMessage } from "./common.js";

export interface Hello extends VersionedMessage {
  type: "hello";
  role: Role;
  supportedProtocolVersions: number[];
  implementation: Implementation;
}

export interface HelloAck extends VersionedMessage {
  type: "hello_ack";
  selectedProtocolVersion: 1;
  connectionId: string;
  implementation: Implementation;
}
