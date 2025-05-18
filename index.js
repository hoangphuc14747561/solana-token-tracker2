const express = require("express");
const fetch = require("node-fetch");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;
const WORKER_ID = process.env.WORKER || "webcon_001";

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
    const workRes = await fetch(`https://test.pumpvote.com/api/work?worker=${WORKER_ID}`, { agent });
    if (workRes.status === 204) return;
    const token = await workRes.json();

    const rayPairs = await getRaydiumPairs();
    const scanTime = getLocalTime();

    const price = await getTokenPrice(token.mint, rayPairs);
    if (price) {
      const now = new Date();
      await fetch("https://test.pumpvote.com/api/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: token.mint,
          currentPrice: price.value,
          scanTime,
          worker: WORKER_ID
        }),
        agent
      });
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
      console.log(`🔁 Worker ${WORKER_ID} - Round ${round++}`);
      await scanRound(round);
      await delay(ROUND_DELAY_MS);
    }
  })();
});
