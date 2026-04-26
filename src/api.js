const https = require("https");
const http  = require("http");

const BASE_URL = process.env.INSIGHTA_API_URL || "https://insighta-backend-production.up.railway.app";

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url     = new URL(BASE_URL + path);
    const isHttps = url.protocol === "https:";
    const lib     = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        "X-API-Version": "1",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(bodyStr && { "Content-Length": Buffer.byteLength(bodyStr) }),
      },
    };
    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const status = res.statusCode;
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (status >= 200 && status < 300) resolve({ status, data: parsed, headers: res.headers });
        else {
          const err = new Error((parsed && parsed.message) || `HTTP ${status}`);
          err.status = status; err.data = parsed; reject(err);
        }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function makeClient(token) {
  return {
    get:    (path)       => request("GET",    path, null, token),
    post:   (path, body) => request("POST",   path, body, token),
    delete: (path)       => request("DELETE", path, null, token),
  };
}

module.exports = { makeClient, BASE_URL };