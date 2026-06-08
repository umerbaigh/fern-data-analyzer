import { Router } from "express";
import { enqueuePoll } from "../queue";
import { runPollCycle } from "../services/poll.service";

export const pollRouter = Router();

pollRouter.post("/:tenantId", async (req, res, next) => {
  try {
    const sync = req.query.sync === "true";
    if (sync) {
      const result = await runPollCycle(req.params.tenantId);
      res.json(result);
      return;
    }
    await enqueuePoll(req.params.tenantId);
    res.json({ enqueued: true });
  } catch (err) {
    next(err);
  }
});
