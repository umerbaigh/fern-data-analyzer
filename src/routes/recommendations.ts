import { Router } from "express";
import * as recommendationRepo from "../db/repositories/recommendation.repository";
import { enqueueRecommendations } from "../queue";

export const recommendationsRouter = Router();

recommendationsRouter.get("/:tenantId/:userId", async (req, res, next) => {
  try {
    const recs = await recommendationRepo.listRecommendations(
      req.params.tenantId,
      req.params.userId
    );
    res.json({ recommendations: recs });
  } catch (err) {
    next(err);
  }
});

recommendationsRouter.post("/:tenantId/:userId/generate", async (req, res, next) => {
  try {
    const recs = await enqueueRecommendations(req.params.tenantId, req.params.userId);
    res.json({ recommendations: recs });
  } catch (err) {
    next(err);
  }
});

recommendationsRouter.post("/:id/dismiss", async (req, res, next) => {
  try {
    await recommendationRepo.dismissRecommendation(req.params.id);
    res.json({ dismissed: true });
  } catch (err) {
    next(err);
  }
});
