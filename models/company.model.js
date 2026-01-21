// models/company.model.js
import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // manager principal (créateur)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // code d’invitation simple (ex: X7K4Q2)
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },

    // réglages éventuels (extensible)
    settings: {
      autoApproveSolo: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Company", companySchema);
