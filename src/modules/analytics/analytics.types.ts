export type AnalyticsPeriod = {
  startDate: Date;
  endDate: Date;
  previousStartDate: Date;
  previousEndDate: Date;
};

export type AnalyticsPeriodQuery = {
  startDate?: string;
  endDate?: string;
  compare?: string;
};

export type AnalyticsSalesQuery = AnalyticsPeriodQuery & {
  limit?: string;
};

export type AnalyticsProductsQuery = AnalyticsPeriodQuery & {
  limit?: string;
};

export type AnalyticsStockQuery = AnalyticsPeriodQuery & {
  limit?: string;
};

export type AnalyticsCustomersQuery = AnalyticsPeriodQuery & {
  limit?: string;
};

export type AnalyticsCashQuery = AnalyticsPeriodQuery;

export type AnalyticsTrendsQuery = AnalyticsPeriodQuery;

export type AnalyticsInsightsQuery = AnalyticsPeriodQuery;

export type AnalyticsCost = {
  amount: number;
  source: "HISTORICAL" | "ESTIMATED";
};
