// 🔥 CHARGER DOTENV AVANT TOUT
import "./load-env.js";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import userRoutes from "./routes/user.routes.js";
import expenseRoutes from "./routes/expense.routes.js";
import scanRoutes from "./routes/scan.routes.js";

const app = express();

app.use(cors());

app.use(express.json());

// Routes
app.use("/api/auth", userRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/scan", scanRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(process.env.PORT || 4000, () =>
      console.log("Backend running on http://localhost:4000")
    );
  })
  .catch(console.error);
