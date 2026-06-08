import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error("Request error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
}
