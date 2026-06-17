import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import type { AppConfig } from "./config";
import { registerCleanupRoutes } from "./routes/cleanup";
import { registerPublisherRoutes } from "./routes/publisher";
import { registerViewerRoutes } from "./routes/viewer";
import type { ArtifactRepository } from "./storage/artifactRepository";
import type { ObjectStore } from "./storage/objectStore";

export type AppDependencies = {
  repo: ArtifactRepository;
  objectStore: ObjectStore;
  config: AppConfig;
  now?: () => Date;
};

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cookieParser());
  app.use(express.json({ limit: dependencies.config.maxHtmlBytes }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  registerPublisherRoutes(app, {
    ...dependencies,
    now: dependencies.now ?? (() => new Date())
  });
  registerViewerRoutes(app, {
    ...dependencies,
    now: dependencies.now ?? (() => new Date())
  });
  registerCleanupRoutes(app, {
    ...dependencies,
    now: dependencies.now ?? (() => new Date())
  });

  return app;
}
