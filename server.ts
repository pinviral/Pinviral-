import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";
import validator from "validator";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import googleTrends from "google-trends-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("pinviral.db");
const JWT_SECRET = process.env.JWT_SECRET || "pinviral-secret-key-123";

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    pinterest_token TEXT,
    pinterest_refresh_token TEXT,
    pinterest_token_expires_at DATETIME
  );
`);

// Migration: Add password column if it doesn't exist (for safety)
try {
  db.prepare("ALTER TABLE users ADD COLUMN password TEXT").run();
} catch (e) {
  // Column likely already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS trending_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE NOT NULL,
    source TEXT,
    category TEXT,
    momentum_score REAL,
    search_volume INTEGER,
    related_keywords TEXT,
    historical_data TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generated_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    source_url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    image_url TEXT,
    status TEXT DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS metadata_cache (
    url TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    image TEXT,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.userId = decoded.userId;
      next();
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  // API Routes
  app.post("/api/auth/signup", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    if (!validator.isEmail(email)) return res.status(400).json({ error: "Invalid email" });

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = db.prepare("INSERT INTO users (email, password) VALUES (?, ?)").run(email, hashedPassword);
      const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: "7d" });
      res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "none" });
      res.json({ success: true, userId: result.lastInsertRowid });
    } catch (e: any) {
      if (e.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "Email already exists" });
      }
      res.status(500).json({ error: "Signup failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "none" });
    res.json({ success: true, userId: user.id });
  });

  app.get("/api/auth/me", authenticate, (req: any, res) => {
    const user = db.prepare("SELECT id, email, pinterest_token FROM users WHERE id = ?").get(req.userId) as any;
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      id: user.id,
      email: user.email,
      isConnected: !!user.pinterest_token
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token");
    res.json({ success: true });
  });

  app.get("/api/health", (req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ status: "error", database: "disconnected" });
    }
  });

  app.get("/api/trends", (req, res) => {
    const q = req.query.q as string;
    let trends;
    if (q) {
      trends = db.prepare("SELECT * FROM trending_keywords WHERE keyword LIKE ? ORDER BY momentum_score DESC LIMIT 20").all(`%${q}%`);
    } else {
      trends = db.prepare("SELECT * FROM trending_keywords ORDER BY momentum_score DESC LIMIT 20").all();
    }
    res.json(trends);
  });

// Helper to fetch real Google Trends data
async function fetchRealTrends(keyword: string) {
  try {
    const results = await Promise.all([
      googleTrends.interestOverTime({ keyword, startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }),
      googleTrends.relatedQueries({ keyword })
    ]);

    const interestOverTime = JSON.parse(results[0]);
    const relatedQueries = JSON.parse(results[1]);

    // Process historical data
    const timelineData = interestOverTime.default.timelineData;
    const history = timelineData.map((item: any) => ({
      date: item.formattedTime,
      value: item.value[0]
    }));

    // Calculate momentum (slope of last few points)
    const lastPoint = history[history.length - 1]?.value || 0;
    const prevPoint = history[history.length - 2]?.value || 0;
    const momentum = Math.min(100, Math.max(0, 50 + (lastPoint - prevPoint) * 2));

    // Process related keywords
    const related = relatedQueries.default.rankedList[0]?.rankedKeyword.map((k: any) => k.query).slice(0, 5) || [];

    return {
      momentum_score: Math.round(momentum),
      search_volume: Math.round(lastPoint * 1000), // Estimate based on relative interest
      related,
      history
    };
  } catch (error) {
    console.error("Google Trends API failed:", error);
    return null;
  }
}

  app.get("/api/trending/search", async (req, res) => {
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: "Query required" });

    // 1. Check DB for recent data (10 minutes)
    const existing = db.prepare(`
      SELECT * FROM trending_keywords 
      WHERE keyword = ? AND last_updated > datetime('now', '-10 minutes')
    `).get(q) as any;

    if (existing) {
      return res.json({ 
        ...existing, 
        related_keywords: JSON.parse(existing.related_keywords || "[]"),
        historical_data: JSON.parse(existing.historical_data || "[]")
      });
    }

    // 2. Try fetching real data first
    let realData = await fetchRealTrends(q);
    
    // 3. Use Gemini for enrichment (or full fallback)
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || "" });
      const model = "gemini-3-flash-preview";
      
      // Adjust prompt based on whether we have real data
      const prompt = realData 
        ? `Act as a Pinterest Trends expert. I have Google Trends data for "${q}": Momentum ${realData.momentum_score}, Related: ${realData.related.join(", ")}.
           Provide:
           - A specific category (e.g., Home Decor, Tech, DIY, Fashion).
           - Refined related trending keywords specific to Pinterest (mix with Google ones).
           - Estimated monthly search volume on Pinterest (realistic numbers).
           Return ONLY a raw JSON object: { "category": string, "pinterest_volume": number, "pinterest_related": string[] }`
        : `Act as a Pinterest and Google Trends analyzer. Generate realistic, high-quality trend data for the keyword: "${q}". 
           Provide:
           - A momentum score (0-100) based on current rising interest.
           - Estimated monthly search volume (realistic numbers).
           - A specific category (e.g., Home Decor, Tech, DIY, Fashion).
           - 5 highly relevant related trending keywords.
           - 7 data points for a historical trend graph (last 7 days), each point being { "date": string, "value": number }.
           Return ONLY a raw JSON object: { "momentum_score": number, "search_volume": number, "category": string, "related": string[], "history": Array<{date: string, value: number}> }`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      let text = response.text || "{}";
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const aiData = JSON.parse(text);
      
      // Merge data
      const finalData = {
        category: aiData.category || "General",
        momentum_score: realData ? realData.momentum_score : (aiData.momentum_score || 50),
        search_volume: realData ? (realData.search_volume + (aiData.pinterest_volume || 0)) / 2 : (aiData.search_volume || 1000),
        related: realData ? [...new Set([...realData.related, ...(aiData.pinterest_related || [])])].slice(0, 8) : (aiData.related || []),
        history: realData ? realData.history : (aiData.history || [])
      };

      // 4. Store in DB
      db.prepare(`
        INSERT OR REPLACE INTO trending_keywords (keyword, source, category, momentum_score, search_volume, related_keywords, historical_data, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        q, 
        realData ? "Google Trends + AI" : "Trends AI", 
        finalData.category, 
        finalData.momentum_score, 
        finalData.search_volume, 
        JSON.stringify(finalData.related),
        JSON.stringify(finalData.history)
      );

      const result = db.prepare("SELECT * FROM trending_keywords WHERE keyword = ?").get(q) as any;
      res.json({ 
        ...result, 
        related_keywords: finalData.related,
        historical_data: finalData.history
      });
    } catch (error: any) {
      console.error("Trend search failed:", error);
      
      // TIER 3 FALLBACK: Pure Mock Data
      // If APIs fail (likely quota exceeded), return deterministic mock data
      const mockHistory = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return {
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: 40 + Math.floor(Math.random() * 60) // Random value 40-100
        };
      });

      const fallbackData = {
        keyword: q,
        source: "Fallback",
        category: "General",
        momentum_score: 72,
        search_volume: 12500,
        related_keywords: [`${q} ideas`, `${q} aesthetic`, `best ${q}`, `${q} diy`, `${q} trends`],
        historical_data: mockHistory
      };

      // Store fallback data to prevent immediate retries
      try {
        db.prepare(`
          INSERT OR REPLACE INTO trending_keywords (keyword, source, category, momentum_score, search_volume, related_keywords, historical_data, last_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
          q, 
          "Fallback", 
          fallbackData.category, 
          fallbackData.momentum_score, 
          fallbackData.search_volume, 
          JSON.stringify(fallbackData.related_keywords),
          JSON.stringify(fallbackData.historical_data)
        );
      } catch (dbError) {
        console.error("DB Save failed:", dbError);
      }

      res.json(fallbackData);
    }
  });

  // Pinterest OAuth
  app.get("/api/auth/url", (req, res) => {
    const clientId = process.env.PINTEREST_CLIENT_ID || "SnapChefAi";
    
    // CRITICAL FIX: Use the runtime APP_URL environment variable provided by the platform.
    // This ensures the callback URL matches the actual container URL, not localhost.
    // If APP_URL is missing (local dev), fallback to request host.
    let appUrl = process.env.APP_URL;
    
    if (!appUrl) {
      const host = req.get('host');
      const protocol = req.protocol;
      appUrl = `${protocol}://${host}`;
    }
    
    // Remove trailing slash if present
    appUrl = appUrl.replace(/\/$/, "");
    
    const redirectUri = `${appUrl}/auth/callback`;
    
    console.log("Generating OAuth URL with redirect_uri:", redirectUri);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "boards:read,pins:read,pins:write",
      // state: "optional_state_string" // Good practice to add state for security
    });

    const authUrl = `https://www.pinterest.com/oauth/?${params.toString()}`;
    res.json({ url: authUrl });
  });

  app.get("/auth/callback", (req, res) => {
    const { code } = req.query;
    const token = req.cookies.token;
    
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const userId = decoded.userId;
        
        // Simulate exchanging code for token and saving it
        db.prepare("UPDATE users SET pinterest_token = ? WHERE id = ?").run("mock_pinterest_token", userId);
        
        res.send(`
          <html>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', code: '${code}' }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              </script>
              <p>Authentication successful. This window should close automatically.</p>
            </body>
          </html>
        `);
      } catch (e) {
        res.status(401).send("Unauthorized");
      }
    } else {
      res.status(401).send("Unauthorized");
    }
  });

  // Pin Management
  app.get("/api/pins", (req, res) => {
    const pins = db.prepare("SELECT * FROM generated_pins ORDER BY created_at DESC").all();
    res.json(pins);
  });

  app.post("/api/pins", (req, res) => {
    const { source_url, title, description, image_url, status } = req.body;
    const result = db.prepare(
      "INSERT INTO generated_pins (source_url, title, description, image_url, status) VALUES (?, ?, ?, ?, ?)"
    ).run(source_url, title, description, image_url, status || 'draft');
    res.json({ id: result.lastInsertRowid });
  });

  app.patch("/api/pins/:id", (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.prepare("UPDATE generated_pins SET status = ? WHERE id = ?").run(status, id);
    res.json({ success: true });
  });

  app.get("/api/pins/:id/download", (req, res) => {
    const { id } = req.params;
    const pin = db.prepare("SELECT * FROM generated_pins WHERE id = ?").get(id) as any;
    if (!pin || !pin.image_url) return res.status(404).send("Pin not found");

    // In a real app, we'd fetch from S3. Here we just redirect to the data URL or external URL
    // But for a "download" we might want to proxy it to set headers
    res.redirect(pin.image_url);
  });

  app.post("/api/pins/publish", authenticate, async (req: any, res) => {
    const { title, description, image_url, board_id } = req.body;
    
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as any;
    if (!user || !user.pinterest_token) {
      return res.status(401).json({ error: "Pinterest account not connected", code: "AUTH_REQUIRED" });
    }

    // Simulate Pinterest API call
    console.log("Publishing to Pinterest for user:", user.email, { title, board_id });
    
    // Artificial delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Simulate random rate limit (5% chance)
    if (Math.random() > 0.95) {
      return res.status(429).json({ error: "Rate limit exceeded – try again later", code: "RATE_LIMIT" });
    }

    // Simulate random token expiration (5% chance)
    if (Math.random() > 0.95) {
      // Clear token in DB to simulate expiration
      db.prepare("UPDATE users SET pinterest_token = NULL WHERE id = ?").run(req.userId);
      return res.status(401).json({ error: "Authentication expired – please reconnect your Pinterest account", code: "AUTH_EXPIRED" });
    }

    res.json({ 
      success: true, 
      pin_url: "https://www.pinterest.com/pin/mock-id/",
      message: "Pin published successfully!" 
    });
  });

  app.post("/api/extract-metadata", async (req, res) => {
    const { url } = req.body;

    // 1. URL Validation
    if (!url || !validator.isURL(url, { require_protocol: true })) {
      return res.status(400).json({ error: "Please enter a valid URL (including http:// or https://)." });
    }

    // 2. Cache Check
    const cached = db.prepare("SELECT * FROM metadata_cache WHERE url = ? AND cached_at > datetime('now', '-24 hours')").get(url) as any;
    if (cached) {
      console.log(`Cache hit for ${url}`);
      return res.json({ title: cached.title, description: cached.description, image: cached.image, from_cache: true });
    }

    console.log(`Extracting metadata for: ${url}`);

    try {
      // 3. Extraction Strategy 1: Open Graph Tags
      const response = await axios.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000 // 10 seconds timeout
      });

      const $ = cheerio.load(response.data);
      
      const metadata = {
        title: $("meta[property='og:title']").attr("content") || 
               $("meta[name='twitter:title']").attr("content") || 
               $("title").text() || 
               "",
        description: $("meta[property='og:description']").attr("content") || 
                     $("meta[name='twitter:description']").attr("content") || 
                     $("meta[name='description']").attr("content") || 
                     $("p").first().text() || 
                     "",
        image: $("meta[property='og:image']").attr("content") || 
               $("meta[name='twitter:image']").attr("content") || 
               $("link[rel='image_src']").attr("href") || 
               "",
      };

      // Clean up whitespace
      metadata.title = metadata.title.trim();
      metadata.description = metadata.description.trim().substring(0, 500);

      // 4. Cache the result
      db.prepare("INSERT OR REPLACE INTO metadata_cache (url, title, description, image) VALUES (?, ?, ?, ?)")
        .run(url, metadata.title, metadata.description, metadata.image);

      res.json(metadata);
    } catch (error: any) {
      // 5. Better Error Handling & Logging
      console.error(`Metadata extraction failed for ${url}:`, {
        message: error.message,
        code: error.code,
        stack: error.stack
      });

      let userMessage = "We couldn't automatically fetch the details.";
      if (error.code === 'ECONNABORTED') {
        userMessage = "The request timed out. The site might be slow or unreachable.";
      } else if (error.response?.status === 403 || error.response?.status === 401) {
        userMessage = "Access denied. This site might be blocking automated requests.";
      } else if (error.response?.status === 404) {
        userMessage = "The page was not found. Please check the URL.";
      }

      res.status(500).json({ 
        error: userMessage,
        details: "Please enter a title and description manually for your pins.",
        can_manual: true 
      });
    }
  });

  // Mock Trend Update (In a real app, this would be a cron job)
  app.post("/api/admin/update-trends", async (req, res) => {
    const mockTrends = [
      { keyword: "Minimalist Home Decor", source: "Pinterest", category: "Home", momentum_score: 95, search_volume: 50000 },
      { keyword: "Sustainable Fashion 2024", source: "Google", category: "Fashion", momentum_score: 88, search_volume: 30000 },
      { keyword: "Quick Vegan Recipes", source: "Pinterest", category: "Food", momentum_score: 92, search_volume: 45000 },
      { keyword: "iOS 18 Customization", source: "Google", category: "Tech", momentum_score: 98, search_volume: 120000 },
      { keyword: "Self-Care Sunday Routine", source: "Social", category: "Lifestyle", momentum_score: 85, search_volume: 25000 },
    ];

    const insert = db.prepare("INSERT OR REPLACE INTO trending_keywords (keyword, source, category, momentum_score, search_volume) VALUES (?, ?, ?, ?, ?)");
    const transaction = db.transaction((trends) => {
      for (const t of trends) insert.run(t.keyword, t.source, t.category, t.momentum_score, t.search_volume);
    });
    transaction(mockTrends);
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // Initialize Database
  const rowCount = db.prepare("SELECT COUNT(*) as count FROM trending_keywords").get() as { count: number };
  if (rowCount.count === 0) {
    console.log("Initializing trends database...");
    const mockTrends = [
      { keyword: "Minimalist Home Decor", source: "Pinterest", category: "Home", momentum_score: 95, search_volume: 50000 },
      { keyword: "Sustainable Fashion 2024", source: "Google", category: "Fashion", momentum_score: 88, search_volume: 30000 },
      { keyword: "Quick Vegan Recipes", source: "Pinterest", category: "Food", momentum_score: 92, search_volume: 45000 },
      { keyword: "iOS 18 Customization", source: "Google", category: "Tech", momentum_score: 98, search_volume: 120000 },
      { keyword: "Self-Care Sunday Routine", source: "Social", category: "Lifestyle", momentum_score: 85, search_volume: 25000 },
    ];
    const insert = db.prepare("INSERT OR IGNORE INTO trending_keywords (keyword, source, category, momentum_score, search_volume) VALUES (?, ?, ?, ?, ?)");
    const transaction = db.transaction((trends) => {
      for (const t of trends) insert.run(t.keyword, t.source, t.category, t.momentum_score, t.search_volume);
    });
    transaction(mockTrends);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
