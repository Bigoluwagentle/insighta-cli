#!/usr/bin/env node

const { program } = require("commander");
const http        = require("http");
const https       = require("https");
const crypto      = require("crypto");
const { exec }    = require("child_process");
const ora         = require("ora");
const chalk       = require("chalk");
const Table       = require("cli-table3");
const fs          = require("fs");
const path        = require("path");

const { makeClient, BASE_URL }                               = require("./api");
const { loadCredentials, saveCredentials, clearCredentials } = require("./credentials");

program.name("insighta").description("Insighta Labs+ CLI").version("1.0.0");

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "start \"\" \"" + url + "\"" :
              process.platform === "darwin" ? "open \"" + url + "\"" :
              "xdg-open \"" + url + "\"";
  exec(cmd);
}

function generatePKCE() {
  const verifier  = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(urlStr);
    const isHttps = parsed.protocol === "https:";
    const lib     = isHttps ? https : http;
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };
    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

async function getToken() {
  const creds = loadCredentials();
  if (!creds) {
    console.error(chalk.red("Not logged in. Run: insighta login"));
    process.exit(1);
  }
  try {
    await makeClient(creds.access_token).get("/auth/me");
    return creds.access_token;
  } catch (err) {
    if (err.status !== 401) throw err;
  }
  const spinner = ora("Refreshing session...").start();
  try {
    const res = await makeClient(null).post("/auth/refresh", { refresh_token: creds.refresh_token });
    saveCredentials({ ...creds, access_token: res.data.access_token, refresh_token: res.data.refresh_token });
    spinner.succeed("Session refreshed");
    return res.data.access_token;
  } catch {
    spinner.fail("Session expired. Please log in again.");
    clearCredentials();
    process.exit(1);
  }
}

function printTable(columns, rows) {
  const table = new Table({ head: columns.map((c) => chalk.cyan(c)), style: { compact: true } });
  rows.forEach((r) => table.push(r));
  console.log(table.toString());
}

function printProfile(p) {
  const table = new Table({ style: { compact: true } });
  Object.entries(p).forEach(([k, v]) => table.push([chalk.cyan(k), String(v ?? "—")]));
  console.log(table.toString());
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
program.command("login").description("Log in via GitHub OAuth").action(() => {
  const { verifier, challenge } = generatePKCE();
  const port          = 9876;
  const localCallback = "http://localhost:" + port + "/callback";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost:" + port);
    if (url.pathname !== "/callback") { res.end("Invalid path."); return; }

    // Backend redirects here with code + state
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error || !code || !state) {
      res.end("<h2>Login failed. Close this tab and try again.</h2>");
      server.close();
      console.error(chalk.red("\nLogin failed: " + (error || "no code received")));
      return;
    }

    res.end("<h2>Login successful! You can close this tab.</h2>");
    server.close();

    // POST code + code_verifier + state to backend
    const spinner = ora("Completing login...").start();
    try {
      const result = await postJson(BASE_URL + "/auth/github/token", {
        code,
        state,
        code_verifier: verifier,
      });

      if (result.status !== 200 || !result.data.access_token) {
        spinner.fail("Login failed: " + (result.data && result.data.message ? result.data.message : "unknown error"));
        return;
      }

      saveCredentials({
        access_token:  result.data.access_token,
        refresh_token: result.data.refresh_token,
        username:      result.data.username,
      });
      spinner.succeed(chalk.green("Logged in as @" + result.data.username));
    } catch (err) {
      spinner.fail("Login failed: " + err.message);
    }
  });

  server.listen(port, () => {
    // Pass code_challenge + our local callback as redirect_uri
    // Backend stores them with state, redirects to GitHub
    // GitHub redirects to backend callback
    // Backend sees redirect_uri=localhost and redirects code+state to us
    const params = new URLSearchParams({
      code_challenge:        challenge,
      code_challenge_method: "S256",
      redirect_uri:          localCallback,
    });
    const loginUrl = BASE_URL + "/auth/github?" + params;
    console.log(chalk.blue("Opening GitHub login in your browser..."));
    console.log(chalk.gray("If it doesn't open, visit:\n" + loginUrl));
    openBrowser(loginUrl);
  });

  server.on("error", (err) => {
    console.error(chalk.red("Could not start local server on port " + port + ": " + err.message));
    process.exit(1);
  });
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
program.command("logout").description("Log out").action(async () => {
  const creds = loadCredentials();
  if (!creds) { console.log("Not logged in."); return; }
  const spinner = ora("Logging out...").start();
  try { await makeClient(creds.access_token).post("/auth/logout", { refresh_token: creds.refresh_token }); } catch {}
  clearCredentials();
  spinner.succeed("Logged out successfully.");
});

// ─── WHOAMI ───────────────────────────────────────────────────────────────────
program.command("whoami").description("Show current user").action(async () => {
  const token   = await getToken();
  const spinner = ora("Fetching user info...").start();
  try {
    const res = await makeClient(token).get("/auth/me");
    spinner.stop();
    printProfile(res.data.data);
  } catch (err) { spinner.fail(err.message); }
});

// ─── PROFILES ─────────────────────────────────────────────────────────────────
const profiles = program.command("profiles").description("Manage profiles");

profiles.command("list").description("List profiles")
  .option("--gender <gender>")
  .option("--country <country_id>")
  .option("--age-group <age_group>")
  .option("--min-age <n>")
  .option("--max-age <n>")
  .option("--sort-by <field>")
  .option("--order <order>")
  .option("--page <n>")
  .option("--limit <n>")
  .action(async (opts) => {
    const token   = await getToken();
    const spinner = ora("Fetching profiles...").start();
    const params  = new URLSearchParams();
    if (opts.gender)   params.set("gender",    opts.gender);
    if (opts.country)  params.set("country_id", opts.country);
    if (opts.ageGroup) params.set("age_group",  opts.ageGroup);
    if (opts.minAge)   params.set("min_age",    opts.minAge);
    if (opts.maxAge)   params.set("max_age",    opts.maxAge);
    if (opts.sortBy)   params.set("sort_by",    opts.sortBy);
    if (opts.order)    params.set("order",      opts.order);
    if (opts.page)     params.set("page",       opts.page);
    if (opts.limit)    params.set("limit",      opts.limit);
    try {
      const res = await makeClient(token).get("/api/profiles?" + params);
      spinner.stop();
      const { data, total, page, total_pages } = res.data;
      console.log(chalk.gray("Page " + page + " of " + total_pages + " | Total: " + total));
      printTable(
        ["name", "gender", "age", "age_group", "country_id", "country_name"],
        data.map((p) => [p.name, p.gender, p.age, p.age_group, p.country_id, p.country_name || "—"])
      );
    } catch (err) { spinner.fail(err.message); }
  });

profiles.command("get <id>").description("Get a profile by ID").action(async (id) => {
  const token   = await getToken();
  const spinner = ora("Fetching profile...").start();
  try {
    const res = await makeClient(token).get("/api/profiles/" + id);
    spinner.stop();
    printProfile(res.data.data);
  } catch (err) { spinner.fail(err.message); }
});

profiles.command("search <query>").description("Natural language search")
  .option("--page <n>")
  .option("--limit <n>")
  .action(async (query, opts) => {
    const token   = await getToken();
    const spinner = ora("Searching...").start();
    const params  = new URLSearchParams({ q: query });
    if (opts.page)  params.set("page",  opts.page);
    if (opts.limit) params.set("limit", opts.limit);
    try {
      const res = await makeClient(token).get("/api/profiles/search?" + params);
      spinner.stop();
      const { data, total, page, total_pages } = res.data;
      console.log(chalk.gray("Page " + page + " of " + total_pages + " | Total: " + total));
      printTable(
        ["name", "gender", "age", "age_group", "country_id", "country_name"],
        data.map((p) => [p.name, p.gender, p.age, p.age_group, p.country_id, p.country_name || "—"])
      );
    } catch (err) { spinner.fail(err.message); }
  });

profiles.command("create").description("Create a profile (admin only)")
  .requiredOption("--name <name>")
  .action(async (opts) => {
    const token   = await getToken();
    const spinner = ora("Creating profile for \"" + opts.name + "\"...").start();
    try {
      const res = await makeClient(token).post("/api/profiles", { name: opts.name });
      spinner.succeed("Profile created.");
      printProfile(res.data.data);
    } catch (err) { spinner.fail(err.message); }
  });

profiles.command("export").description("Export profiles as CSV")
  .option("--format <format>", "Export format", "csv")
  .option("--gender <gender>")
  .option("--country <country_id>")
  .option("--age-group <age_group>")
  .option("--sort-by <field>")
  .option("--order <order>")
  .action(async (opts) => {
    const token   = await getToken();
    const spinner = ora("Exporting profiles...").start();
    const params  = new URLSearchParams({ format: opts.format });
    if (opts.gender)   params.set("gender",    opts.gender);
    if (opts.country)  params.set("country_id", opts.country);
    if (opts.ageGroup) params.set("age_group",  opts.ageGroup);
    if (opts.sortBy)   params.set("sort_by",    opts.sortBy);
    if (opts.order)    params.set("order",      opts.order);
    try {
      const url = new URL(BASE_URL + "/api/profiles/export?" + params);
      const lib = url.protocol === "https:" ? https : http;
      const csv = await new Promise((resolve, reject) => {
        lib.get(url.toString(), {
          headers: { Authorization: "Bearer " + token, "X-API-Version": "1" },
        }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve(data));
        }).on("error", reject);
      });
      const filename = "profiles_" + new Date().toISOString().replace(/[:.]/g, "-") + ".csv";
      const filepath = path.join(process.cwd(), filename);
      fs.writeFileSync(filepath, csv);
      spinner.succeed("Exported to " + filepath);
    } catch (err) { spinner.fail(err.message); }
  });

program.parse(process.argv);