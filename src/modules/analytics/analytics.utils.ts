import { BadRequestError } from "../../utils/errors.js";
import type { AnalyticsPeriod, AnalyticsPeriodQuery } from "./analytics.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIOD_DAYS = 30;
export const DORMANT_PRODUCT_DAYS = 30;
export const INACTIVE_CUSTOMER_DAYS = 60;
export const FAST_ROTATION_THRESHOLD = 0.75;
export const SLOW_ROTATION_THRESHOLD = 0.25;
export const INSIGHT_REVENUE_CHANGE_THRESHOLD = 10;
export const INSIGHT_CONCENTRATION_THRESHOLD = 60;

const startOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const endOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
};

const parseDate = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError(`Date ${field} invalide`);
  }
  return date;
};

export const parseAnalyticsPeriod = (
  query: AnalyticsPeriodQuery,
  now = new Date(),
): AnalyticsPeriod => {
  const endDate = query.endDate
    ? endOfDay(parseDate(query.endDate, "de fin"))
    : endOfDay(now);
  const startDate = query.startDate
    ? startOfDay(parseDate(query.startDate, "de début"))
    : startOfDay(new Date(endDate.getTime() - (DEFAULT_PERIOD_DAYS - 1) * DAY_MS));

  if (startDate > endDate) {
    throw new BadRequestError("La date de début doit précéder la date de fin");
  }

  const duration = endDate.getTime() - startDate.getTime() + 1;
  return {
    startDate,
    endDate,
    previousStartDate: new Date(startDate.getTime() - duration),
    previousEndDate: new Date(startDate.getTime() - 1),
  };
};

export const isComparisonRequested = (value?: string) =>
  value === "true" || value === "1";

export const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const percentageChange = (current: number, previous: number) => {
  if (previous === 0) return null;
  return roundMoney(((current - previous) / previous) * 100);
};

export const getSalesGranularity = (period: AnalyticsPeriod) => {
  const days =
    (period.endDate.getTime() - period.startDate.getTime()) / DAY_MS;
  if (days <= 2) return "hour";
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
};

export const getProductSalesStatus = (
  productCreatedAt: Date,
  lastSaleAt: Date | null,
  endDate: Date,
  rotation: number,
) => {
  const productAge =
    endDate.getTime() - productCreatedAt.getTime();
  if (!lastSaleAt && productAge < DORMANT_PRODUCT_DAYS * DAY_MS) {
    return "NEW";
  }
  if (
    !lastSaleAt ||
    endDate.getTime() - lastSaleAt.getTime() > DORMANT_PRODUCT_DAYS * DAY_MS
  ) {
    return "DORMANT";
  }
  if (rotation >= FAST_ROTATION_THRESHOLD) return "FAST";
  if (rotation <= SLOW_ROTATION_THRESHOLD) return "SLOW";
  return "REGULAR";
};

export const getCustomerStatus = (
  customerCreatedAt: Date,
  lastOrderAt: Date | null,
  endDate: Date,
) => {
  if (
    !lastOrderAt &&
    endDate.getTime() - customerCreatedAt.getTime() <
      INACTIVE_CUSTOMER_DAYS * DAY_MS
  ) {
    return "NEW";
  }
  if (
    !lastOrderAt ||
    endDate.getTime() - lastOrderAt.getTime() >
      INACTIVE_CUSTOMER_DAYS * DAY_MS
  ) {
    return "INACTIVE";
  }
  return "ACTIVE";
};
