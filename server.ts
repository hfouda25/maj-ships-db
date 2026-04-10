import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for sending verification code
  app.post("/api/send-verification", async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required" });
    }

    if (!email.toLowerCase().endsWith("@jamaicaships.com")) {
      return res.status(403).json({ error: "Unauthorized email domain" });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev";

    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not set in environment variables.");
      return res.status(500).json({ 
        error: "Email service not configured. Please set RESEND_API_KEY in the app settings.",
        isConfigError: true
      });
    }

    const resend = new Resend(resendApiKey);

    try {
      const { data, error } = await resend.emails.send({
        from: `MAJ Security <${fromAddress}>`,
        to: [email],
        subject: "MAJ Database Verification Code",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #0f172a; text-align: center;">Maritime Authority of Jamaica</h2>
            <p style="color: #475569; font-size: 16px;">You are attempting to access the Large Ships Database. Please use the following verification code to complete your login:</p>
            <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0f172a;">${code}</span>
            </div>
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">If you did not request this code, please ignore this email or contact the system administrator.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="color: #94a3b8; font-size: 10px; text-align: center;">Authorized Personnel Only • Secure Connection</p>
          </div>
        `,
      });

      if (error) {
        console.error("Resend Error:", error);
        // Check for specific domain verification error
        if (error.message.includes("domain is not verified")) {
          return res.status(403).json({ 
            error: `The domain '${fromAddress.split('@')[1]}' is not verified in Resend.`,
            isDomainError: true,
            suggestedFrom: "onboarding@resend.dev"
          });
        }
        return res.status(500).json({ error: "Failed to send email. " + error.message });
      }

      res.json({ success: true, message: "Email sent successfully" });
    } catch (err) {
      console.error("Server Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
