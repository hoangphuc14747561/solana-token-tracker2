const express = require("express");
const fetch = require("node-fetch");
const https = require("https");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const WORKER_ID = process.env.WORKER || "node_helius1";
const SERVER_URL = "https://dienlanhquangphat.vn/toolvip";
const agent = new https.Agent({ rejectUnauthorized: false });

const WSOL = "So11111111111111111111111111111111111111112";
const DELAY_MS = 2400;
const ROUND_DELAY_MS = 500;
const BATCH_SIZE = 5;
const RAM_LIMIT_MB = 300;

let apiKeys = [];

function loadRpcUrls() {
  try {
    const raw = fs.readFileSync("apikeys.txt", "utf-8");
    apiKeys = raw.trim().split("\n").filter(Boolean);
    if (apiKeys.length === 0) throw new Error("Không có API key nào trong file.");
  } catch {
    process.exit(1);
  }
}

function getRandomRpcUrl() {
  const key = apiKeys[Math.floor(Math.random() * apiKeys.length)];
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function callRpc(method, params) {
  const rpcUrl = getRandomRpcUrl();
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return await res.json();
  } catch {
    return null;
  }
}

async function getTokenPriceFromHelius(mint) {
  try {
    const res1 = await callRpc("getTokenLargestAccounts", [mint]);
    const tokenAccounts = res1?.result?.value;
    if (!tokenAccounts?.length) return null;

    const tokenAccount = tokenAccounts[0]?.address;
    const res2 = await callRpc("getAccountInfo", [tokenAccount, { encoding: "jsonParsed" }]);
    const info = res2?.result?.value?.data?.parsed?.info;
    const owner = info?.owner;
    const tokenAmount = parseFloat(info?.tokenAmount?.uiAmount || "0");

    if (!owner || tokenAmount === 0) return null;

    const res3 = await callRpc("getTokenAccountsByOwner", [
      owner,
      { mint: WSOL },
      { encoding: "jsonParsed" }
    ]);

    const wsolAccount = res3?.result?.value?.[0]?.pubkey;
    if (!wsolAccount) return null;

    const res4 = await callRpc("getTokenAccountBalance", [wsolAccount]);
    const wsolAmount = parseFloat(res4?.result?.value?.uiAmount || "0");

    if (!wsolAmount || tokenAmount === 0) return null;

    return { value: +(wsolAmount / tokenAmount).toFixed(9), source: "Helius" };
  } catch {
    return null;
  }
}

async function getTokenPriceWithTimeout(mint, timeout = 5000) {
  return Promise.race([
    getTokenPriceFromHelius(mint),
    new Promise(resolve => setTimeout(() => resolve(null), timeout))
  ]);
}

async function assignBatchTokens(batchSize) {
  try {
    const res = await fetch(`${SERVER_URL}/assign-token.php?worker=${WORKER_ID}&count=${batchSize}`, { agent });
    if (res.status === 204) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && data.mint) return [data];
    return [];
  } catch {
    return [];
  }
}

async function sendResults(results) {
  if (!results.length) return;
  try {
    await fetch(`${SERVER_URL}/update-token.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(results),
      agent,
    });
  } catch {}
}

async function scanRound(round) {
  const scanTime = new Date().toLocaleTimeString("vi-VN", { hour12: false });
  const tokens = await assignBatchTokens(BATCH_SIZE);
  if (!tokens.length) return;

  const results = [];
  const start = Date.now();

  for (const token of tokens) {
    const price = await getTokenPriceWithTimeout(token.mint);
    if (price) {
      results.push({
        mint: token.mint,
        index: token.index ?? undefined,
        currentPrice: price.value,
        scanTime
      });
    }

    if (Date.now() - start > 25000 && results.length > 0) {
      await sendResults(results);
      results.length = 0;
    }

    await delay(DELAY_MS);
  }

  if (results.length > 0) {
    await sendResults(results);
    results.length = 0;
  }
}

function monitorMemoryAndRestart() {
  setInterval(() => {
    const usedMB = process.memoryUsage().rss / 1024 / 1024;
    if (usedMB > RAM_LIMIT_MB) {
      process.exit(0); // Auto restart on Render
    }
  }, 60000); // Check every 60s
}

app.get("/", (req, res) => {
  res.send(`✅ WebCon [${WORKER_ID}] đang chạy`);
});

app.listen(PORT, () => {
  loadRpcUrls();
  monitorMemoryAndRestart();

  let round = 1;
  (async function loop() {
    while (true) {
      await scanRound(round++);
      await delay(ROUND_DELAY_MS);
    }
  })();
});
