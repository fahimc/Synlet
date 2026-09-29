import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { dirname, resolve } from "node:path";

const credentialsPath = resolve(
  process.env.SYNLET_TUNNEL_CREDENTIALS ??
    "runtime-data/cloudflare/basic-auth.json",
);
let storedCredentials;
try {
  storedCredentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  storedCredentials = {
    username: "synlet",
    password: randomBytes(24).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
  mkdirSync(dirname(credentialsPath), { recursive: true });
  writeFileSync(
    credentialsPath,
    `${JSON.stringify(storedCredentials, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  process.stdout.write(
    `Created tunnel credentials at ${credentialsPath}\nUsername: ${storedCredentials.username}\nPassword: ${storedCredentials.password}\n`,
  );
}

const username =
  process.env.SYNLET_TUNNEL_USERNAME ?? storedCredentials.username;
const password =
  process.env.SYNLET_TUNNEL_PASSWORD ?? storedCredentials.password;
const sessionToken =
  process.env.SYNLET_TUNNEL_SESSION ?? storedCredentials.sessionToken;
const listenHost = process.env.SYNLET_TUNNEL_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.SYNLET_TUNNEL_PORT ?? "43129");
const origin = new URL(
  process.env.SYNLET_TUNNEL_ORIGIN ?? "http://127.0.0.1:43127",
);

if (
  !username ||
  !password ||
  password.length < 20 ||
  !sessionToken ||
  sessionToken.length < 32
)
  throw new Error("Strong tunnel password and session token are required");
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65_535)
  throw new Error("Invalid tunnel proxy port");

const expectedBasic = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const expectedCookie = `synlet_tunnel_session=${sessionToken}`;

function equal(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function authorized(incoming) {
  const authorization = incoming.headers.authorization ?? "";
  if (equal(authorization, expectedBasic)) return "basic";
  const cookies = (incoming.headers.cookie ?? "")
    .split(";")
    .map((value) => value.trim());
  return cookies.some((cookie) => equal(cookie, expectedCookie))
    ? "session"
    : undefined;
}

const server = createServer((incoming, outgoing) => {
  const authentication = authorized(incoming);
  if (!authentication) {
    outgoing.writeHead(401, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "www-authenticate": 'Basic realm="Synlet", charset="UTF-8"',
    });
    outgoing.end("Authentication required\n");
    return;
  }

  const headers = { ...incoming.headers };
  headers.host = origin.host;
  delete headers["proxy-authorization"];
  const upstream = request(
    {
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port,
      method: incoming.method,
      path: incoming.url,
      headers,
    },
    (response) => {
      const responseHeaders = { ...response.headers };
      responseHeaders["cache-control"] = "no-store";
      if (authentication === "basic")
        responseHeaders["set-cookie"] =
          `${expectedCookie}; Path=/; Secure; HttpOnly; SameSite=Strict`;
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", (error) => {
    if (outgoing.headersSent) outgoing.destroy(error);
    else {
      outgoing.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      outgoing.end("Synlet origin is unavailable\n");
    }
  });
  incoming.pipe(upstream);
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    `Authenticated Synlet tunnel proxy listening at http://${listenHost}:${listenPort}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
