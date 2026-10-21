// Static content snapshot of the sample profile overview page.
// Nothing here is fetched at runtime: the page is a visual copy only.

// The signed-in account shown in the app header (not the profile being viewed).
export const VIEWER = {
  login: "darrellchee",
  avatar: "https://avatars.githubusercontent.com/u/67736192?v=4",
} as const;

export const PROFILE = {
  name: "morluto",
  login: "morluto",
  bio: "member of technically staff",
  followers: "9k",
  following: "55",
  location: "Sinsai",
  links: ["https://x.com/morluto", "https://morluto.bearblog.dev"],
  avatar: "https://avatars.githubusercontent.com/u/76467478?v=4",
  statusEmoji: "https://github.githubassets.com/images/icons/emoji/electron.png",
  tabs: [
    { icon: "book", label: "Overview", selected: true },
    { icon: "repo", label: "Repositories", count: "258" },
    { icon: "table", label: "Projects" },
    { icon: "package", label: "Packages" },
    { icon: "star", label: "Stars", count: "303" },
  ],
  achievements: [
    { src: "https://github.githubassets.com/assets/starstruck-gold-a35e077693cc.png", alt: "Achievement: Starstruck", tier: "x4" },
    { src: "https://github.githubassets.com/assets/pull-shark-gold-90985540b385.png", alt: "Achievement: Pull Shark", tier: "x4" },
    { src: "https://github.githubassets.com/assets/pair-extraordinaire-gold-5335a3b8ae7d.png", alt: "Achievement: Pair Extraordinaire", tier: "x4" },
    { src: "https://github.githubassets.com/assets/quickdraw-default-39c6aec8ff89.png", alt: "Achievement: Quickdraw" },
    { src: "https://github.githubassets.com/assets/yolo-default-be0bbff04951.png", alt: "Achievement: YOLO" },
  ],
} as const;

export type RepoItem = { name: string; stars?: string; text: string };

export const README = {
  heading: "Hey, I'm Morluto",
  paragraphs: [
    [
      "I write about papers and books I'm reading, and things I'm building, on my blog ",
      { link: "here" },
      ".",
    ],
    [
      "Most recently, I've been working on AI math. I solved the 33 year old Erdos problem ",
      { link: "#81" },
      " and a number of conjectures alongside longtime collaborator ",
      { link: "N0zoM1z0" },
    ],
    [
      "My personal research has been in agents, RL environments and preference learning if you would like to collaborate on research. You can reach me on ",
      { link: "X" },
      " or my email ",
      { link: "here." },
      ".",
    ],
  ] as ReadonlyArray<ReadonlyArray<string | { link: string }>>,
  building: [
    { name: "REA: Reverse Engineer Anything", stars: "344k", text: "Reverse engineer anything with agents, from app behavior down to native binaries." },
    { name: "Awesome Reverse Engineering", stars: "966", text: "Curated reverse-engineering tools and learning resources for binaries, apps, firmware, file formats, and protocols." },
    { name: "flameox", stars: "217", text: "Performance engineering, profiling and optimizer tools. Supports, application and native code, GPU kernels, and inference stacks." },
    { name: "Jacobian", stars: "310", text: "Pure mathematics for agents: search for examples and counterexamples, compute exactly, and independently check what a result proves." },
    { name: "Preference", text: "Research infrastructure for trading agents." },
    { name: "LeanToken", stars: "114", text: "Code intelligence for agents: find the code that matters and keep your context window and tokens lean." },
    { name: "GitContribute", stars: "22", text: "Contribution research for agents: check repository guidance, related work, code context, and validation before writing a patch." },
    { name: "SmokingGun", stars: "34", text: "Optimization evidence for agents: find complexity hotspots and test whether a proposed change is worth making." },
    { name: "Generate Social Preview", stars: "37", text: "Agent skill for social preview images grounded in a project's own images, examples, and purpose." },
  ] as RepoItem[],
  contributing: [
    { name: "gstack", stars: "137k", text: "I wrote the first PR (not from Garry)" },
    { name: "Reef", stars: "7.7k", text: "Continual learning infrastructure for agents: preserve receipts across overlapping runs, cache commit history for constant-time training bookkeeping, detect record conflicts after compaction, and make training and rollback settlement safe to retry." },
    { name: "AgentEnv Framework (Scale AI)", stars: "331", text: "Task and storage performance: avoid quadratic response-history diffs, reduce implicit scheduler graphs, reuse journal keys, batch Explorer reads, and index latest-version lookups." },
    { name: "Triton", stars: "20k", text: "Autotuner fractional top_k pruning fix, unsigned tl.sum dtype promotion doc correction, invalid k value rejection in tl.topk, and tuple-target support in list comprehensions." },
    { name: "NeMo labs-molt", stars: "1.2k", text: "Vectorized default REINFORCE returns for faster RL training." },
    { name: "slime", stars: "8.7k", text: "Vectorized REINFORCE++ discounted returns for faster LLM post-training RL." },
    { name: "Model Context Protocol", stars: "14k", text: "TypeScript SDK packaging fix for CommonJS validator exports and Ajv." },
    { name: "RepoPrompt", stars: "963", text: "Context Builder model selection, agent-mode and tool-card reliability, workspace model drift cleanup, test harness hardening against hangs and waiter leaks, hosted-app/XCTest sharding, superseded PR CI run cancellation, pending context preservation through routing, focused-build cost reporting, diff chunk reconstruction without repeated array shifts, replace-all matching with reused full-file indexes, and bounded LRU diff caching." },
    { name: "DeepSeek Agents", stars: "6.3k", text: "DeepSeek integration guides." },
    { name: "Flash Linear Attention", stars: "6k", text: "Split attention decode output offset fix, concurrent LSE store prevention in value-split attention, value-split Wall backward with local deltas, Wall autotuning reuse across length buckets, centralized generation errors for unsupported cache strategies, DPLR safe-gate full token stride offsets, tuple-form legacy cache round-trip restoration, explicit cu_seqlens preservation with attention masks, GQA head validation, strided decoding input handling, and context-parallel token partition validation." },
    { name: "TileLang", stars: "8.7k", text: "HIP atomic load/store and return_prev vector atomic add support, CUDA atomic add memory-order mapping to acquire PTX, FP8 E4M3 special-value decoding, BufferRegion destinations in atomic_addx2 return_prev, T.transpose axis-swap correctness, autotuner cache reuse prevention across different outputs and values, shared-TMEM buffer pointer type checks before dereference, unsupported TMA atomic add dtype rejection, lane-wise HIP vector Select lowering, flat CUDA include discovery for NVRTC, and symlink-aware nvcc discovery." },
    { name: "Qwen Code", stars: "29k", text: "Config validation for fractional session and tool-call limits, max-token continuation rollback, MCP read-only auto-approval trust enforcement, descendant termination after discovery timeout, restrictive permission path canonicalization, and malformed tool result display resilience." },
    { name: "Executor", stars: "4.2k", text: "Deno subprocess stdin failure handling, stalled GraphQL invocation timeout, failed policy and OAuth app mutation surfacing, and provider migration row ID collision prevention." },
    { name: "Hermes", stars: "255k", text: "Cron scheduler double-execution prevention and credential-pool failover fix for provider auto-detection." },
    { name: "x-JEPA", stars: "130", text: "Correctness fixes across the JEPA training and planning stack: Wasserstein midpoint targets, unimodal Beta policies, goal/state token alignment, SIGReg dtype handling, and discrete planning action indices." },
    { name: "OpenClaw", stars: "393k", text: "Shared phone identity canonicalization, Signal/iMessage routing fixes, WhatsApp normalization coverage, stale-chunk recovery unblock, subagent registry resurrection prevention, heartbeat responsiveness with large commitment queues, and qa-lab transport teardown before gateway shutdown." },
    { name: "Mooncake", stars: "6.8k", text: "RDMA completion resource validation, cross-thread SHM relocation mapping lifecycle, and NVMe-oF task batch rejection with cuFile completion correlation." },
    { name: "AgentENV", stars: "3.7k", text: "OverlayBD fix to reject truncated mapped reads." },
    { name: "gbrain", stars: "31k", text: "Trajectory regression fix: stop negative metrics from inverting the signal." },
    { name: "Orca", stars: "99k", text: "Onboarding fix to skip Computer Use setup when the macOS helper app is unavailable." },
    { name: "Harbor", stars: "6.3k", text: "Make create-task and publish skills load in Codex." },
    { name: "Vibe-Trading", stars: "36k", text: "Codex OAuth init/default-model fixes and CLI resume prompt input preservation." },
    { name: "SymPy", stars: "15k", text: "Fix Pell-Gordon subresultant crashes when polynomials share a common factor by terminating on a zero remainder." },
    { name: "Cordis", stars: "9.3k", text: "Correct symbol and prototype-named event dispatch, and settle concurrent async interval reads in order." },
    { name: "Magpie", stars: "58", text: "Fallible JSON parsing across FFI, runtime, codegen, semantic analysis, and web lowering." },
    { name: "gitcrawl", stars: "130", text: "Portable store worktree verification to prevent local database misclassification under stray Git metadata." },
    { name: "Crabbox", stars: "1.5k", text: "RunPod fix to make new pods accept the configured SSH key." },
    { name: "UniRL", stars: "1k", text: "Sampling fix to make omitted autoregressive top-k unrestricted, unified loss reporting alignment with backward scaling, finite normalization for invalid rewards, per-prompt VideoAlign video paths, and bounded ZeroMQ operations during bucketed weight transfer." },
    { name: "HarnessGym", stars: "47", text: "Benchmark correctness fixes for result parsing, activation reporting, and artifact quarantine." },
    { name: "Qwen Code Docs", stars: "55", text: "Failed batch file reporting and output validation with bounded prose chunks in the docs translator, plus navbar locale preservation behind deployment base paths." },
  ] as RepoItem[],
};

export const PINNED = [
  { name: "jacobian", desc: "Composable mathematics tools for agents", lang: "Python", color: "#3572A5", stars: "310", forks: "30" },
  { name: "rea", desc: "Reverse engineer anything with agents, from app behavior down to native binaries.", lang: "TypeScript", color: "#3178c6", stars: "344k", forks: "86.7k" },
  { name: "erdos-81", forkedFrom: "N0zoM1z0/erdos-81", lang: "Lean", color: "#cccccc", stars: "1" },
  { name: "leantoken", desc: "Code intelligence for agents: find the code that matters and keep your context window and tokens lean.", lang: "Rust", color: "#dea584", stars: "114", forks: "13" },
  { name: "flameox", desc: "Runtime evidence that helps agents trace, profile, and burn down hotspots in application and native code, GPU kernels, and inference stacks.", lang: "Python", color: "#3572A5", stars: "217", forks: "17" },
  { name: "smokinggun", desc: "Help your agents find the smoking gun they're looking for. Optimization evidence for agents: find complexity hotspots.", lang: "TypeScript", color: "#3178c6", stars: "34", forks: "4" },
] as const;

export const CONTRIBUTIONS = {
  title: "44,450 contributions in the last year",
  // Weeks are columns (Sun..Sat down the rows). "-" marks days that have not happened yet.
  rows: ["00000010111101111111112211112434413211312212113111131", "00000011111111111111111111111144212311221122312111111", "00000001111111111111121111112433123311212231211112221", "0000000111111111111111111121231211212121222121111132-", "0000001111111111111111211111221113211122212121111111-", "0000010111111111111111111111242121311122321121113141-", "0000001111111111111111111111214222311212231121111232-"] as readonly string[],
  months: [["Oct", 2], ["Nov", 5], ["Dec", 4], ["Jan", 4], ["Feb", 4], ["Mar", 5], ["Apr", 4], ["May", 5], ["Jun", 4], ["Jul", 4], ["Aug", 5], ["Sep", 4], ["Oct", 3]] as ReadonlyArray<readonly [string, number]>,
  years: ["2026", "2025", "2024", "2023", "2022", "2021", "2020"],
  orgs: [
    { name: "@tile-ai", avatar: "https://avatars.githubusercontent.com/u/183584698?s=40&v=4" },
    { name: "@repoprompt", avatar: "https://avatars.githubusercontent.com/u/289327073?s=40&v=4" },
    { name: "@triton-lang", avatar: "https://avatars.githubusercontent.com/u/169110177?s=40&v=4" },
  ],
  overview: {
    repos: ["morluto/jacobian", "morluto/rea", "morluto/leantoken"],
    more: "333 other repositories",
    percents: { top: "3%", right: "11%", bottom: "8%", left: "78%" },
  },
} as const;

export const ACTIVITY = {
  month: "October",
  year: "2026",
  reviewed: [
    { repo: "morluto/rea", count: "25 pull requests" },
    { repo: "scaleapi/agentenv-framework", count: "5 pull requests" },
    { repo: "morluto/jacobian", count: "5 pull requests" },
    { repo: "morluto/flameox", count: "1 pull request" },
  ],
};

export const FOOTER_LINKS = ["Terms", "Privacy", "Security", "Status", "Community", "Docs", "Contact", "Manage cookies", "Do not share my personal information"];
