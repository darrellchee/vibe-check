import test from "node:test";
import assert from "node:assert/strict";
import { sessionToken } from "../lib/auth";
import { availability, gh, GhError, publishReadme, type Gh } from "../lib/github-publish";
import { MAX_PREFILL_URL, webPublish, type RepoProbe } from "../lib/github-web";
import { GET as status, POST as publish } from "../app/api/publish/route";

type Fake = { login?: string; repo?: boolean; readme?: { content: string; sha: string; path?: string }; lateRepo?: number };

// A stand-in for `gh` that answers like GitHub's API, including its 404s, and records every call.
function fakeGh(state: Fake = {}) {
  const calls: { args: string[]; input?: string }[] = [];
  let repo = state.repo ?? false, late = state.lateRepo ?? 0;
  const login = state.login ?? "octocat";
  const run: Gh = async (args, input) => {
    calls.push({ args, input });
    const route = args[args.indexOf("api") + 1] === "-X" ? args[args.indexOf("api") + 3] : args[args.indexOf("api") + 1];
    if (route === "user") return `${login}\n`;
    if (route === `repos/${login}/${login}/readme`) {
      if (!repo || !state.readme) throw new GhError("Not found on GitHub.", "not-found");
      return JSON.stringify({ path: state.readme.path ?? "README.md", sha: state.readme.sha, content: Buffer.from(state.readme.content).toString("base64") });
    }
    if (route === `repos/${login}/${login}`) {
      if (!repo) throw new GhError("Not found on GitHub.", "not-found");
      return "";
    }
    if (route === "user/repos") { repo = true; return "{}"; }
    if (route.startsWith(`repos/${login}/${login}/contents/`)) {
      if (late-- > 0) throw new GhError("Not found on GitHub.", "not-found");
      return "{}";
    }
    throw new GhError(`unexpected ${args.join(" ")}`, "failed");
  };
  const writes = () => calls.filter((c) => c.args.includes("-X")).map((c) => ({ method: c.args[c.args.indexOf("-X") + 1], route: c.args[c.args.indexOf("-X") + 2], body: c.input ? JSON.parse(c.input) : null }));
  return { run, calls, writes };
}

test("publishing creates the profile repository, then commits the README", async () => {
  const fake = fakeGh();
  const result = await publishReadme(fake.run, "# Hi\n");
  assert.deepEqual(result, { login: "octocat", status: "created" });
  const [create, put] = fake.writes();
  assert.equal(create.route, "user/repos");
  assert.deepEqual(create.body, { name: "octocat", description: "My GitHub profile README", private: false });
  assert.equal(put.method, "PUT");
  assert.equal(put.route, "repos/octocat/octocat/contents/README.md");
  assert.equal(Buffer.from(put.body.content, "base64").toString(), "# Hi\n");
  assert.equal("sha" in put.body, false);
});

test("an existing empty repository is reused instead of created again", async () => {
  const fake = fakeGh({ repo: true });
  assert.deepEqual(await publishReadme(fake.run, "x\n"), { login: "octocat", status: "added" });
  assert.deepEqual(fake.writes().map((w) => w.route), ["repos/octocat/octocat/contents/README.md"]);
});

test("an existing README is replaced by passing its sha and keeps its own file name", async () => {
  const fake = fakeGh({ repo: true, readme: { content: "old\n", sha: "abc123", path: "readme.md" } });
  assert.deepEqual(await publishReadme(fake.run, "new\n"), { login: "octocat", status: "updated" });
  const [put] = fake.writes();
  assert.equal(put.route, "repos/octocat/octocat/contents/readme.md");
  assert.equal(put.body.sha, "abc123");
  assert.equal(put.body.message, "Update profile README");
});

test("publishing identical content writes nothing", async () => {
  const fake = fakeGh({ repo: true, readme: { content: "same\n", sha: "s" } });
  assert.deepEqual(await publishReadme(fake.run, "same\n"), { login: "octocat", status: "unchanged" });
  assert.equal(fake.writes().length, 0);
});

test("a repository that was just created may 404 once before accepting the first commit", async () => {
  const fake = fakeGh({ lateRepo: 2 });
  assert.equal((await publishReadme(fake.run, "x\n", { retryDelayMs: 0 })).status, "created");
  assert.equal(fake.writes().filter((w) => w.method === "PUT").length, 3);
  const stuck = fakeGh({ lateRepo: 9 });
  await assert.rejects(publishReadme(stuck.run, "x\n", { retryDelayMs: 0 }), GhError);
});

test("a failed commit on an existing repository is reported, not retried", async () => {
  const fake = fakeGh({ repo: true, lateRepo: 1 });
  await assert.rejects(publishReadme(fake.run, "x\n", { retryDelayMs: 0 }), GhError);
  assert.equal(fake.writes().length, 1);
});

test("a login GitHub returns that is not a valid username is refused before it reaches a path", async () => {
  const run: Gh = async () => "octo/../cat\n";
  await assert.rejects(publishReadme(run, "x\n"), /unexpected username/);
});

test("availability reports a missing or signed-out CLI instead of failing", async () => {
  const missing: Gh = async () => { throw new GhError("The GitHub CLI (gh) is not installed.", "missing"); };
  const signedOut: Gh = async () => { throw new GhError("The GitHub CLI is not signed in.", "signed-out"); };
  const broken: Gh = async () => { throw new GhError("GitHub rejected the request.", "failed"); };
  assert.deepEqual(await availability(missing), { available: false, reason: "missing" });
  assert.deepEqual(await availability(signedOut), { available: false, reason: "signed-out" });
  await assert.rejects(availability(broken), GhError);
  assert.deepEqual(await availability(fakeGh({ repo: true, readme: { content: "a", sha: "s" } }).run),
    { available: true, login: "octocat", repository: true, readme: true });
});

const probe = (repo: RepoProbe["repo"], extra: Partial<RepoProbe> = {}): RepoProbe => ({ repo, branch: "main", path: "README.md", ...extra });

test("without the CLI, the link depends on what exists on GitHub", () => {
  const missing = webPublish("octocat", probe("missing"), "# Hi\n");
  assert.equal(new URL(missing.href).origin + new URL(missing.href).pathname, "https://github.com/new");
  assert.equal(new URL(missing.href).searchParams.get("name"), "octocat");
  assert.equal(new URL(missing.href).searchParams.get("visibility"), "public");
  assert.equal(missing.copy, false);

  const empty = webPublish("octocat", probe("empty", { branch: "trunk" }), "# Hi\n");
  const url = new URL(empty.href);
  assert.equal(url.pathname, "/octocat/octocat/new/trunk");
  assert.equal(url.searchParams.get("filename"), "README.md");
  assert.equal(url.searchParams.get("value"), "# Hi\n");
  assert.equal(empty.copy, false);

  const existing = webPublish("octocat", probe("readme", { path: "My Readme.md" }), "# Hi\n");
  assert.equal(new URL(existing.href).pathname, "/octocat/octocat/edit/main/My%20Readme.md");
  assert.equal(existing.copy, true);

  const unknown = webPublish("octocat", probe("unknown"), "# Hi\n");
  assert.equal(unknown.href, "https://github.com/octocat/octocat");
  assert.equal(unknown.copy, true);
});

test("a README too long for a URL is copied to the clipboard instead of prefilled", () => {
  const plan = webPublish("octocat", probe("empty"), "x".repeat(MAX_PREFILL_URL));
  assert.equal(plan.copy, true);
  assert.equal(new URL(plan.href).searchParams.has("value"), false);
  assert.ok(plan.href.length < 200);
});

// ───────── The route ─────────
const env: Record<string, string | undefined> = process.env;
async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, env[key]]));
  const runner = gh.run;
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    await run();
  } finally {
    gh.run = runner;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}
const local = { ATLAS_MODE: "local", NODE_ENV: "development", DASHBOARD_PASSWORD: undefined, VERCEL: undefined };
const post = (body: unknown, headers: HeadersInit = {}) => new Request("http://localhost:3000/api/publish", {
  method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});

test("publish route refuses visitors who are not signed in", async () => {
  await withEnv({ ...local, NODE_ENV: "production", DASHBOARD_PASSWORD: "private-password" }, async () => {
    const fake = fakeGh(); gh.run = fake.run;
    assert.equal((await status(new Request("http://localhost:3000/api/publish"))).status, 401);
    assert.equal((await publish(post({ markdown: "x" }))).status, 401);
    assert.equal(fake.calls.length, 0);
    const cookie = { cookie: `atlas_session=${sessionToken("private-password")}` };
    assert.equal((await publish(post({ markdown: "x\n" }, cookie))).status, 200);
  });
});

test("publish route refuses cross-site requests and never reaches GitHub", async () => {
  await withEnv(local, async () => {
    const fake = fakeGh(); gh.run = fake.run;
    const response = await publish(post({ markdown: "x" }, { origin: "https://evil.example" }));
    assert.equal(response.status, 403);
    assert.equal(fake.calls.length, 0);
  });
});

test("a deployed copy reports one-click publishing as unavailable and refuses to publish", async () => {
  await withEnv({ ...local, ATLAS_MODE: "cloud", DASHBOARD_PASSWORD: "private-password", NODE_ENV: "production" }, async () => {
    const fake = fakeGh(); gh.run = fake.run;
    const cookie = { cookie: `atlas_session=${sessionToken("private-password")}` };
    const info = await status(new Request("https://dash.example/api/publish", { headers: cookie }));
    assert.deepEqual(await info.json(), { available: false, reason: "cloud" });
    assert.equal((await publish(post({ markdown: "x" }, cookie))).status, 503);
    assert.equal(fake.calls.length, 0);
  });
});

test("publish route validates the body and reports GitHub failures", async () => {
  await withEnv(local, async () => {
    const fake = fakeGh(); gh.run = fake.run;
    assert.equal((await publish(post("not json"))).status, 400);
    assert.equal((await publish(post({ markdown: "   " }))).status, 400);
    assert.equal((await publish(post({ markdown: 42 }))).status, 400);
    assert.equal((await publish(post({ markdown: "x".repeat(400_001) }))).status, 413);
    assert.equal(fake.calls.length, 0);

    gh.run = async () => { throw new GhError("The GitHub CLI is not signed in.", "signed-out"); };
    const failed = await publish(post({ markdown: "x\n" }));
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).error, "The GitHub CLI is not signed in.");

    gh.run = fakeGh({ repo: true }).run;
    const ok = await publish(post({ markdown: "x\n" }));
    assert.deepEqual(await ok.json(), { login: "octocat", status: "added" });
    const info = await status(new Request("http://localhost:3000/api/publish"));
    assert.deepEqual(await info.json(), { available: true, login: "octocat", repository: true, readme: false });
  });
});
