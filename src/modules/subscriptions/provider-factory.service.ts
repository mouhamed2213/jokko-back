import { PaymentMethod } from "../../database/prisma/generated/prisma/enums.js";
import { NotFoundError } from "../../utils/errors.js";
import { WaveProvider } from "./wave-provider.service.js";

export const ProviderFactory = {
  getProvider: (provider: PaymentMethod) => {
    switch (provider) {
      case "WAVE":
        return WaveProvider
      case "IN_APP":
        
      default:
        throw new NotFoundError(`Payment provider  is not supported`);
    }
  },
};
