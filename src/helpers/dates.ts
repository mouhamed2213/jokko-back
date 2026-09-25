import { addMonths } from "date-fns";

export const dateManagement = () => {
  const startDate = new Date();
  const endTrialDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const endSubscriptionSate = addMonths(startDate, 1);

  return {
    startDate,
    endSubscriptionSate,
    endTrialDate,
  };
};

