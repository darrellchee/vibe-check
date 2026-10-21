/* eslint-disable @next/next/no-img-element -- remote avatars/badges are shown as-is, no optimization wanted */
import type { Metadata } from "next";
import { Mona_Sans } from "next/font/google";
import s from "./profile.module.css";
import { Icon } from "./octicon";
import { Chrome } from "./chrome";
import {
  ACTIVITY,
  CONTRIBUTIONS,
  FOOTER_LINKS,
  PINNED,
  PROFILE,
  VIEWER,
  README,
  type RepoItem,
} from "./data";

// GitHub's UI font. Self-hosted by next/font, so the page makes no request to Google at runtime.
const mona = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], display: "swap", variable: "--font-mona" });

export const metadata: Metadata = {
  title: "Profile overview · static UI copy",
  description: "A look-only visual copy of a GitHub profile overview page. Nothing on it is interactive.",
  robots: { index: false, follow: false },
};

const X_LOGO =
  "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z";

/** A shields.io "flat" star badge, drawn with CSS instead of loading the remote image. */
function StarBadge({ value }: { value: string }) {
  return (
    <span className={s.shield}>
      <span className={s.shieldLabel}>stars</span>
      <span className={s.shieldGold}>{value}</span>
    </span>
  );
}

function RepoList({ items }: { items: RepoItem[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.name}>
          <strong>
            <span className={s.mdLink}>{item.name}</span>
          </strong>
          {item.stars ? (
            <>
              {" "}
              <StarBadge value={item.stars} />
            </>
          ) : null}
          {` - ${item.text}`}
        </li>
      ))}
    </ul>
  );
}

function Sidebar() {
  return (
    <aside className={s.sidebar}>
      <div className={s.avatarWrap}>
        <img className={s.avatar} src={PROFILE.avatar} alt="" width={260} height={260} referrerPolicy="no-referrer" />
        <div className={s.status}>
          <img src={PROFILE.statusEmoji} alt="" width={20} height={20} referrerPolicy="no-referrer" />
        </div>
      </div>
      <h1 className={s.names}>
        <span className={s.fullname}>{PROFILE.name}</span>
        <span className={s.username}>{PROFILE.login}</span>
      </h1>
      <div className={s.follow}>Follow</div>
      <div className={s.bio}>{PROFILE.bio}</div>
      <div className={s.followers}>
        <Icon name="people" /> <b>{PROFILE.followers}</b> followers · <b>{PROFILE.following}</b> following
      </div>
      <ul className={s.details}>
        <li className={s.detail}>
          <Icon name="location" />
          <span>{PROFILE.location}</span>
        </li>
        {PROFILE.links.map((href) => (
          <li key={href} className={s.detail}>
            <Icon name="link" />
            <span>{href}</span>
          </li>
        ))}
      </ul>

      <div className={s.sbSection}>
        <h2 className={s.sbHeading}>Achievements</h2>
        <div className={s.badges}>
          {PROFILE.achievements.map((a) => (
            <span key={a.alt} className={s.badge}>
              <img src={a.src} alt={a.alt} width={64} referrerPolicy="no-referrer" />
              {"tier" in a ? <span className={s.tier}>{a.tier}</span> : null}
            </span>
          ))}
        </div>
      </div>

      <div className={s.sbSection}>
        <h2 className={s.sbHeading}>Highlights</h2>
        <div className={s.highlights}>
          <Icon name="star" /> <span className={s.pro}>Pro</span>
        </div>
      </div>

      <div className={s.sbSection}>
        <span className={s.block}>Block or report user</span>
      </div>
    </aside>
  );
}

function Readme() {
  return (
    <div className={s.readme}>
      <div className={s.readmeTitle}>
        <span>morluto</span>
        <span className={s.slash}>/</span>
        <span>README</span>
        <span className={s.muted}>.md</span>
      </div>
      <article className={s.md}>
        <h3>{README.heading}</h3>
        <p>
          <span className={s.shield}>
            <span className={s.shieldLabel}>
              <svg className={s.shieldLogo} viewBox="0 0 24 24" aria-hidden="true">
                <path d={X_LOGO} />
              </svg>
              X
            </span>
            <span className={s.shieldBlack}>@morluto</span>
          </span>
        </p>
        {README.paragraphs.map((parts, i) => (
          <p key={i}>
            {parts.map((part, j) =>
              typeof part === "string" ? (
                <span key={j}>{part}</span>
              ) : (
                <span key={j} className={s.mdLink}>
                  {part.link}
                </span>
              ),
            )}
          </p>
        ))}
        <h4>Building</h4>
        <RepoList items={README.building} />
        <h4>Contributing to</h4>
        <RepoList items={README.contributing} />
      </article>
    </div>
  );
}

function Pinned() {
  return (
    <section className={s.section}>
      <h2 className={s.h2}>Pinned</h2>
      <ol className={s.pinned}>
        {PINNED.map((repo) => (
          <li key={repo.name} className={s.pinItem}>
            <div className={s.pinBox}>
              <div className={s.pinContent}>
                <div className={s.pinHead}>
                  <Icon name="repo" />
                  <span className={s.pinName}>{repo.name}</span>
                  <span className={s.label}>Public</span>
                </div>
                {"forkedFrom" in repo ? (
                  <>
                    <p className={s.pinText}>
                      Forked from <span className={s.underline}>{repo.forkedFrom}</span>
                    </p>
                    <p className={`${s.pinText} ${s.pinDescEmpty}`} />
                  </>
                ) : (
                  <p className={`${s.pinText} ${s.pinDesc}`}>{repo.desc}</p>
                )}
                <p className={s.pinMeta}>
                  <span className={s.lang}>
                    <span className={s.langDot} style={{ backgroundColor: repo.color }} />
                    <span>{repo.lang}</span>
                  </span>
                  <span className={s.metaLink}>
                    <Icon name="star" />
                    {repo.stars}
                  </span>
                  {"forks" in repo ? (
                    <span className={s.metaLink}>
                      <Icon name="repo-forked" />
                      {repo.forks}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ContributionGraph() {
  const { rows, months } = CONTRIBUTIONS;
  const labels: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };
  return (
    <div className={s.graphCard}>
      <div className={s.calendar}>
        <table className={s.calTable}>
          <thead>
            <tr>
              <td className={s.calMonth}>
                <span className={s.calSr}>Day of Week</span>
              </td>
              {months.map(([name, span], i) => (
                <td key={i} className={s.calMonth} colSpan={span}>
                  {name}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className={s.calLabel}>{labels[r] ?? ""}</td>
                {[...row].map((level, c) =>
                  level === "-" ? null : <td key={c} className={`${s.cell} ${s[`l${level}`]}`} />,
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className={s.calFooter}>
          <span className={s.muted}>Learn how we count contributions</span>
          <span className={s.legend}>
            <span className={s.legendLess}>Less</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`${s.legendCell} ${s[`l${l}`]}`} />
            ))}
            <span>More</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function ActivityRadar() {
  return (
    <svg className={s.radar} width="281" height="243" aria-hidden="true">
      <g transform="translate(-21.1875, -47.7421875)">
        <path
          d="M169.5,166.1823918269231 L177.66456330128204,169.5 L169.5,174.34695512820514 L87.2421875,169.5 z"
          fill="#40c463"
          stroke="#40c463"
          strokeWidth="7"
          strokeLinejoin="round"
          opacity="0.5"
        />
        <line className={s.radarAxis} x1="83.2421875" y1="169.5" x2="255.7578125" y2="169.5" />
        <line className={s.radarAxis} x1="169.5" y1="83.2421875" x2="169.5" y2="255.7578125" />
        <ellipse className={s.radarPoint} rx="3" ry="3" cx="169.5" cy="164.1823918269231" />
        <ellipse className={s.radarPoint} rx="3" ry="3" cx="179.66456330128204" cy="169.5" />
        <ellipse className={s.radarPoint} rx="3" ry="3" cx="169.5" cy="176.34695512820514" />
        <ellipse className={s.radarPoint} rx="3" ry="3" cx="85.2421875" cy="169.5" />
        <text className={s.radarPct} textAnchor="middle" x="169.5" y="59.2421875">
          {CONTRIBUTIONS.overview.percents.top}
        </text>
        <text className={s.radarLabel} textAnchor="middle" x="169.5" y="73.2421875">
          Code review
        </text>
        <text className={s.radarPct} textAnchor="start" x="272.53515625" y="168.5">
          {CONTRIBUTIONS.overview.percents.right}
        </text>
        <text className={s.radarLabel} textAnchor="start" x="265.7578125" y="182.5">
          Issues
        </text>
        <text className={s.radarPct} textAnchor="middle" x="169.5" y="273.7578125">
          {CONTRIBUTIONS.overview.percents.bottom}
        </text>
        <text className={s.radarLabel} textAnchor="middle" x="169.5" y="287.7578125">
          Pull requests
        </text>
        <text className={s.radarPct} textAnchor="end" x="58.9296875" y="168.5">
          {CONTRIBUTIONS.overview.percents.left}
        </text>
        <text className={s.radarLabel} textAnchor="end" x="71.2421875" y="182.5">
          Commits
        </text>
      </g>
    </svg>
  );
}

function Contributions() {
  const { overview } = CONTRIBUTIONS;
  return (
    <div className={s.yearly}>
      <div className={s.yearlyMain}>
        <h2 className={s.h2}>{CONTRIBUTIONS.title}</h2>
        <ContributionGraph />
        <div className={s.overviewCard}>
          <div className={s.chips}>
            {CONTRIBUTIONS.orgs.map((org) => (
              <span key={org.name} className={s.chip}>
                <img src={org.avatar} alt="" width={20} height={20} referrerPolicy="no-referrer" />
                {org.name}
              </span>
            ))}
            <span className={`${s.chip} ${s.chipMore}`}>More</span>
          </div>
          <div className={s.overview}>
            <div className={s.overviewLeft}>
              <h3 className={s.overviewTitle}>Activity overview</h3>
              <div className={s.overviewRow}>
                <Icon name="repo" />
                <div className={s.overviewText}>
                  Contributed to <span className={s.repoLink}>{overview.repos[0]}</span>,{" "}
                  <span className={s.repoLink}>{overview.repos[1]}</span>,{" "}
                  <span className={s.repoLink}>{overview.repos[2]}</span>{" "}
                  <span className={s.nowrap}>and {overview.more}</span>
                </div>
              </div>
            </div>
            <div className={s.overviewRight}>
              <ActivityRadar />
            </div>
          </div>
        </div>

        <div className={s.activity}>
          <h2 className={s.activityHeading}>Contribution activity</h2>
          <div className={s.listing}>
            <h3 className={s.monthHeader}>
              <span className={s.monthText}>
                {ACTIVITY.month} <span className={s.muted}>{ACTIVITY.year}</span>
              </span>
            </h3>
            <Timeline />
          </div>
          <div className={s.showMore}>Show more activity</div>
        </div>
      </div>
      <ul className={s.yearList}>
        {CONTRIBUTIONS.years.map((year, i) => (
          <li key={year} className={`${s.year} ${i === 0 ? s.yearSelected : ""}`}>
            {year}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CollapsedRow({ icon, title }: { icon: "repo-push" | "repo" | "git-pull-request" | "issue-opened"; title: string }) {
  return (
    <div className={s.tlItem}>
      <div className={s.tlBadge}>
        <Icon name={icon} />
      </div>
      <div className={s.tlBody}>
        <div className={s.sum}>
          <span>{title}</span>
          <Icon name="unfold" />
        </div>
      </div>
    </div>
  );
}

function Timeline() {
  return (
    <>
      <CollapsedRow icon="repo-push" title="Created 1,699 commits in 36 repositories" />
      <CollapsedRow icon="repo" title="Created 97 repositories" />

      <div className={s.tlItem}>
        <div className={s.tlBadge}>
          <Icon name="flame" />
        </div>
        <div className={s.tlBody}>
          <div className={s.tlHead}>
            <h4 className={s.tlTitle}>
              Created a pull request in <span className={s.underline}>morluto/rea</span> that received 39 comments
            </h4>
            <span className={s.tlTime}>Oct 13</span>
          </div>
          <div className={s.tlBox}>
            <Icon name="git-pull-request" className={`${s.tlBoxIcon} ${s.openIcon}`} />
            <div className={s.tlBoxBody}>
              <h3 className={s.tlBoxTitle}>docs: organize canonical documentation layout and verify new pages</h3>
              <p className={s.tlBoxDesc}>
                Continues <span className={s.mdLinkPlain}>#2403</span>, originally contributed by{" "}
                <b className={s.strongFg}>@matbrgz</b> (Matheus Breguêz). The original commits and contributor
                attribution are preserved in this follo…
              </p>
              <div className={s.tlBoxMeta}>
                <span className={s.diffstat}>
                  <span className={s.add}>+1,882</span> <span className={s.del}>−915</span>
                  <span className={`${s.blk} ${s.blkAdd}`} />
                  <span className={`${s.blk} ${s.blkAdd}`} />
                  <span className={`${s.blk} ${s.blkAdd}`} />
                  <span className={`${s.blk} ${s.blkDel}`} />
                  <span className={`${s.blk} ${s.blkNeutral}`} /> <span>lines changed</span>{" "}
                  <span className={s.dot}>•</span>
                </span>
                39 comments
              </div>
            </div>
          </div>
        </div>
      </div>

      <CollapsedRow icon="git-pull-request" title="Opened 309 other pull requests in 98 repositories" />

      <div className={s.tlItem}>
        <div className={s.tlBadge}>
          <Icon name="eye" />
        </div>
        <div className={`${s.tlBody} ${s.tlBodyOpen}`}>
          <div className={s.sum}>
            <span>Reviewed 188 pull requests in 4 repositories</span>
            <Icon name="fold" />
          </div>
          <div className={s.repoList}>
            {ACTIVITY.reviewed.map((r) => (
              <div key={r.repo} className={s.repoRow}>
                <span className={s.repoName}>{r.repo}</span>
                <span className={s.repoCount}>{r.count}</span>
                <Icon name="unfold" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={s.tlItem}>
        <div className={s.tlBadge}>
          <Icon name="flame" />
        </div>
        <div className={s.tlBody}>
          <div className={s.tlHead}>
            <h4 className={s.tlTitle}>
              Created an issue in <span className={s.underline}>morluto/rea</span> that received 18 comments
            </h4>
            <span className={s.tlTime}>Oct 15</span>
          </div>
          <div className={s.tlBox}>
            <Icon name="issue-opened" className={`${s.tlBoxIcon} ${s.openIcon}`} />
            <div className={s.tlBoxBody}>
              <h3 className={s.tlBoxTitle}>
                [Design] Audit lifecycle contracts across REA tools: readiness, cancellation, ownership, cleanup, and
                recovery
              </h3>
              <p className={s.tlBoxDesc}>
                Decision needed Audit the remaining REA tools and providers for lifecycle design gaps around
                readiness, cancellation, resource ownership, cleanup, …
              </p>
              <div className={s.metaLine}>
                <span className={s.issueMeta}>
                  <Icon name="checklist" />7 tasks <span className={s.dot}>•</span> 18 comments
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CollapsedRow icon="issue-opened" title="Opened 262 other issues in 8 repositories" />

      <div className={s.tlItem}>
        <div className={s.tlBadge}>
          <Icon name="lock" />
        </div>
        <div className={s.tlBody}>
          <div className={s.private}>
            <span className={s.privateText}>1,454 contributions in private repositories</span>
            <span className={s.privateDate}>Oct 1 – Oct 16</span>
          </div>
        </div>
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.footerRow}>
        <div className={s.footerBrand}>
          <Icon name="mark-github" size={24} />
          <span>© 2026 GitHub,&nbsp;Inc.</span>
        </div>
        <ul className={s.footerLinks}>
          {FOOTER_LINKS.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </div>
    </footer>
  );
}

export default function GitHubProfilePage() {
  return (
    <div className={`${s.root} ${mona.variable}`}>
      <Chrome viewer={VIEWER} tabs={PROFILE.tabs} />
      <main>
        <div className={s.container}>
          <div className={s.layout}>
            <Sidebar />
            <div className={s.content}>
              <Readme />
              <Pinned />
              <section className={s.section}>
                <Contributions />
              </section>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
