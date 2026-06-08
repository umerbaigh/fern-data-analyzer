import { Router } from "express";
import * as issueRepo from "../db/repositories/issue.repository";
import type { DataSource } from "../types/events";
import type { IssueStatus } from "../types/issues";

export const issuesRouter = Router();

issuesRouter.get("/:tenantId", async (req, res, next) => {
  try {
    const status = req.query.status as IssueStatus | undefined;
    const source = req.query.source as DataSource | undefined;
    const issues = await issueRepo.listIssues(req.params.tenantId, status, source);
    res.json({ source: source ?? "all", issues });
  } catch (err) {
    next(err);
  }
});

issuesRouter.patch("/:issueId", async (req, res, next) => {
  try {
    const { status, ownerGuess } = req.body as {
      status?: IssueStatus;
      ownerGuess?: string;
    };
    const issue = await issueRepo.updateIssue(req.params.issueId, { status, ownerGuess });
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json({ issue });
  } catch (err) {
    next(err);
  }
});
