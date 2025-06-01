const express = require("express");
const fetch = require("node-fetch");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const WORKER_ID = process.env.WORKER || "webcon_002";
const SERVER_URL = "https://dienlanhquangphat.vn/toolvip";

const agent = new https.Agent({ rejectUnauthorized: false });

const WSOL = "So11111111111111111111111111111111111111112";
const DELAY_MS = 2400;
const ROUND_DELAY_MS = 500;
const AMOUNT = 100_000_000;

function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function getLocalTime() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

async function getRaydiumPairs() {
  try {
    const res = await fetch("https://api-v3.raydium.io/pairs");
    return await res.json();
  } catch {
    return [];
  }
}

async function getTokenPrice(mint, rayPairs) {
  let jupiter = null, raydium = null;
  try {
    const q = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${mint}&outputMint=${WSOL}&amount=${AMOUNT}&slippageBps=300`);
    const data = await q.json();
    if (data.outAmount) {
      const price = parseFloat(data.outAmount) / AMOUNT;
      jupiter = { value: +price.toFixed(9), source: "Jupiter" };
    }
  } catch {}

  try {
    const check = await fetch(`https://api-v3.raydium.io/mint/ids?mints=${mint}`);
    const valid = await check.json();
    if (valid.length > 0) {
      const p = rayPairs.find(p => p.baseMint === mint || p.quoteMint === mint);
      if (p && p.price && p.quoteMint === WSOL) {
        raydium = { value: +parseFloat(p.price).toFixed(9), source: "Raydium" };
      }
    }
  } catch {}

  if (jupiter && raydium) return raydium.value > jupiter.value ? raydium : jupiter;
  return jupiter || raydium || null;
}

async function scanRound(round) {
  try {
    // ? Nhận việc từ PHP
    const workRes = await fetch(`${SERVER_URL}/assign-token.php?worker=${WORKER_ID}`, { agent });
    const data = await workRes.json();

    if (!data || !data.mint) {
      console.log("⏳ Không có token nào pending...");
      return;
    }

    const rayPairs = await getRaydiumPairs();
    const scanTime = getLocalTime();

    const price = await getTokenPrice(data.mint, rayPairs);
    if (price) {
      console.log(`✅ [${data.mint}] Giá: ${price.value} (${price.source})`);

      await fetch(`${SERVER_URL}/update-token.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: data.mint,
          currentPrice: price.value,
          scanTime: scanTime
        }),
        agent
      });
    } else {
      console.log(`❌ Không lấy được giá cho ${data.mint}`);
    }

    await delay(DELAY_MS);
  } catch (err) {
    console.error("❌ Scan error:", err.message);
  }
}

app.get("/", (req, res) => {
  res.send(`✅ WebCon [${WORKER_ID}] đang chạy.`);
});

app.listen(PORT, () => {
  console.log(`✅ WebCon (worker=${WORKER_ID}) listening on port ${PORT}`);

  let round = 1;
  (async function loop() {
    while (true) {
      console.log(`🔁 Round ${round++}`);
      await scanRound(round);
      await delay(ROUND_DELAY_MS);
    }
  })();
});
