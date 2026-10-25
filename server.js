require("dotenv").config();

const os = require("os");
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const { Client } = require("@gradio/client");

const app = express();
app.use(cors());
app.use(express.json());

// Use OS temporary folder for cloud server (Render.com) compatibility
const upload = multer({ dest: os.tmpdir() });

// Hugging Face Access Token (Uses Environment Variable on Render or fallback)
const HF_TOKEN = process.env.HF_TOKEN;

// List of public IDM-VTON space mirrors
const SPACES = ["yisol/IDM-VTON", "Nymbo/IDM-VTON"];

process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason?.message || reason);
});

app.post(
  "/api/tryon",
  upload.fields([{ name: "fabric" }, { name: "person" }]),
  async (req, res) => {
    let fabricPath = null;
    let personPath = null;

    try {
      const category = req.body.category || "half_sleeve_shirt";

      if (!req.files || !req.files["fabric"] || !req.files["person"]) {
        return res.status(400).json({
          success: false,
          message: "Both fabric and person photos are required.",
        });
      }

      fabricPath = req.files["fabric"][0].path;
      personPath = req.files["person"][0].path;

      const fabricBuffer = fs.readFileSync(fabricPath);
      const personBuffer = fs.readFileSync(personPath);

      const fabricBlob = new Blob([fabricBuffer], { type: "image/jpeg" });
      const personBlob = new Blob([personBuffer], { type: "image/jpeg" });

      // Precise prompts for collared button-down shirts and trousers
      let garmentPrompt =
        "Short sleeve casual button down shirt with collar and front buttons";
      if (category === "full_sleeve_shirt") {
        garmentPrompt =
          "Long sleeve formal button down dress shirt with collar, front buttons, and sleeve cuffs";
      } else if (category === "lower_body") {
        garmentPrompt = "Men formal trousers pants";
      }

      let appClient = null;
      let connectedSpace = "";

      // Connect to primary space or fallback mirror using 'token' parameter
      for (const spaceName of SPACES) {
        try {
          console.log(`🚀 Attempting connection to HF Space: ${spaceName}...`);
          appClient = await Client.connect(spaceName, {
            token: HF_TOKEN,
            space_status: (status) =>
              console.log(`⏳ [${spaceName}] Status:`, status.stage),
          });
          connectedSpace = spaceName;
          break;
        } catch (err) {
          console.warn(`⚠️ Failed to connect to ${spaceName}: ${err.message}`);
        }
      }

      if (!appClient) {
        throw new Error(
          "All public AI spaces are currently busy or rate-limited. Please try again in a few minutes.",
        );
      }

      console.log(`✨ Connected to ${connectedSpace}! Sending photos to AI...`);

      const result = await appClient.predict("/tryon", [
        {
          background: personBlob,
          layers: [],
          composite: null,
        },
        fabricBlob,
        garmentPrompt,
        true, // Auto-mask
        false, // Auto-crop = false (preserves exact face and body proportions)
        25, // Denoising Steps (prevents facial distortions)
        42, // Seed
      ]);

      const imageOutput = result?.data?.[0];
      const imageUrl = imageOutput?.url || imageOutput?.path || imageOutput;

      if (!imageUrl) {
        throw new Error("AI model did not return a valid image output.");
      }

      let finalBuffer;
      if (typeof imageUrl === "string" && imageUrl.startsWith("http")) {
        const imgFetch = await fetch(imageUrl);
        const arrayBuffer = await imgFetch.arrayBuffer();
        finalBuffer = Buffer.from(arrayBuffer);
      } else if (imageOutput?.path && fs.existsSync(imageOutput.path)) {
        finalBuffer = fs.readFileSync(imageOutput.path);
      } else {
        throw new Error("Could not read generated image buffer.");
      }

      const base64Image = finalBuffer.toString("base64");
      const finalDataUrl = `data:image/jpeg;base64,${base64Image}`;

      // Clean up temporary uploads from OS temp folder
      if (fabricPath && fs.existsSync(fabricPath)) fs.unlinkSync(fabricPath);
      if (personPath && fs.existsSync(personPath)) fs.unlinkSync(personPath);

      console.log("✅ Success! Transformed generated AI result to Base64.");

      return res.json({
        success: true,
        outputUrl: finalDataUrl,
      });
    } catch (error) {
      console.error("❌ AI Error:", error.message);

      if (fabricPath && fs.existsSync(fabricPath)) fs.unlinkSync(fabricPath);
      if (personPath && fs.existsSync(personPath)) fs.unlinkSync(personPath);

      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend Server running on port ${PORT}`);
});
