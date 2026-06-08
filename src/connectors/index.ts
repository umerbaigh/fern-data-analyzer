import type { Connector } from "./base";
import { SlackConnector } from "./slack.connector";
import { GmailConnector } from "./gmail.connector";
import { TranscriptConnector } from "./transcript.connector";

export function createConnectors(): Connector[] {
  return [
    new SlackConnector(),
    new GmailConnector(),
    new TranscriptConnector(),
  ];
}
