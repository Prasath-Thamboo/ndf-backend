import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";

dotenv.config();

import userRoutes from "./routes/user.routes.js";
import expenseRoutes from "./routes/expense.routes.js"; // ← ajout

const app = express();
app.use(cors());
app.use(express.json());

// Auth
app.use("/api/auth", userRoutes);

// Notes de frais
app.use("/api/expenses", expenseRoutes); // ← ajout

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("JWT_SECRET =", process.env.JWT_SECRET);
    app.listen(4000, () =>
      console.log("Backend running on http://localhost:4000")
    );
  })
  .catch((err) => console.error(err));
