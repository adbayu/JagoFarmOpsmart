import type {
  CycleStatus,
  FarmingType,
  Metric,
  MoneyMinor,
  Quantity,
  Unit,
} from "../../shared/domain.js";
export type AnalyticsScope = {
  farmId: string;
  cycleId?: string;
  from: string;
  toExclusive: string;
};
export type ProductionPoint = {
  commodityId: string;
  commodityName: string;
  unit: Unit;
  quantity: Quantity;
};
export type FinancialSummary = {
  recordedCosts: MoneyMinor;
  completedSalesValue: MoneyMinor;
  revenue: Metric<MoneyMinor>;
  hpp: Metric<MoneyMinor>;
  profit: Metric<MoneyMinor>;
  sources: {
    paymentIds: string[];
    hppPaymentIds: string[];
    refundIds: string[];
    saleIds: string[];
    costIds: string[];
    harvestIds: string[];
    movementIds: string[];
  };
};
// Dashboard queries compose operational projections; financial policy stays in finance/.
export type DashboardSummary = {
  activeUnits: Record<"FISH" | "CHICKEN" | "CROP", number>;
  activeCycles: number;
  upcomingActivityCount: number;
  todayActivities: {
    id: string;
    kind: string;
    status: string;
    scheduledAt: string;
    cycleName: string;
  }[];
  recentActivities: {
    id: string;
    kind: string;
    status: string;
    scheduledAt: string;
    cycleName: string;
  }[];
  production: ProductionPoint[];
  finance: FinancialSummary;
  monthlyRecordedCosts: MoneyMinor;
  asOf: string;
};
export type ProductionAnalytics = {
  from: string;
  toExclusive: string;
  asOf: string;
  rows: {
    cycleId: string;
    cycleName: string;
    commodityId: string;
    commodityName: string;
    farmingType: string;
    unit: Unit;
    quantity: Quantity;
    harvestCount: number;
  }[];
  survival: Metric<string>;
  growth: Metric<string>;
  feedEfficiency: Metric<string>;
  revenue: Metric<MoneyMinor>;
  hpp: Metric<MoneyMinor>;
  profit: Metric<MoneyMinor>;
  financeSources: {
    paymentIds: string[];
    hppPaymentIds: string[];
    refundIds: string[];
    saleIds: string[];
    costIds: string[];
    harvestIds: string[];
    movementIds: string[];
  };
};

export type AdvancedAnalytics = {
  from: string;
  toExclusive: string;
  asOf: string;
  productionTrend: {
    period: string;
    commodityId: string;
    commodityName: string;
    unit: Unit;
    quantity: Quantity;
    harvestCount: number;
    harvestIds: string[];
  }[];
  recordedCostBreakdown: {
    category: string;
    treatment: string;
    amountMinor: MoneyMinor;
    entryCount: number;
    costIds: string[];
  }[];
  recordedWaterTransfers: {
    period: string;
    sourceUnitId: string;
    sourceUnitName: string;
    targetUnitId: string;
    targetUnitName: string;
    quantityLiters: Quantity;
    transferCount: number;
    transferIds: string[];
  }[];
  maggotWasteInputs: {
    period: string;
    unit: Unit;
    quantity: Quantity;
    inputCount: number;
    inputIds: string[];
    wasteIds: string[];
    batchIds: string[];
  }[];
  maggotOutputs: {
    period: string;
    unit: Unit;
    quantity: Quantity;
    outputCount: number;
    outputIds: string[];
    batchIds: string[];
  }[];
};

export type CycleComparison = {
  from: string;
  toExclusive: string;
  asOf: string;
  cycles: {
    cycleId: string;
    name: string;
    farmingType: FarmingType;
    status: CycleStatus;
    startDate: string;
    commodityId: string;
    commodityName: string;
    production: {
      commodityId: string;
      commodityName: string;
      unit: Unit;
      quantity: Quantity;
      harvestCount: number;
      harvestIds: string[];
    }[];
    costs: {
      category: string;
      treatment: string;
      amountMinor: MoneyMinor;
      entryCount: number;
      costIds: string[];
    }[];
  }[];
};
