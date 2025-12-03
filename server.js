import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import userRoutes from "./routes/user.routes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/users", userRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    app.listen(4000, () =>
      console.log("Backend running on http://localhost:4000")
    );
  })
  .catch((err) => console.error(err));
