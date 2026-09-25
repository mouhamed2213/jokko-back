import { addMonths } from "date-fns";

export const dateManagement = (currentEndDate?: Date, extendTo?: Date) => {
  const startDate = new Date();
  const endTrialDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const endSubscriptionSate = addMonths(startDate, 1);

  const extendToDate = currentEndDate?.getDate() ?? "" + extendTo?.getDate();

  return {
    startDate,
    endSubscriptionSate,
    endTrialDate,
    extendToDate ,
  };
};
