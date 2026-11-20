import { app } from "./app.js";
import { env } from "./config/env-config.js";
import { logger } from "./config/logger.js";
import { SubscriptionLifecycleService } from "./modules/subscriptions/subscription-lifecycle.service.js";

const runSubscriptionExpirationJob = () => {
  SubscriptionLifecycleService.processExpiredSubscriptions()
    .then(({ checked, downgraded }) => {
      if (downgraded > 0) {
        logger.info(
          `Subscription expiration job: ${downgraded}/${checked} boutique(s) rétrogradée(s) vers Essentielle.`,
        );
      }
    })
    .catch((error) => logger.error("Subscription expiration job failed", error));
};

// Protection cluster : n'exécute la tâche planifiée que sur l'instance principale (instance 0 sous PM2)
const isPrimaryWorker =
  !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";

if (isPrimaryWorker) {
  runSubscriptionExpirationJob();
  setInterval(runSubscriptionExpirationJob, 15 * 60 * 1000);
}

app.listen(env.port, () => {
  logger.info(`✅ Jokko Business API démarrée sur ${env.server}:${env.port}`);
  logger.info(`🌍 Environnement : ${env.mode}`);
});
