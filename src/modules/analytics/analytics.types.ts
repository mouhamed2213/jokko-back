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
  page?: string;
  pageSize?: string;
  status?: string;
  stockStatus?: string;
  costSource?: string;
  sort?: string;
};

export type AnalyticsStockQuery = AnalyticsPeriodQuery & {
  limit?: string;
  page?: string;
  pageSize?: string;
  status?: string;
  stockStatus?: string;
  sort?: string;
};

export type AnalyticsCustomersQuery = AnalyticsPeriodQuery & {
  limit?: string;
  page?: string;
  pageSize?: string;
  status?: string;
  recurrent?: string;
  sort?: string;
};

export type AnalyticsCashQuery = AnalyticsPeriodQuery & {
  page?: string;
  pageSize?: string;
  type?: string;
  paymentMethod?: string;
  category?: string;
};

export type AnalyticsTrendsQuery = AnalyticsPeriodQuery;

export type AnalyticsInsightsQuery = AnalyticsPeriodQuery & {
  page?: string;
  pageSize?: string;
  type?: string;
  severity?: string;
};

export type AnalyticsCost = {
  amount: number;
  source: "HISTORICAL" | "ESTIMATED";
};
