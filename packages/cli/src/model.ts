import type {
  DeclarativePackBuild,
  SyntheticDocument,
} from "@mcpatch/sdk/declarative";

export const PACK_SOURCE_FILE = "mcpatch.pack.json";
export const PACK_SOURCE_VERSION = 1 as const;

export interface LoadedPackSource {
  readonly bytes: Uint8Array;
  readonly sourcePath: string;
  readonly targetDirectory: string;
}

export interface PreparedPack {
  readonly build: DeclarativePackBuild;
  readonly sourcePath: string;
  readonly targetDirectory: string;
}

export interface SyntheticNodeRef {
  readonly node: SyntheticDocument["root"];
}
