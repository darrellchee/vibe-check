import test from "node:test";
import assert from "node:assert/strict";
import {
  authorized,
  equalSecret,
  ingestionAuthorized,
  sessionToken,
  validSession,
} from "../lib/auth";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const before = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const request = (headers?: HeadersInit) =>
  new Request("https://dashboard.example/api/usage", { headers });

test("secret comparison handles byte length, prefixes and empty values safely", () => {
  assert.equal(equalSecret("correct-secret", "correct-secret"), true);
  assert.equal(equalSecret("correct-secret", "correct-secreT"), false);
  assert.equal(equalSecret("correct-secret", "correct"), false);
  assert.equal(equalSecret("é", "aa"), false);
});

test("production dashboard denies access when password is missing", () => {
  withEnv({ NODE_ENV: "production", DASHBOARD_PASSWORD: undefined }, () => {
    assert.equal(authorized(request()), false);
  });
});

test("configured dashboard password requires an authentic session cookie", () => {
  withEnv(
    { NODE_ENV: "development", DASHBOARD_PASSWORD: "private-password" },
    () => {
      assert.equal(authorized(request()), false);
      assert.equal(
        authorized(request({ cookie: "atlas_session=forged" })),
        false,
      );
      assert.equal(
        authorized(
          request({
            cookie: `other=value; atlas_session=${sessionToken("private-password")}; next=value`,
          }),
        ),
        true,
      );
      assert.equal(
        authorized(
          request({
            cookie: `atlas_session=${sessionToken("wrong-password")}`,
          }),
        ),
        false,
      );
      assert.equal(
        authorized(
          request({
            cookie: `not_atlas_session=${sessionToken("private-password")}`,
          }),
        ),
        false,
      );
    },
  );
});

test("session cookies expire and cannot be used after password rotation", () => {
  const day = Math.floor(Date.now() / 86_400_000);
  assert.equal(validSession(sessionToken("secret", day), "secret"), true);
  assert.equal(validSession(sessionToken("secret", day - 1), "secret"), true);
  assert.equal(validSession(sessionToken("secret", day - 2), "secret"), false);
  assert.equal(validSession(sessionToken("secret", day + 1), "secret"), false);
  assert.equal(
    validSession(sessionToken("secret", day), "rotated-secret"),
    false,
  );
});

test("ingestion is closed without a strong secret, even in development", () => {
  for (const token of [undefined, "", "short-secret"]) {
    withEnv({ SYNC_TOKEN: token, NODE_ENV: "development" }, () => {
      assert.equal(ingestionAuthorized(request()), false);
      assert.equal(
        ingestionAuthorized(request({ authorization: `Bearer ${token}` })),
        false,
      );
    });
  }
});

test("ingestion requires exact bearer authentication", () => {
  const token = "a-long-private-test-token-1234567890";
  withEnv({ SYNC_TOKEN: token }, () => {
    assert.equal(
      ingestionAuthorized(request({ authorization: `Bearer ${token}` })),
      true,
    );
    for (const authorization of [
      token,
      `bearer ${token}`,
      `Bearer ${token}extra`,
      `Bearer ${token.slice(1)}`,
    ]) {
      assert.equal(ingestionAuthorized(request({ authorization })), false);
    }
  });
});

test("login endpoint rejects foreign origins and issues secure server-only cookies", async () => {
  const { POST, DELETE } = await import("../app/api/login/route");
  const originalPassword = process.env.DASHBOARD_PASSWORD;
  const env: Record<string, string | undefined> = process.env;
  const originalMode = env.NODE_ENV;
  process.env.DASHBOARD_PASSWORD = "private-login-fixture";
  env.NODE_ENV = "production";
  const loginRequest = (body: string, origin = "https://dashboard.example") =>
    new Request("https://dashboard.example/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body,
    });
  try {
    const foreign = await POST(
      loginRequest(
        JSON.stringify({ password: "private-login-fixture" }),
        "https://foreign.example",
      ),
    );
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.has("set-cookie"), false);
    assert.equal((await POST(loginRequest("{"))).status, 400);
    assert.equal(
      (await POST(loginRequest(JSON.stringify({ password: "wrong" })))).status,
      401,
    );
    const response = await POST(
      loginRequest(JSON.stringify({ password: "private-login-fixture" })),
    );
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=strict/i);
    assert.equal(cookie.includes("private-login-fixture"), false);
    const proxied = await POST(
      new Request("http://internal-server:3000/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://dashboard.example",
          "x-forwarded-host": "dashboard.example",
        },
        body: JSON.stringify({ password: "private-login-fixture" }),
      }),
    );
    assert.equal(proxied.status, 200);
    const malformed = await POST(
      loginRequest(
        JSON.stringify({ password: "private-login-fixture" }),
        "not-an-origin",
      ),
    );
    assert.equal(malformed.status, 403);
    const revoked = await DELETE();
    assert.match(revoked.headers.get("set-cookie") || "", /Max-Age=0/i);
  } finally {
    if (originalPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = originalPassword;
    if (originalMode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = originalMode;
  }
});
