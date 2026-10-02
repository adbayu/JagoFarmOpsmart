import express, { type Request } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  DomainError,
  RateLimitedError,
  errorMessages,
  httpStatus,
} from "../shared/errors.js";
import { uuid } from "../shared/validation.js";
import { consume } from "../modules/inventory/service.js";
import {
  createItem,
  updateItem,
  createLot,
  updateLot,
} from "../modules/inventory/item-service.js";
import {
  getItem,
  listItems,
  getLot,
  listLots,
  listMovements,
  listConsumableOptions,
  listActivityConsumptions,
} from "../modules/inventory/queries.js";
import {
  stockIn,
  adjustStock,
  transferStock,
  disposeStock,
  reverseMovement,
} from "../modules/inventory/movement-service.js";
import { completeSale, cancelSale } from "../modules/sales/service.js";
import {
  listSales,
  getSale,
  listSaleLotOptions,
} from "../modules/sales/queries.js";
import { postHarvest, cancelHarvest } from "../modules/harvest/service.js";
import { listHarvests, getHarvest } from "../modules/harvest/queries.js";
import { getDashboard } from "../modules/analytics/dashboard-queries.js";
import { getProductionAnalytics } from "../modules/analytics/queries.js";
import { getAdvancedAnalytics } from "../modules/analytics/advanced-queries.js";
import { getCycleComparison } from "../modules/analytics/cycle-comparison-queries.js";
import {
  createWasteRecord,
  transitionWasteRecord,
} from "../modules/waste/service.js";
import { getWasteRecord, listWasteRecords } from "../modules/waste/queries.js";
import {
  addMaggotBatchInput,
  addMaggotObservation,
  completeMaggotBatch,
  createMaggotBatch,
  recordMaggotOutput,
  recordMaggotOutputUse,
} from "../modules/maggot/service.js";
import {
  getMaggotBatch,
  listMaggotBatches,
} from "../modules/maggot/queries.js";
import {
  listCircularFeedLots,
  listWaterTransferUnits,
  listWaterTransfers,
} from "../modules/circular/queries.js";
import {
  createWaterTransfer,
  postMaggotOutputToFeed,
} from "../modules/circular/service.js";
import {
  recordPayment,
  recordRefund,
  cancelPayment,
} from "../modules/finance/payment-service.js";
import { getPaymentBalance } from "../modules/finance/payment-queries.js";
import {
  getCycleHpp,
  markCycleCostsComplete,
} from "../modules/finance/hpp-queries.js";
import { createProduct, updateProduct } from "../modules/products/service.js";
import {
  getProduct,
  listProducts,
  listProductItemOptions,
} from "../modules/products/queries.js";
import {
  recordCost,
  correctCost,
  cancelCost,
} from "../modules/finance/cost-service.js";
import {
  getCost,
  listCosts,
  listCostActivities,
} from "../modules/finance/queries.js";
import {
  createFarm,
  updateFarm,
  archiveFarm,
  addFarmMember,
  removeFarmMember,
} from "../modules/farms/service.js";
import {
  getFarm,
  listFarms,
  listFarmMembers,
} from "../modules/farms/queries.js";
import {
  createUnit,
  updateUnit,
  archiveUnit,
} from "../modules/farming/service.js";
import { getUnit, listUnits } from "../modules/farming/queries.js";
import { listFishUnitCycles } from "../modules/farming/unit-queries.js";
import {
  createActivity,
  transitionActivity,
} from "../modules/schedules/service.js";
import { getActivity, listActivities } from "../modules/schedules/queries.js";
import {
  listNotifications,
  markNotificationRead,
} from "../modules/notifications/queries.js";
import {
  createDevice,
  renameDevice,
  revokeDevice,
  rotateDeviceToken,
  setDeviceMetrics,
} from "../modules/iot/service.js";
import {
  listDeviceAlerts,
  listDevices,
  listTelemetryReadings,
} from "../modules/iot/queries.js";
import { setDeviceMetricAlertConfig } from "../modules/iot/alerts.js";
import {
  authenticateAndConsumeRateLimit,
  ingestReadings,
  readBearerToken,
} from "../modules/iot/ingest.js";
import {
  createCommodity,
  createCycle,
  recordObservation,
  transitionCycle,
} from "../modules/farming/cycle-service.js";
import {
  getCycle,
  listCommodities,
  listCycles,
  listObservations,
} from "../modules/farming/cycle-queries.js";
import type { Database } from "./db.js";
import type { createLocalAuth } from "./identity.js";

/** Auth adapter must validate an actual session, never return a user from an unverified header. */
export type ResolveIdentity = (
  request: Request,
) => Promise<{ userId: string } | null>;
export function createApp(
  db: Database,
  resolveIdentity: ResolveIdentity = async () => null,
  auth?: ReturnType<typeof createLocalAuth>,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.post(
    "/api/iot/v1/readings",
    authenticateAndConsumeRateLimit(db),
    express.json({ limit: "128kb" }),
    async (req, res) => {
      const token = readBearerToken(req.get("authorization"));
      if (!token) throw new DomainError("UNAUTHORIZED");
      res.json({ data: await ingestReadings(db, token, req.body) });
    },
  );
  app.use(express.json({ limit: "100kb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", phase: "foundation" });
  });
  if (auth) {
    app.use("/api/auth", auth.router);
    app.use("/api", auth.protectMutation);
  }
  async function requireActor(req: Request): Promise<string> {
    const identity = await resolveIdentity(req);
    if (!identity) throw new DomainError("UNAUTHORIZED");
    return uuid.parse(identity.userId);
  }
  app.get("/api/farms/:farmId/devices", async (req, res) => {
    res.json({
      data: await listDevices(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        { cursor: req.query.cursor, limit: req.query.limit },
      ),
    });
  });
  app.post("/api/farms/:farmId/devices", async (req, res) => {
    res.json({
      data: await createDevice(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.get("Idempotency-Key") ?? "",
        req.body,
      ),
    });
  });
  app.patch("/api/farms/:farmId/devices/:deviceId", async (req, res) => {
    res.json({
      data: await renameDevice(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.deviceId),
        req.get("Idempotency-Key") ?? "",
        req.body,
      ),
    });
  });
  app.put("/api/farms/:farmId/devices/:deviceId/metrics", async (req, res) => {
    res.json({
      data: await setDeviceMetrics(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.deviceId),
        req.get("Idempotency-Key") ?? "",
        req.body,
      ),
    });
  });
  app.put(
    "/api/farms/:farmId/devices/:deviceId/metrics/:metric/alert-config",
    async (req, res) => {
      res.json({
        data: await setDeviceMetricAlertConfig(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.deviceId),
          req.params.metric,
          req.get("Idempotency-Key") ?? "",
          req.body,
        ),
      });
    },
  );
  app.get("/api/farms/:farmId/devices/:deviceId/readings", async (req, res) => {
    res.json({
      data: await listTelemetryReadings(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.deviceId),
        {
          metric: req.query.metric,
          unit: req.query.unit,
          cursor: req.query.cursor,
          limit: req.query.limit,
        },
      ),
    });
  });
  app.get("/api/farms/:farmId/devices/:deviceId/alerts", async (req, res) => {
    res.json({
      data: await listDeviceAlerts(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.deviceId),
        { cursor: req.query.cursor, limit: req.query.limit },
      ),
    });
  });
  app.post(
    "/api/farms/:farmId/devices/:deviceId/token/rotate",
    async (req, res) => {
      res.json({
        data: await rotateDeviceToken(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.deviceId),
          req.get("Idempotency-Key") ?? "",
        ),
      });
    },
  );
  app.post("/api/farms/:farmId/devices/:deviceId/revoke", async (req, res) => {
    res.json({
      data: await revokeDevice(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.deviceId),
        req.get("Idempotency-Key") ?? "",
      ),
    });
  });
  app.get("/api/farms/:farmId/notifications", async (req, res) => {
    res.json({
      data: await listNotifications(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        { limit: req.query.limit, offset: req.query.offset },
      ),
    });
  });
  app.post(
    "/api/farms/:farmId/notifications/:notificationId/read",
    async (req, res) => {
      res.json({
        data: await markNotificationRead(
          db,
          await requireActor(req),
          uuid.parse(req.params.farmId),
          uuid.parse(req.params.notificationId),
        ),
      });
    },
  );
  app.get("/api/farms", async (req, res) => {
    res.json({ data: await listFarms(db, await requireActor(req)) });
  });
  app.get("/api/farms/:farmId/members", async (req, res) => {
    res.json({
      data: await listFarmMembers(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/members", async (req, res) => {
    res.json({
      data: await addFarmMember(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        req.body,
      ),
    });
  });
  app.delete("/api/farms/:farmId/members/:memberId", async (req, res) => {
    res.json({
      data: await removeFarmMember(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.memberId),
        req.body,
      ),
    });
  });
  app.post("/api/farms", async (req, res) => {
    res.json({ data: await createFarm(db, await requireActor(req), req.body) });
  });
  app.get("/api/farms/:farmId", async (req, res) => {
    res.json({
      data: await getFarm(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.patch("/api/farms/:farmId", async (req, res) => {
    res.json({
      data: await updateFarm(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/archive", async (req, res) => {
    res.json({
      data: await archiveFarm(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/units", async (req, res) => {
    res.json({
      data: await listUnits(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/units", async (req, res) => {
    res.json({
      data: await createUnit(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/units/:unitId", async (req, res) => {
    res.json({
      data: await getUnit(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.unitId),
      ),
    });
  });
  app.get("/api/farms/:farmId/units/:unitId/cycles", async (req, res) => {
    res.json({
      data: await listFishUnitCycles(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.unitId),
      ),
    });
  });
  app.patch("/api/farms/:farmId/units/:unitId", async (req, res) => {
    res.json({
      data: await updateUnit(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.unitId),
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/units/:unitId/archive", async (req, res) => {
    res.json({
      data: await archiveUnit(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.unitId),
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/commodities", async (req, res) => {
    res.json({
      data: await listCommodities(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/commodities", async (req, res) => {
    res.json({
      data: await createCommodity(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/cycles", async (req, res) => {
    res.json({
      data: await listCycles(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        req.query.unitId === undefined
          ? undefined
          : uuid.parse(req.query.unitId),
      ),
    });
  });
  app.post("/api/farms/:farmId/cycles", async (req, res) => {
    res.json({
      data: await createCycle(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/cycles/:cycleId", async (req, res) => {
    res.json({
      data: await getCycle(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.cycleId),
      ),
    });
  });
  app.post(
    "/api/farms/:farmId/cycles/:cycleId/transition",
    async (req, res) => {
      res.json({
        data: await transitionCycle(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.cycleId),
          req.body,
        ),
      });
    },
  );
  app.get(
    "/api/farms/:farmId/cycles/:cycleId/observations",
    async (req, res) => {
      res.json({
        data: await listObservations(
          db,
          await requireActor(req),
          uuid.parse(req.params.farmId),
          uuid.parse(req.params.cycleId),
        ),
      });
    },
  );
  app.post(
    "/api/farms/:farmId/cycles/:cycleId/observations",
    async (req, res) => {
      res.json({
        data: await recordObservation(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.cycleId),
          req.body,
        ),
      });
    },
  );
  app.get("/api/farms/:farmId/activities", async (req, res) => {
    res.json({
      data: await listActivities(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        String(req.query.from ?? ""),
        String(req.query.to ?? ""),
      ),
    });
  });
  app.post("/api/farms/:farmId/activities", async (req, res) => {
    res.json({
      data: await createActivity(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/activities/transition", async (req, res) => {
    res.json({
      data: await transitionActivity(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/activities/:activityId", async (req, res) => {
    res.json({
      data: await getActivity(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.activityId),
      ),
    });
  });
  app.get("/api/farms/:farmId/items", async (req, res) => {
    res.json({
      data: await listItems(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        req.query.limit === undefined ? 50 : Number(req.query.limit),
        req.query.offset === undefined ? 0 : Number(req.query.offset),
      ),
    });
  });
  app.post("/api/farms/:farmId/items", async (req, res) => {
    res.json({
      data: await createItem(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/items/:itemId", async (req, res) => {
    res.json({
      data: await getItem(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.itemId),
      ),
    });
  });
  app.patch("/api/farms/:farmId/items/:itemId", async (req, res) => {
    res.json({
      data: await updateItem(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.itemId),
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/items/:itemId/lots", async (req, res) => {
    res.json({
      data: await listLots(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.itemId),
      ),
    });
  });
  app.post("/api/farms/:farmId/lots", async (req, res) => {
    res.json({
      data: await createLot(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/lots/:lotId", async (req, res) => {
    res.json({
      data: await getLot(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.lotId),
      ),
    });
  });
  app.patch("/api/farms/:farmId/lots/:lotId", async (req, res) => {
    res.json({
      data: await updateLot(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.lotId),
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/movements", async (req, res) => {
    res.json({
      data: await listMovements(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        req.query.itemId === undefined
          ? undefined
          : uuid.parse(req.query.itemId),
        req.query.limit === undefined ? 50 : Number(req.query.limit),
        req.query.offset === undefined ? 0 : Number(req.query.offset),
      ),
    });
  });
  app.post("/api/farms/:farmId/movements/stock-in", async (req, res) => {
    res.json({
      data: await stockIn(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/movements/adjust", async (req, res) => {
    res.json({
      data: await adjustStock(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/movements/transfer", async (req, res) => {
    res.json({
      data: await transferStock(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/movements/dispose", async (req, res) => {
    res.json({
      data: await disposeStock(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/movements/reverse", async (req, res) => {
    res.json({
      data: await reverseMovement(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/consumptions", async (req, res) => {
    const identity = await resolveIdentity(req);
    if (!identity) throw new DomainError("UNAUTHORIZED");
    res.json({
      data: await consume(
        db,
        { farmId: uuid.parse(req.params.farmId), actorId: identity.userId },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/consumption-options", async (req, res) => {
    res.json({
      data: await listConsumableOptions(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.get(
    "/api/farms/:farmId/activities/:activityId/consumptions",
    async (req, res) => {
      res.json({
        data: await listActivityConsumptions(
          db,
          await requireActor(req),
          uuid.parse(req.params.farmId),
          uuid.parse(req.params.activityId),
        ),
      });
    },
  );
  app.post("/api/farms/:farmId/sales/complete", async (req, res) => {
    const identity = await resolveIdentity(req);
    if (!identity) throw new DomainError("UNAUTHORIZED");
    res.json({
      data: await completeSale(
        db,
        { farmId: uuid.parse(req.params.farmId), actorId: identity.userId },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/sales", async (req, res) => {
    res.json({
      data: await listSales(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.get("/api/farms/:farmId/dashboard", async (req, res) => {
    res.json({
      data: await getDashboard(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.get("/api/farms/:farmId/finance/hpp/:cycleId", async (req, res) => {
    res.json({
      data: await getCycleHpp(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.cycleId),
      ),
    });
  });
  app.post(
    "/api/farms/:farmId/finance/hpp/:cycleId/cost-complete",
    async (req, res) => {
      res.json({
        data: await markCycleCostsComplete(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.cycleId),
          req.body,
        ),
      });
    },
  );
  app.get("/api/farms/:farmId/analytics/production", async (req, res) => {
    res.json({
      data: await getProductionAnalytics(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        String(req.query.from ?? ""),
        String(req.query.toExclusive ?? ""),
        req.query.cycleId === undefined ? undefined : String(req.query.cycleId),
      ),
    });
  });
  app.get("/api/farms/:farmId/analytics/advanced", async (req, res) => {
    res.json({
      data: await getAdvancedAnalytics(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        String(req.query.from ?? ""),
        String(req.query.toExclusive ?? ""),
      ),
    });
  });
  app.get("/api/farms/:farmId/analytics/cycle-comparison", async (req, res) => {
    res.json({
      data: await getCycleComparison(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        String(req.query.cycleIdA ?? ""),
        String(req.query.cycleIdB ?? ""),
        String(req.query.from ?? ""),
        String(req.query.toExclusive ?? ""),
      ),
    });
  });
  app.get("/api/farms/:farmId/waste", async (req, res) => {
    res.json({
      data: await listWasteRecords(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/waste", async (req, res) => {
    res.json({
      data: await createWasteRecord(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/waste/:wasteId", async (req, res) => {
    res.json({
      data: await getWasteRecord(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.wasteId),
      ),
    });
  });
  app.post("/api/farms/:farmId/waste/:wasteId/transition", async (req, res) => {
    res.json({
      data: await transitionWasteRecord(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.wasteId),
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/maggot/batches", async (req, res) => {
    res.json({
      data: await listMaggotBatches(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/maggot/batches", async (req, res) => {
    res.json({
      data: await createMaggotBatch(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/maggot/batches/:batchId", async (req, res) => {
    res.json({
      data: await getMaggotBatch(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.batchId),
      ),
    });
  });
  app.post(
    "/api/farms/:farmId/maggot/batches/:batchId/inputs",
    async (req, res) => {
      res.json({
        data: await addMaggotBatchInput(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.batchId),
          req.body,
        ),
      });
    },
  );
  app.post(
    "/api/farms/:farmId/maggot/batches/:batchId/observations",
    async (req, res) => {
      res.json({
        data: await addMaggotObservation(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.batchId),
          req.body,
        ),
      });
    },
  );
  app.post(
    "/api/farms/:farmId/maggot/batches/:batchId/outputs",
    async (req, res) => {
      res.json({
        data: await recordMaggotOutput(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.batchId),
          req.body,
        ),
      });
    },
  );
  app.post(
    "/api/farms/:farmId/maggot/batches/:batchId/outputs/:outputId/uses",
    async (req, res) => {
      res.json({
        data: await recordMaggotOutputUse(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.batchId),
          uuid.parse(req.params.outputId),
          req.body,
        ),
      });
    },
  );
  app.post(
    "/api/farms/:farmId/maggot/batches/:batchId/complete",
    async (req, res) => {
      res.json({
        data: await completeMaggotBatch(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.batchId),
          req.body,
        ),
      });
    },
  );
  app.get("/api/farms/:farmId/circular/feed-lots", async (req, res) => {
    res.json({
      data: await listCircularFeedLots(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/circular/maggot-postings", async (req, res) => {
    res.json({
      data: await postMaggotOutputToFeed(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get(
    "/api/farms/:farmId/circular/water-transfer-units/:type",
    async (req, res) => {
      const type = req.params.type;
      if (type !== "fish" && type !== "crop")
        throw new DomainError("NOT_FOUND");
      res.json({
        data: await listWaterTransferUnits(
          db,
          await requireActor(req),
          uuid.parse(req.params.farmId),
          type === "fish" ? "FISH" : "CROP",
        ),
      });
    },
  );
  app.get("/api/farms/:farmId/circular/water-transfers", async (req, res) => {
    res.json({
      data: await listWaterTransfers(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/circular/water-transfers", async (req, res) => {
    res.json({
      data: await createWaterTransfer(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/sales/lot-options", async (req, res) => {
    res.json({
      data: await listSaleLotOptions(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.get("/api/farms/:farmId/sales/:saleId", async (req, res) => {
    res.json({
      data: await getSale(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.saleId),
      ),
    });
  });
  app.get("/api/farms/:farmId/sales/:saleId/payments", async (req, res) => {
    res.json({
      data: await getPaymentBalance(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.saleId),
      ),
    });
  });
  app.post("/api/farms/:farmId/sales/:saleId/payments", async (req, res) => {
    res.json({
      data: await recordPayment(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.saleId),
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/sales/:saleId/refunds", async (req, res) => {
    res.json({
      data: await recordRefund(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.saleId),
        req.body,
      ),
    });
  });
  app.post(
    "/api/farms/:farmId/payments/:paymentId/cancel",
    async (req, res) => {
      res.json({
        data: await cancelPayment(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.paymentId),
          req.body,
        ),
      });
    },
  );
  app.post("/api/farms/:farmId/sales/:saleId/cancel", async (req, res) => {
    res.json({
      data: await cancelSale(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.saleId),
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/costs", async (req, res) => {
    res.json({
      data: await listCosts(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        req.query.limit === undefined ? 50 : Number(req.query.limit),
        req.query.offset === undefined ? 0 : Number(req.query.offset),
      ),
    });
  });
  app.get("/api/farms/:farmId/product-item-options", async (req, res) => {
    res.json({
      data: await listProductItemOptions(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.get("/api/farms/:farmId/harvests", async (req, res) => {
    res.json({
      data: await listHarvests(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/harvests", async (req, res) => {
    res.json({
      data: await postHarvest(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/harvests/:harvestId", async (req, res) => {
    res.json({
      data: await getHarvest(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.harvestId),
      ),
    });
  });
  app.post(
    "/api/farms/:farmId/harvests/:harvestId/cancel",
    async (req, res) => {
      res.json({
        data: await cancelHarvest(
          db,
          {
            actorId: await requireActor(req),
            farmId: uuid.parse(req.params.farmId),
          },
          uuid.parse(req.params.harvestId),
          req.body,
        ),
      });
    },
  );
  app.get("/api/farms/:farmId/products", async (req, res) => {
    res.json({
      data: await listProducts(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/products", async (req, res) => {
    res.json({
      data: await createProduct(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/products/:productId", async (req, res) => {
    res.json({
      data: await getProduct(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.productId),
      ),
    });
  });
  app.patch("/api/farms/:farmId/products/:productId", async (req, res) => {
    res.json({
      data: await updateProduct(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.productId),
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/cost-activities", async (req, res) => {
    res.json({
      data: await listCostActivities(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
      ),
    });
  });
  app.post("/api/farms/:farmId/costs", async (req, res) => {
    res.json({
      data: await recordCost(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        req.body,
      ),
    });
  });
  app.get("/api/farms/:farmId/costs/:costId", async (req, res) => {
    res.json({
      data: await getCost(
        db,
        await requireActor(req),
        uuid.parse(req.params.farmId),
        uuid.parse(req.params.costId),
      ),
    });
  });
  app.post("/api/farms/:farmId/costs/:costId/correct", async (req, res) => {
    res.json({
      data: await correctCost(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.costId),
        req.body,
      ),
    });
  });
  app.post("/api/farms/:farmId/costs/:costId/cancel", async (req, res) => {
    res.json({
      data: await cancelCost(
        db,
        {
          actorId: await requireActor(req),
          farmId: uuid.parse(req.params.farmId),
        },
        uuid.parse(req.params.costId),
        req.body,
      ),
    });
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: errorMessages.NOT_FOUND,
        requestId: res.locals.requestId,
      },
    });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const dbCode =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      const badJson =
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.parse.failed";
      const oversizedBody =
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.too.large";
      if (error instanceof RateLimitedError) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
      }
      const code =
        error instanceof DomainError
          ? error.code
          : oversizedBody
            ? "PAYLOAD_TOO_LARGE"
            : error instanceof ZodError || badJson
              ? "VALIDATION"
              : ["23505", "23503", "23514", "40001", "40P01"].includes(dbCode)
                ? "CONFLICT"
                : "INTERNAL";
      if (code === "INTERNAL")
        console.error("Request failed", {
          requestId: res.locals.requestId,
          code,
        });
      res.status(httpStatus[code]).json({
        error: {
          code,
          message: errorMessages[code],
          requestId: res.locals.requestId,
        },
      });
    },
  );
  return app;
}
