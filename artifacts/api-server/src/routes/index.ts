import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { requireAuth } from "../middlewares/requireAuth";
import businessRouter from "./business";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(businessRouter);

export default router;
