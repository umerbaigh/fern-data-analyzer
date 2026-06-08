import type { ConnectorResult, DataSource, PollCursor } from "../types/events";

export interface Connector {
  source: DataSource;
  poll(cursor: PollCursor): Promise<ConnectorResult>;
}
