require("dotenv").config();
const express = require("express");
const studentRoutes = require("./routes/studentRoutes");
const aiRoutes = require("./routes/aiRoutes");
const errorHandler = require("./middleware/errorHandler");
const { languageMiddleware } = require("./middleware/languageMiddleware");
const { languageInterceptor } = require("./middleware/translationMiddleware");

const { startCafeteriaPreScrapeSchedule } = require("./services/preScrapeCafeteriaService");
const { startProgramTranslationWarmSchedule } = require("./services/extracurricularProgramService");

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function getAllowedCorsOrigins() {
  const fromEnv = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return fromEnv.length > 0 ? fromEnv : DEFAULT_CORS_ORIGINS;
}

// Standard Middlewares
app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedCorsOrigins();

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept-Language",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});
// No auth, no DB, no side effects — the only job here is to answer fast so an
// external pinger can keep the free-tier instance from sleeping. Placed before
// every other middleware so a cold instance responds as quickly as possible,
// and so a ping never depends on Supabase being reachable.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(languageMiddleware);
app.use(express.static("public"));
app.use(languageInterceptor);

app.use("/api/students", studentRoutes);
app.use("/api/ai", aiRoutes);

// Register the error handler AFTER all routes
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hey! PNU backend running on http://0.0.0.0:${PORT}`);
    startCafeteriaPreScrapeSchedule();
    startProgramTranslationWarmSchedule();
  });
}

module.exports = app;
